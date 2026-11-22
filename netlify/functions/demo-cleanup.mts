import { getDatabase } from '@netlify/database'
import { demoEnabled } from '../lib/demo-session'
/** Scheduled on production only by Netlify; also available to trusted invocation. */
export default async () => {
  // Production has no public demo login, but can clean abandoned sample tenants
  // inherited from a database snapshot. The SQL routine itself only purges demos.
  const context =
    globalThis.Netlify?.context?.deploy?.context || process.env.CONTEXT
  if (!demoEnabled() && context !== 'production')
    return new Response(null, { status: 204 })
  const client = await getDatabase().pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT purge_expired_preview_demos()')
    await client.query('COMMIT')
    return new Response(null, { status: 204 })
  } catch {
    await client.query('ROLLBACK').catch(() => {})
    console.warn(JSON.stringify({ area: 'demo_cleanup', result: 'failed' }))
    return new Response(null, { status: 503 })
  } finally {
    client.release()
  }
}
export const config = { schedule: '17 */6 * * *' }
