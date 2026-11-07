import type { Config } from '@netlify/functions'
import { dispatchReconciliation } from '../lib/square-reconcile-dispatch'
export default async () => dispatchReconciliation('sandbox')
export const config: Config = { schedule: '*/5 * * * *' }
