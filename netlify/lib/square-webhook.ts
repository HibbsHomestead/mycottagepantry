import { getDatabase } from '@netlify/database'
import { z } from 'zod'
import { billingConfiguration, type BillingEnvironment } from './square-billing'
import { sandboxReady, verifySquareSignature } from './square-sandbox'
import {
  squareEnv,
  squareSetting,
  squareWebhookUrl,
  withSquareConnections,
} from './square-credentials'
import { squareWebhookEvents } from './square-oauth'
const eventSchema = z.object({
  event_id: z.string().min(1).max(200),
  merchant_id: z.string().min(1).max(180),
  type: z.enum(squareWebhookEvents),
  data: z.object({ id: z.string().min(1).max(180) }),
})
export async function squareBillingWebhook(
  request: Request,
  environment: BillingEnvironment,
) {
  const headers = { 'Cache-Control': 'no-store' }
  if (request.method !== 'POST')
    return new Response('Method not allowed', { status: 405, headers })
  const allowed =
    environment === 'sandbox'
      ? sandboxReady()
      : squareEnv('CONTEXT') === 'production'
  if (!allowed)
    return new Response('Webhook disabled in this context', {
      status: 503,
      headers,
    })
  if (Number(request.headers.get('content-length') || 0) > 131072)
    return new Response('Payload too large', { status: 413, headers })
  const body = await request.text()
  if (Buffer.byteLength(body) > 131072)
    return new Response('Payload too large', { status: 413, headers })
  const url = squareWebhookUrl(environment)
  if (
    request.url !== url ||
    !verifySquareSignature(
      body,
      request.headers.get('x-square-hmacsha256-signature'),
      url,
      squareEnv(squareSetting(environment, 'WEBHOOK_SIGNATURE_KEY')),
    )
  )
    return new Response('Invalid signature', { status: 403, headers })
  const parsed = eventSchema.safeParse(
    (() => {
      try {
        return JSON.parse(body)
      } catch {
        return null
      }
    })(),
  )
  if (!parsed.success)
    return new Response('Invalid event', { status: 400, headers })
  const event = parsed.data
  const client = await getDatabase().pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.billing_worker','true',true)")
    const valid = await withSquareConnections(
      client,
      async () =>
        event.merchant_id === billingConfiguration(environment).merchantId,
    )
    if (!valid) {
      await client.query('ROLLBACK')
      return new Response('Invalid merchant', { status: 403, headers })
    }
    // References only; never retain buyer/card data or trust event state for access.
    await client.query(
      'INSERT INTO billing_events(id,merchant_id,kind,object_id,environment) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',
      [
        environment + ':' + event.event_id,
        event.merchant_id,
        event.type,
        event.data.id,
        environment,
      ],
    )
    await client.query('COMMIT')
    return Response.json({ received: true }, { headers })
  } catch {
    await client.query('ROLLBACK')
    return new Response('Please retry later', { status: 503, headers })
  } finally {
    client.release()
  }
}
