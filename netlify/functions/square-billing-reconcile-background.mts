import type { Config } from '@netlify/functions'
import { z } from 'zod'
import { verifyReconciliationDispatch } from '../lib/square-reconcile-dispatch'
import { squareReconciliationWorker } from '../lib/square-reconcile-worker'
export default async (request: Request) => {
  if (
    request.method !== 'POST' ||
    Number(request.headers.get('content-length') || 0) > 500
  )
    return
  const text = await request.text()
  if (text.length > 500) return
  const parsed = z
    .object({
      environment: z.enum(['sandbox', 'production']),
      timestamp: z.string(),
    })
    .strict()
    .safeParse(
      (() => {
        try {
          return JSON.parse(text)
        } catch {
          return null
        }
      })(),
    )
  if (
    !parsed.success ||
    !verifyReconciliationDispatch(
      request,
      parsed.data.environment,
      parsed.data.timestamp,
    )
  )
    return
  const result = await squareReconciliationWorker(parsed.data.environment)
  if (result.status >= 500) throw new Error('BILLING_RECONCILIATION_RETRY')
}
export const config: Config = { background: true }
