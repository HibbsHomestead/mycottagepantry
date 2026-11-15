import type { Config } from '@netlify/functions'
import { adminTransaction } from '../lib/platform-admin-core'
import { synchronizeExpenseAttempt } from '../lib/subscription-expenses'
import { deploymentRuntime } from '../lib/runtime-environment'

/** Provider reads only. Bookkeeping posting still requires the stored business opt-in. */
export default async () => {
  if (deploymentRuntime().context !== 'production')
    return new Response(null, { status: 204 })
  const attempts = await adminTransaction(async (c) => {
    await c.query("SELECT set_config('app.billing_worker','true',true)")
    return (
      await c.query(`SELECT s.* FROM subscription_expense_preferences p
      JOIN LATERAL (SELECT * FROM stripe_checkouts
        WHERE business_id=p.business_id AND environment='live'
          AND status IN ('complete','cancelled') AND subscription_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1) s ON true
      WHERE p.enabled ORDER BY p.updated_at ASC LIMIT 3`)
    ).rows
  })
  for (const attempt of attempts) {
    try {
      await adminTransaction(async (c) => {
        await c.query("SELECT set_config('app.billing_worker','true',true)")
        await synchronizeExpenseAttempt(c, attempt.id)
      })
    } catch {
      console.error('Subscription expense retry needs support review')
    } finally {
      // Rotate the bounded retry batch without touching subscription metadata.
      // Consent and defaults retain their separate activity audit history.
      try {
        await adminTransaction(async (c) => {
          await c.query("SELECT set_config('app.business_id',$1,true)", [
            attempt.business_id,
          ])
          await c.query(
            'UPDATE subscription_expense_preferences SET updated_at=now() WHERE business_id=$1',
            [attempt.business_id],
          )
        })
      } catch {
        console.error('Subscription expense retry cursor could not be saved')
      }
    }
  }
  return new Response(null, { status: 204 })
}
export const config: Config = { schedule: '17,47 * * * *' }
