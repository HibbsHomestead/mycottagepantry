import { adminTransaction } from './platform-admin-core'
import { deploymentRuntime, serverEnvironment } from './runtime-environment'
import { openStripe, stripeSettings } from './stripe-provider'
import { activateHostedStripe, setupStripeBilling } from './stripe-setup'

/** Deployment and scheduled recovery; never creates customers or charges. */
export async function prepareHostedStripeLaunch() {
  if (deploymentRuntime().context !== 'production') return
  await adminTransaction(async (c) => {
    await c.query("SELECT set_config('app.billing_worker','true',true)")
    let row = await stripeSettings(c, 'live', true)
    if (
      !row?.ciphertext ||
      row.configuration?.launchDisabled ||
      row.configuration?.hostingImportDisabled
    )
      return
    if (
      openStripe(row.ciphertext, 'live').key !==
      serverEnvironment('STRIPE_LIVE_SECRET_KEY')
    )
      return
    if (
      !row.configuration?.hostedLaunchReady ||
      row.configuration?.setupError
    ) {
      await setupStripeBilling(c, row, 'live')
      row = await stripeSettings(c, 'live', true)
    }
    if (row.webhook_verified_at) await activateHostedStripe(c)
  })
}
