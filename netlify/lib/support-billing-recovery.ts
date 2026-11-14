import { AdminError, type AdminClient } from './platform-admin-core'
import { withSquareConnections } from './square-credentials'

/** Shared with the existing administrator recovery workflow. No charge/cancel/plan-write API. */
export async function reconcileSupportBilling(
  c: AdminClient,
  businessId: string,
) {
  await c.query("SELECT set_config('app.billing_worker','true',true)")
  const billing = (
    await c.query('SELECT source FROM workspace_billing WHERE business_id=$1', [
      businessId,
    ])
  ).rows[0]
  const attempts = (
    await c.query(
      "SELECT * FROM stripe_checkouts WHERE business_id=$1 AND session_id IS NOT NULL AND status IN ('open','complete')",
      [businessId],
    )
  ).rows
  if (billing?.source?.startsWith('stripe_') || attempts.length) {
    const { reconcileStripeCheckout } = await import('./stripe-subscriptions')
    for (const attempt of attempts) await reconcileStripeCheckout(c, attempt)
  } else if (billing?.source?.startsWith('square_')) {
    const { reconcileBusiness } = await import('./billing-service')
    await withSquareConnections(c, () => reconcileBusiness(c, businessId))
  } else
    throw new AdminError(
      409,
      'NO_PROVIDER_LINK',
      'No trusted provider billing relationship exists for this business.',
    )
}
