import type { Config } from '@netlify/functions'
import { dispatchStripeTestReconciliation } from '../lib/stripe-reconciliation'
export default async () => dispatchStripeTestReconciliation()
export const config: Config = { schedule: '4-59/10 * * * *' }
