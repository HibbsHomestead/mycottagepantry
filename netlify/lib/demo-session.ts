import { createHash, randomBytes, randomUUID } from 'node:crypto'

export const DEMO_COOKIE = 'cp_demo_session'
export function demoEnabled() {
  const context =
    globalThis.Netlify?.context?.deploy?.context || process.env.CONTEXT
  return (
    process.env.COTTAGE_DEMO_ENABLED === 'true' &&
    (['deploy-preview', 'branch-deploy', 'dev'].includes(context || '') ||
      (!context && process.env.NETLIFY_DEV === 'true'))
  )
}
/** Presence is intentional: an expired demo must never fall back to a real account. */
export function demoRequested(request: Request) {
  return /(?:^|;\s*)cp_demo_session=/.test(request.headers.get('cookie') || '')
}
export function demoHash(request: Request) {
  const token = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)cp_demo_session=([a-f0-9]{64})(?:;|$)/)?.[1]
  return token ? createHash('sha256').update(token).digest('hex') : null
}
export type DemoClient = {
  query: (sql: string, values?: any[]) => Promise<{ rows: any[] }>
}
export async function demoBusiness(client: DemoClient, request: Request) {
  if (!demoEnabled() || !demoRequested(request)) return null
  const hash = demoHash(request)
  if (!hash) return null
  return (
    (
      await client.query(
        `SELECT * FROM businesses WHERE session_hash=$1 AND identity_owner IS NULL
      AND expires_at>NOW() AND business_name='Cottage Pantry Demo Bakery' FOR UPDATE`,
        [hash],
      )
    ).rows[0] || null
  )
}
export async function createDemo(client: DemoClient, old?: { id: string }) {
  if (old) {
    // Retire only the resolved sandbox; resetting never edits another workspace.
    await client.query(
      `UPDATE businesses SET session_hash=$2,expires_at=NOW() WHERE id=$1 AND identity_owner IS NULL AND session_hash IS NOT NULL`,
      [old.id, randomBytes(32).toString('hex')],
    )
  }
  const token = randomBytes(32).toString('hex')
  const id = randomUUID()
  await client.query(
    `INSERT INTO businesses(id,business_name,session_hash,expires_at)
    VALUES($1,'Cottage Pantry Demo Bakery',$2,NOW()+INTERVAL '7 days')`,
    [id, createHash('sha256').update(token).digest('hex')],
  )
  return { token, id }
}
export function demoCookie(token: string, request: Request, clear = false) {
  const secure = new URL(request.url).protocol === 'https:'
  return `${DEMO_COOKIE}=${token}; Path=/; HttpOnly; SameSite=${secure ? 'None' : 'Lax'}; ${secure ? 'Secure; Partitioned; ' : ''}${clear ? 'Max-Age=0' : ''}`
}
export const demoUnavailable = () =>
  Response.json(
    {
      code: 'DEMO_EXTERNAL_DISABLED',
      error:
        'This service is disabled in the demo. Use manual entry; no external request was sent.',
    },
    { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
  )

// Deny external/credential-backed paths before they can use a stale Identity cookie.
export async function demoWorkspaceBlocked(request: Request) {
  const url = new URL(request.url)
  const localQueries = new Set([
    'bakingConverter',
    'pantryCategories',
    'productCategories',
    'recipeCategories',
    'productVendors',
    'bookFrom',
    'bookTo',
    'asset',
    'imageWidth',
    'font',
    'metrics',
    'labelPdf',
  ])
  if ([...url.searchParams.keys()].some((key) => !localQueries.has(key)))
    return true
  if (request.headers.get('content-type')?.includes('multipart/form-data'))
    return true
  if (request.method === 'POST') {
    const body = await request
      .clone()
      .json()
      .catch(() => null)
    if (['receiptExtract', 'shelfMedia'].includes(body?.action)) return true
    if (body?.table === 'integrations') return true
  }
  return false
}
