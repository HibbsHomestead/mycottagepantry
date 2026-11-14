import { adminTransaction } from './platform-admin-core'
import { deploymentRuntime, serverEnvironment } from './runtime-environment'
import { openStripe, stripeSettings, stripeRequest } from './stripe-provider'
import { setupStripeBilling } from './stripe-setup'

/** Deployment and scheduled recovery; never creates customers or charges. */
export async function prepareHostedStripeLaunch() {
  if (deploymentRuntime().context !== 'production') return
  const evidence = await adminTransaction(async (c) => {
    await c.query("SELECT set_config('app.billing_worker','true',true)")
    const row = await stripeSettings(c, 'live', true)
    if (
      !row?.ciphertext ||
      row.configuration?.launchDisabled ||
      row.configuration?.hostingImportDisabled
    )
      return
    const { key } = openStripe(row.ciphertext, 'live')
    if (key !== serverEnvironment('STRIPE_LIVE_SECRET_KEY')) return
    const account = await stripeRequest(key, '/account')
    if (!row.account_id || account.id !== row.account_id)
      throw new Error('Saved Stripe account binding does not match')
    if (
      !row.configuration?.hostedSetupComplete ||
      row.configuration?.setupError
    ) {
      await setupStripeBilling(c, row, 'live')
    }
    // Setup and signed webhook delivery never approve customer purchases.
    await c.query(`UPDATE stripe_provider_settings SET checkout_enabled=false
      WHERE environment='live' AND NOT (configuration ? 'liveCheckoutApprovedAt')`)
    return {
      encrypted: true,
      decrypted: true,
      accountMatched: true,
      validated: !!row.validated_at,
    }
  })
  // Fixed booleans only, after commit. Later invocations read and decrypt the
  // persisted connection again; no provider identifiers or credentials are logged.
  if (evidence)
    console.info('stripe_connection_persistence_v1', JSON.stringify(evidence))
}
