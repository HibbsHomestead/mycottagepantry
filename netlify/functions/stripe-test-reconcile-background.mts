import type { Config } from '@netlify/functions'
import { limitedBody } from '../lib/support-core'
import {
  stripeTestReconciliationWorker,
  verifyStripeDispatch,
} from '../lib/stripe-reconciliation'
export default async (request: Request) => {
  if (request.method !== 'POST') return
  let timestamp: string
  try {
    const body = JSON.parse((await limitedBody(request, 100)).toString('utf8'))
    if (typeof body.timestamp !== 'string') return
    timestamp = body.timestamp
  } catch {
    return
  }
  if (!verifyStripeDispatch(request, timestamp)) return
  await stripeTestReconciliationWorker()
}
export const config: Config = { background: true }
