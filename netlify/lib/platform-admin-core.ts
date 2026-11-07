import { getDatabase } from '@netlify/database'
import { admin } from '@netlify/identity'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Context } from '@netlify/functions'
import type { AdminMetadata } from '../../src/lib/platform-admin-types'

export const adminOrigin = 'https://admin.mycottagepantry.com'
export const adminCookie = '__Host-cp_admin'
export type AdminClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: AdminMetadata[] }>
  release: () => void
}
export class AdminError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
export const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex')
export const opaqueToken = () => randomBytes(32).toString('base64url')

/** Exact configured origin only; forwarded host headers never establish authority. */
export function requireAdminOrigin(request: Request) {
  const url = new URL(request.url)
  const env = globalThis.Netlify?.env
  const context = env?.get('CONTEXT')
  const preview = env?.get('DEPLOY_URL')
  const allowed =
    url.origin === adminOrigin ||
    (context === 'deploy-preview' &&
      !!preview &&
      /^https:\/\/[a-z0-9-]+--mycottagepantry\.netlify\.app$/.test(preview) &&
      url.origin === preview) ||
    (context === 'dev' && url.origin === 'http://localhost:8889')
  if (!allowed || url.username || url.password)
    throw new AdminError(
      404,
      'ADMIN_HOST_REQUIRED',
      'Administration is unavailable on this host.',
    )
  const origin = request.headers.get('origin')
  if (
    (origin && origin !== url.origin) ||
    (request.method === 'POST' && origin !== url.origin) ||
    request.headers.get('x-cp-admin') !== '1' ||
    ['cross-site', 'same-site'].includes(
      request.headers.get('sec-fetch-site') || '',
    )
  )
    throw new AdminError(
      403,
      'ORIGIN_FORBIDDEN',
      'Use the administration portal on this host.',
    )
  if (
    request.method === 'POST' &&
    !request.headers.get('content-type')?.startsWith('application/json')
  )
    throw new AdminError(415, 'JSON_REQUIRED', 'Use a JSON request.')
  return url.origin
}
export async function adminTransaction<T>(
  fn: (client: AdminClient) => Promise<T>,
): Promise<T> {
  const c = (await getDatabase().pool.connect()) as AdminClient
  try {
    await c.query('BEGIN')
    await c.query("SELECT set_config('app.platform_gateway','true',true)")
    const value = await fn(c)
    await c.query('COMMIT')
    return value
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    c.release()
  }
}
export async function audit(
  c: AdminClient,
  actor: string | null,
  action: string,
  target: string | null,
  outcome: string,
  requestId: string,
  reason: string | null = null,
  before: Record<string, unknown> | null = null,
  after: Record<string, unknown> | null = null,
) {
  // Callers supply fixed action/outcome codes and stable IDs, never request bodies/errors.
  await c.query(
    'INSERT INTO platform_audit(actor_id,action,target,outcome,request_id,reason,before,after) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      actor,
      action,
      target,
      outcome,
      requestId,
      reason,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
    ],
  )
}
/** Committed separately: failed authentication cannot roll back its rate counter. */
export async function adminRateLimit(
  subject: string,
  action: string,
  maximum: number,
  seconds = 600,
) {
  return adminTransaction(async (c) => {
    const key = hash(`${action}:${subject}`)
    const { rows } = await c.query(
      `INSERT INTO platform_limits(key,count,expires_at) VALUES($1,1,NOW()+$2*INTERVAL '1 second')
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN platform_limits.expires_at<=NOW() THEN 1 ELSE platform_limits.count+1 END,
      expires_at=CASE WHEN platform_limits.expires_at<=NOW() THEN EXCLUDED.expires_at ELSE platform_limits.expires_at END RETURNING count`,
      [key, seconds],
    )
    return rows[0].count <= maximum
  })
}
export async function requireRate(
  subject: string,
  action: string,
  max: number,
  seconds = 600,
) {
  if (!(await adminRateLimit(subject, action, max, seconds)))
    throw new AdminError(
      429,
      'RATE_LIMITED',
      'Too many attempts. Wait before trying again.',
    )
}
export function sessionToken(request: Request) {
  const values = (request.headers.get('cookie') || '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(adminCookie + '='))
  if (values.length !== 1) return null
  const value = values[0].slice(adminCookie.length + 1)
  return /^[a-zA-Z0-9_-]{43}$/.test(value) ? value : null
}
export function sessionCookie(token: string, maxAge = 1800) {
  return `${adminCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
}
export async function currentIdentity(id: string) {
  let user
  try {
    user = await admin.getUser(id)
  } catch {
    throw new AdminError(
      503,
      'IDENTITY_UNAVAILABLE',
      'Identity verification is unavailable. No administration data was loaded.',
    )
  }
  if (
    user.id !== id ||
    !user.confirmedAt ||
    !Number.isFinite(Date.parse(user.confirmedAt))
  )
    throw new AdminError(
      403,
      'ADMIN_DENIED',
      'Platform administrator access is required.',
    )
  return user
}
/** Sessions are issued only after password verification and an enabled admin grant. */
export async function requireAdmin(c: AdminClient, request: Request) {
  const token = sessionToken(request)
  if (!token)
    throw new AdminError(
      401,
      'SIGN_IN_REQUIRED',
      'Sign in with your platform administrator account.',
    )
  const { rows } = await c.query(
    `SELECT s.*,a.role,a.enrollment_until FROM platform_sessions s JOIN platform_admins a ON a.identity_id=s.identity_id
    WHERE s.token_hash=$1 AND a.enabled=true AND s.epoch=a.epoch AND s.expires_at>NOW() AND s.origin=$2 FOR UPDATE OF s,a`,
    [hash(token), new URL(request.url).origin],
  )
  const session = rows[0]
  if (!session)
    throw new AdminError(
      401,
      'SESSION_EXPIRED',
      'Your administrator session expired or was revoked.',
    )
  const identity = await currentIdentity(session.identity_id)
  session.identity_email = identity.email
  return session
}
export async function createSession(
  c: AdminClient,
  identity: string,
  epoch: number,
  origin: string,
  mfa = false,
  method: 'passkey' | 'totp' | 'recovery' | 'sms' | null = null,
) {
  const token = opaqueToken()
  await c.query(
    `INSERT INTO platform_sessions(token_hash,identity_id,epoch,origin,mfa_at,mfa_method,expires_at) VALUES($1,$2,$3,$4,CASE WHEN $5 THEN NOW() ELSE NULL END,$6,NOW()+INTERVAL '30 minutes')`,
    [
      hash(token),
      identity,
      epoch,
      origin,
      mfa,
      mfa ? method || 'passkey' : null,
    ],
  )
  return token
}
export function requestReference() {
  return randomUUID()
}
export function clientAddress(context?: Pick<Context, 'ip'>) {
  // Only platform runtime IP, never X-Forwarded-For from a request.
  return context?.ip || 'unknown-runtime-ip'
}
