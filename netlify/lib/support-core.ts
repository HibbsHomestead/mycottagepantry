import { getUser, admin } from '@netlify/identity'
import { getDatabase } from '@netlify/database'
import { createHash } from 'node:crypto'
import { safeSupportRoute } from '../../src/lib/support'
export type SupportActor = {
  id: string
  email: string
  staff: boolean
  admin: boolean
}
export type SupportClient = {
  query: (
    sql: string,
    params?: any[],
  ) => Promise<{ rows: any[]; rowCount?: number | null }>
  release: () => void
}
export class SupportError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
export async function supportActor(): Promise<SupportActor> {
  const session = await getUser()
  if (!session)
    throw new SupportError(401, 'Log in to Cottage Pantry to get help.')
  // Revalidate current provider identity/roles; workspace roles and user metadata are ignored.
  let current
  try {
    current = await admin.getUser(session.id)
  } catch {
    throw new SupportError(
      503,
      'Account verification is temporarily unavailable. Try again later.',
    )
  }
  if (
    !current.email ||
    !current.confirmedAt ||
    !Number.isFinite(Date.parse(current.confirmedAt))
  )
    throw new SupportError(
      403,
      'Verify your account email before using support.',
    )
  const roles = current.roles || []
  return {
    id: current.id,
    email: current.email.toLowerCase(),
    staff:
      roles.includes('platform_support') || roles.includes('platform_admin'),
    admin: roles.includes('platform_admin'),
  }
}
export async function supportTransaction<T>(
  actor: SupportActor | null,
  fn: (c: SupportClient) => Promise<T>,
) {
  const c = (await getDatabase().pool.connect()) as SupportClient
  try {
    await c.query('BEGIN')
    await c.query(
      "SELECT set_config('app.identity_id',$1,true),set_config('app.support_staff',$2,true),set_config('app.support_admin',$3,true),set_config('app.support_worker',$4,true)",
      [
        actor?.id || '',
        String(!!actor?.staff),
        String(!!actor?.admin),
        String(!actor),
      ],
    )
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
export function requireSupportStaff(actor: SupportActor) {
  if (!actor.staff)
    throw new SupportError(403, 'Platform support permission is required.')
}
export function requireSupportAdmin(actor: SupportActor) {
  if (!actor.admin)
    throw new SupportError(
      403,
      'Platform administrator permission is required.',
    )
}
export async function getTicket(
  c: SupportClient,
  actor: SupportActor,
  id: string,
  staffView: boolean,
  lock = false,
) {
  if (staffView) requireSupportStaff(actor)
  const { rows } = await c.query(
    `SELECT * FROM support_tickets WHERE id=$1 AND ($2::boolean OR requester_id=$3)${lock ? ' FOR UPDATE' : ''}`,
    [id, staffView && actor.staff, actor.id],
  )
  if (!rows[0]) throw new SupportError(404, 'Ticket not found.')
  return rows[0]
}
export function ticketView(t: any, staff: boolean) {
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    category: t.category,
    status: t.status,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    ...(staff
      ? {
          requesterEmail: t.requester_email,
          workspaceId: t.workspace_id,
          diagnostics: t.diagnostics,
        }
      : {}),
  }
}
export async function supportAudit(
  c: SupportClient,
  actor: SupportActor,
  action: string,
  ticket?: string,
) {
  await c.query(
    'INSERT INTO support_audit(actor_id,action,ticket_id) VALUES($1,$2,$3)',
    [actor.id, action, ticket || null],
  )
}
export async function supportRateLimit(
  c: SupportClient,
  actor: SupportActor,
  creating: boolean,
) {
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'support:' + actor.id,
  ])
  const { rows } = await c.query(
    creating
      ? "SELECT COUNT(*)::int AS count FROM support_tickets WHERE requester_id=$1 AND created_at>NOW()-INTERVAL '1 hour'"
      : "SELECT COUNT(*)::int AS count FROM support_messages WHERE author_id=$1 AND created_at>NOW()-INTERVAL '1 hour'",
    [actor.id],
  )
  if (rows[0].count >= (creating ? 10 : actor.staff ? 120 : 60))
    throw new SupportError(
      429,
      'Too many support requests. Please wait before trying again.',
    )
}
export function supportDiagnostics(route?: string) {
  const version = globalThis.Netlify?.env.get('COMMIT_REF') || ''
  return {
    route: safeSupportRoute(route),
    appVersion: /^[a-f0-9]{40}$/i.test(version)
      ? version.slice(0, 12)
      : 'unknown',
  }
}
export async function enqueueSupport(
  c: SupportClient,
  ticketId: string,
  messageId: string,
  kind: string,
  identity: string | null,
) {
  await c.query(
    'INSERT INTO support_outbox(ticket_id,message_id,kind,target_identity) VALUES($1,$2,$3,$4)',
    [ticketId, messageId, kind, identity],
  )
}
export function privateHeaders() {
  return {
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  }
}
export async function limitedBody(req: Request, maximum: number) {
  const reader = req.body?.getReader()
  if (!reader) throw new SupportError(400, 'A request body is required.')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > maximum) {
      await reader.cancel()
      throw new SupportError(413, 'This request is too large.')
    }
    chunks.push(chunk.value)
  }
  return Buffer.concat(chunks)
}
export function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
