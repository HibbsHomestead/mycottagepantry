import { adminTransaction } from '../lib/platform-admin-core'
import { limitedBody } from '../lib/support-core'
import {
  openStripe,
  stripeSettings,
  verifyStripeSignature,
} from '../lib/stripe-provider'
import { processStripeEvent } from '../lib/stripe-subscriptions'
export default async (request: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  if (request.method !== 'POST')
    return new Response(null, { status: 405, headers })
  const e = new URL(request.url).pathname.split('/')[3]
  if (e !== 'test' && e !== 'live')
    return new Response(null, { status: 404, headers })
  try {
    const raw = (await limitedBody(request, 1024 * 1024)).toString('utf8')
    const outcome = await adminTransaction(async (c) => {
      await c.query("SELECT set_config('app.billing_worker','true',true)")
      const settings = await stripeSettings(c, e)
      if (!settings?.ciphertext || !settings.validated_at) return 'unavailable'
      const { signing } = openStripe(settings.ciphertext, e)
      if (
        !signing ||
        !verifyStripeSignature(
          raw,
          request.headers.get('stripe-signature') || '',
          signing,
        )
      )
        return 'invalid'
      const event = JSON.parse(raw)
      if (
        event.livemode !== (e === 'live') ||
        !/^evt_[A-Za-z0-9]+$/.test(event.id || '') ||
        typeof event.type !== 'string'
      )
        return 'invalid'
      await c.query(
        'INSERT INTO stripe_events(id,environment,kind,object_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [event.id, e, event.type, event.data?.object?.id || null],
      )
      const record = (
        await c.query(
          'SELECT * FROM stripe_events WHERE id=$1 AND environment=$2 FOR UPDATE',
          [event.id, e],
        )
      ).rows[0]
      if (!record) return 'invalid'
      if (record.status === 'processed') return 'ok'
      // Signed delivery evidence is distinct from processing success below.
      await c.query(
        'UPDATE stripe_provider_settings SET webhook_verified_at=NOW() WHERE environment=$1',
        [e],
      )
      await c.query('SAVEPOINT stripe_processing')
      try {
        await processStripeEvent(c, record)
        await c.query(
          'UPDATE stripe_provider_settings SET webhook_verified_at=NOW() WHERE environment=$1',
          [e],
        )
        return 'ok'
      } catch {
        await c.query('ROLLBACK TO SAVEPOINT stripe_processing')
        await c.query(
          "UPDATE stripe_events SET status='failed',attempts=attempts+1,error_code='RECONCILIATION_REQUIRED' WHERE id=$1",
          [event.id],
        )
        return 'retry'
      }
    })
    return Response.json(
      { status: outcome },
      {
        status: outcome === 'ok' ? 200 : outcome === 'invalid' ? 400 : 503,
        headers,
      },
    )
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers })
  }
}
export const config = {
  path: ['/api/stripe/test/webhook', '/api/stripe/live/webhook'],
}
