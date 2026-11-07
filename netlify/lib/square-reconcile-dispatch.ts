import { createHmac, timingSafeEqual } from 'node:crypto'
import { encryptionConfigured, squareEnv } from './square-credentials'
import type { BillingEnvironment } from './square-billing'
const workerPath = '/.netlify/functions/square-billing-reconcile-background'
function signature(
  environment: BillingEnvironment,
  timestamp: string,
  origin: string,
) {
  return createHmac(
    'sha256',
    Buffer.from(squareEnv('SQUARE_BILLING_ENCRYPTION_KEY'), 'hex'),
  )
    .update(`square-reconcile:v1:${origin}:${timestamp}:${environment}`)
    .digest('hex')
}
export function verifyReconciliationDispatch(
  request: Request,
  environment: BillingEnvironment,
  timestamp: string,
) {
  if (
    !encryptionConfigured() ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(Date.now() - Number(timestamp)) > 120000
  )
    return false
  const expected = Buffer.from(
    signature(environment, timestamp, new URL(request.url).origin),
  )
  const received = Buffer.from(
    request.headers.get('x-cp-billing-signature') || '',
  )
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  )
}
/** Scheduled functions have a short runtime. A signed server-to-server request
 * dispatches the existing canonical reconciliation to a background function. */
export async function dispatchReconciliation(
  environment: BillingEnvironment,
  transport: typeof fetch = fetch,
) {
  const production = squareEnv('CONTEXT') === 'production'
  if ((environment === 'production' && !production) || !encryptionConfigured())
    return new Response(null, { status: 204 })
  const origin = production
    ? 'https://mycottagepantry.com'
    : squareEnv('DEPLOY_URL')
  if (
    !production &&
    !/^https:\/\/[a-z0-9-]+--mycottagepantry\.netlify\.app$/.test(origin)
  )
    return new Response(null, { status: 204 })
  const timestamp = String(Date.now())
  const response = await transport(origin + workerPath, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      'x-cp-billing-signature': signature(environment, timestamp, origin),
    },
    body: JSON.stringify({ environment, timestamp }),
  })
  return new Response(null, { status: response.ok ? 204 : 503 })
}
