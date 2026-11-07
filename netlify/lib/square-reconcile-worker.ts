import { getDatabase } from '@netlify/database'
import { billingConfiguration, type BillingEnvironment } from './square-billing'
import { squareEnv, withSquareConnections } from './square-credentials'
import { sandboxReady } from './square-sandbox'
import { runBillingReconciliation } from './billing-service'
export async function squareReconciliationWorker(
  environment: BillingEnvironment,
) {
  if (
    environment === 'sandbox'
      ? !sandboxReady()
      : squareEnv('CONTEXT') !== 'production'
  )
    return new Response(null, { status: 204 })
  const client = await getDatabase().pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.billing_worker','true',true)")
    const result = await withSquareConnections(client, async () => {
      const config = billingConfiguration(environment)
      if (!config.readable || !config.merchantId || !config.locationId)
        return null
      // Small durable batches fit the background runtime, including invoice reads.
      return runBillingReconciliation(client, fetch, 5, environment)
    })
    await client.query('COMMIT')
    return result
      ? Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
      : new Response(null, { status: 204 })
  } catch {
    await client.query('ROLLBACK')
    return new Response(null, { status: 503 })
  } finally {
    client.release()
  }
}
