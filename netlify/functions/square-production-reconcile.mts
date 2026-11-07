import type { Config } from '@netlify/functions'
import { dispatchReconciliation } from '../lib/square-reconcile-dispatch'
/** Canonical reads only before owner-approved release; no Production resource creation. */
export default async () => dispatchReconciliation('production')
export const config: Config = { schedule: '2-59/5 * * * *' }
