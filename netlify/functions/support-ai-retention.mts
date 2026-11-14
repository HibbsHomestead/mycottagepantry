import { supportTransaction } from '../lib/support-core'
/** Scheduled only: conversations/diagnostics expire; content-free usage lasts 30 days. */
export default async () => {
  await supportTransaction(null, async (c) => {
    await c.query(
      'DELETE FROM support_ai_conversations WHERE expires_at<=now()',
    )
    await c.query(
      "DELETE FROM support_ai_usage WHERE created_at<now()-interval '30 days'",
    )
  })
}
export const config = { schedule: '@daily' }
