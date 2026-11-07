import { z } from 'zod'
import { requireLegacyAdmin } from './platform-admin-legacy'
import { AdminError } from './platform-admin-core'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { getStore } from '@netlify/blobs'
import { ticketInput, replyInput, supportStatuses } from '../../src/lib/support'
import {
  supportActor,
  supportTransaction,
  getTicket,
  ticketView,
  supportAudit,
  supportRateLimit,
  supportDiagnostics,
  enqueueSupport,
  SupportError,
  privateHeaders,
  limitedBody,
  requireSupportStaff,
  type SupportClient,
  type SupportActor,
} from './support-core'
import {
  supportSettingsView,
  saveSupportSettings,
  confirmSupportRecipient,
} from './support-settings'
const uuid = z.string().uuid()
const viewInput = z.enum(['customer', 'staff'])
function store() {
  return getStore({
    name: 'support-screenshots-private',
    consistency: 'strong',
  })
}
async function detail(
  c: SupportClient,
  actor: SupportActor,
  id: string,
  staff: boolean,
) {
  const ticket = await getTicket(c, actor, id, staff)
  const { rows } = await c.query(
    "SELECT id,kind,body,author_id,created_at FROM support_messages WHERE ticket_id=$1 AND ($2::boolean OR kind<>'internal') ORDER BY created_at,id",
    [id, staff],
  )
  const attachments = await c.query(
    "SELECT a.id,a.message_id,a.byte_size FROM support_attachments a JOIN support_messages m ON m.id=a.message_id WHERE m.ticket_id=$1 AND ($2::boolean OR m.kind<>'internal')",
    [id, staff],
  )
  const notifications = staff
    ? (
        await c.query(
          'SELECT id,kind,status,attempts,error_code FROM support_outbox WHERE ticket_id=$1 ORDER BY created_at',
          [id],
        )
      ).rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        attempts: r.attempts,
        errorCode: r.error_code,
      }))
    : undefined
  return {
    ticket: ticketView(ticket, staff),
    messages: rows.map((m) => ({
      id: m.id,
      kind: m.kind,
      body: m.body,
      createdAt: m.created_at,
      own: m.author_id === actor.id,
      attachments: attachments.rows
        .filter((a) => a.message_id === m.id)
        .map((a) => ({ id: a.id, byteSize: a.byte_size })),
    })),
    ...(staff ? { notifications } : {}),
  }
}
async function createTicket(
  c: SupportClient,
  actor: SupportActor,
  raw: unknown,
) {
  const data = ticketInput.parse(raw)
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'support:' + actor.id,
  ])
  const prior = await c.query(
    'SELECT * FROM support_tickets WHERE requester_id=$1 AND submission_key=$2',
    [actor.id, data.submissionKey],
  )
  if (prior.rows[0]) {
    const original = await c.query(
      'SELECT body FROM support_messages WHERE ticket_id=$1 ORDER BY created_at,id LIMIT 1',
      [prior.rows[0].id],
    )
    if (
      prior.rows[0].subject !== data.subject ||
      prior.rows[0].category !== data.category ||
      original.rows[0]?.body !== data.message
    )
      throw new SupportError(
        409,
        'This submission was already saved. Open the existing ticket before sending different content.',
      )
    return detail(c, actor, prior.rows[0].id, false)
  }
  await supportRateLimit(c, actor, true)
  const membership = await c.query(
    'SELECT business_id FROM users WHERE identity_id=$1 AND active=true LIMIT 1',
    [actor.id],
  )
  const ticketId = randomUUID(),
    messageId = randomUUID()
  await c.query(
    'INSERT INTO support_tickets(id,requester_id,requester_email,workspace_id,subject,category,submission_key,diagnostics) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      ticketId,
      actor.id,
      actor.email,
      membership.rows[0]?.business_id || null,
      data.subject,
      data.category,
      data.submissionKey,
      JSON.stringify(supportDiagnostics(data.route)),
    ],
  )
  await c.query(
    "INSERT INTO support_messages(id,ticket_id,author_id,kind,body,submission_key) VALUES($1,$2,$3,'customer',$4,$5)",
    [messageId, ticketId, actor.id, data.message, data.submissionKey],
  )
  await enqueueSupport(c, ticketId, messageId, 'new_ticket', null)
  await enqueueSupport(c, ticketId, messageId, 'acknowledgment', actor.id)
  await supportAudit(c, actor, 'ticket_created', ticketId)
  return detail(c, actor, ticketId, false)
}
async function reply(
  c: SupportClient,
  actor: SupportActor,
  raw: unknown,
  staff: boolean,
) {
  const data = replyInput.parse(raw)
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'support:' + actor.id,
  ])
  const ticket = await getTicket(c, actor, data.ticketId, staff, true)
  if (data.internal && !staff)
    throw new SupportError(
      403,
      'Private notes require the platform support inbox.',
    )
  const kind = data.internal ? 'internal' : staff ? 'support' : 'customer'
  const prior = await c.query(
    'SELECT id,kind,body FROM support_messages WHERE ticket_id=$1 AND author_id=$2 AND submission_key=$3',
    [ticket.id, actor.id, data.submissionKey],
  )
  if (prior.rows[0]) {
    if (prior.rows[0].kind !== kind || prior.rows[0].body !== data.message)
      throw new SupportError(
        409,
        'This reply was already saved with different content. Reload the conversation.',
      )
    return detail(c, actor, ticket.id, staff)
  }
  await supportRateLimit(c, actor, false)
  const id = randomUUID()
  await c.query(
    'INSERT INTO support_messages(id,ticket_id,author_id,kind,body,submission_key) VALUES($1,$2,$3,$4,$5,$6)',
    [id, ticket.id, actor.id, kind, data.message, data.submissionKey],
  )
  await c.query(
    'UPDATE support_tickets SET status=$1,updated_at=NOW() WHERE id=$2',
    [
      kind === 'internal'
        ? ticket.status
        : staff
          ? 'waiting_on_customer'
          : ticket.status === 'resolved'
            ? 'new'
            : 'in_progress',
      ticket.id,
    ],
  )
  if (kind === 'support')
    await enqueueSupport(c, ticket.id, id, 'reply', ticket.requester_id)
  if (kind === 'customer')
    await enqueueSupport(c, ticket.id, id, 'customer_reply', null)
  await supportAudit(
    c,
    actor,
    kind === 'internal' ? 'private_note_added' : 'reply_added',
    ticket.id,
  )
  return detail(c, actor, ticket.id, staff)
}
async function attachment(
  req: Request,
  c: SupportClient,
  actor: SupportActor,
  staff: boolean,
  url: URL,
) {
  const messageId = uuid.parse(url.searchParams.get('messageId')),
    submission = uuid.parse(url.searchParams.get('submissionKey'))
  const message = (
    await c.query(
      "SELECT m.* FROM support_messages m WHERE m.id=$1 AND ($2::boolean OR m.kind<>'internal')",
      [messageId, staff],
    )
  ).rows[0]
  if (!message || message.author_id !== actor.id)
    throw new SupportError(404, 'Message not found.')
  await getTicket(c, actor, message.ticket_id, staff, true)
  const previous = await c.query(
    'SELECT id FROM support_attachments WHERE message_id=$1 AND submission_key=$2',
    [messageId, submission],
  )
  if (previous.rows[0]) return { attachmentId: previous.rows[0].id }
  const count = (
    await c.query(
      'SELECT COUNT(*)::int AS count FROM support_attachments WHERE message_id=$1',
      [messageId],
    )
  ).rows[0].count
  const total = (
    await c.query(
      'SELECT COUNT(*)::int AS count FROM support_attachments a JOIN support_messages m ON m.id=a.message_id WHERE m.ticket_id=$1',
      [message.ticket_id],
    )
  ).rows[0].count
  if (count >= 3 || total >= 20)
    throw new SupportError(
      409,
      'Screenshot limit reached (3 per message, 20 per ticket).',
    )
  const bytes = await limitedBody(req, 2 * 1024 * 1024 + 16384)
  const data = await new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: bytes,
  }).formData()
  const file = data.get('screenshot')
  if (
    !(file instanceof File) ||
    file.size < 1 ||
    file.size > 2 * 1024 * 1024 ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
  )
    throw new SupportError(
      400,
      'Choose a PNG, JPEG or WebP screenshot up to 2 MB.',
    )
  let normalized: Buffer
  try {
    const input = Buffer.from(await file.arrayBuffer())
    const image = sharp(input, {
      limitInputPixels: 16_777_216,
      animated: false,
      failOn: 'warning',
    })
    const meta = await image.metadata()
    if (
      !['png', 'jpeg', 'webp'].includes(meta.format || '') ||
      !meta.width ||
      !meta.height ||
      meta.width > 4096 ||
      meta.height > 4096 ||
      (meta.pages || 1) > 1
    )
      throw new Error('unsupported')
    normalized = await image.rotate().png().toBuffer()
    if (normalized.length > 4 * 1024 * 1024) throw new Error('too large')
  } catch {
    throw new SupportError(
      400,
      'This screenshot cannot be safely read. Use a static PNG, JPEG or WebP, at most 4096 × 4096 pixels.',
    )
  }
  const id = randomUUID(),
    key = `${message.ticket_id}/${messageId}/${id}.png`
  await store().set(key, new Uint8Array(normalized).buffer)
  await c.query(
    'INSERT INTO support_attachments(id,message_id,object_key,byte_size,submission_key) VALUES($1,$2,$3,$4,$5)',
    [id, messageId, key, normalized.length, submission],
  )
  await supportAudit(c, actor, 'screenshot_added', message.ticket_id)
  return { attachmentId: id }
}
export default async function supportHandler(req: Request) {
  const headers = privateHeaders()
  try {
    if (!['GET', 'POST'].includes(req.method))
      return Response.json(
        { error: 'Method not allowed.' },
        { status: 405, headers },
      )
    if (
      req.method === 'POST' &&
      (!req.headers.get('origin') ||
        req.headers.get('origin') !== new URL(req.url).origin)
    )
      throw new SupportError(
        403,
        'Use the Cottage Pantry app to submit this request.',
      )
    const actor = await supportActor(),
      url = new URL(req.url),
      staff =
        viewInput.parse(url.searchParams.get('view') || 'customer') === 'staff'
    if (staff) requireSupportStaff(actor)
    if (staff || url.searchParams.has('settings'))
      await requireLegacyAdmin(req, actor.id)
    if (req.method === 'GET' && url.searchParams.has('attachment')) {
      const response = await supportTransaction(actor, async (c) => {
        const id = uuid.parse(url.searchParams.get('attachment'))
        const a = (
          await c.query(
            "SELECT a.*,m.ticket_id FROM support_attachments a JOIN support_messages m ON m.id=a.message_id WHERE a.id=$1 AND ($2::boolean OR m.kind<>'internal')",
            [id, staff],
          )
        ).rows[0]
        if (!a) throw new SupportError(404, 'Screenshot not found.')
        await getTicket(c, actor, a.ticket_id, staff)
        const bytes = await store().get(a.object_key, { type: 'arrayBuffer' })
        if (!bytes) throw new SupportError(404, 'Screenshot not found.')
        await supportAudit(c, actor, 'screenshot_downloaded', a.ticket_id)
        return new Response(bytes, {
          headers: {
            ...headers,
            'Content-Type': 'image/png',
            'Content-Disposition':
              'attachment; filename="support-screenshot.png"',
            'Content-Security-Policy': "default-src 'none'; sandbox",
          },
        })
      })
      return response
    }
    const result = await supportTransaction(actor, async (c) => {
      if (req.method === 'GET') {
        if (url.searchParams.has('settings'))
          return { settings: await supportSettingsView(c, actor) }
        if (url.searchParams.has('ticket')) {
          const id = uuid.parse(url.searchParams.get('ticket'))
          const value = await detail(c, actor, id, staff)
          if (staff) await supportAudit(c, actor, 'ticket_viewed', id)
          return value
        }
        return { staff: actor.staff, admin: actor.admin }
      }
      if (url.searchParams.has('upload'))
        return attachment(req, c, actor, staff, url)
      let raw
      try {
        raw = JSON.parse((await limitedBody(req, 24000)).toString('utf8'))
      } catch (e) {
        if (e instanceof SupportError) throw e
        throw new SupportError(400, 'Enter a valid support request.')
      }
      const action = z.string().parse(raw.action)
      if (action === 'saveSettings' || action === 'confirmRecipient')
        await requireLegacyAdmin(req, actor.id)
      if (action === 'create') return createTicket(c, actor, raw.data)
      if (action === 'reply') return reply(c, actor, raw.data, staff)
      if (action === 'list') {
        const data = z
          .object({
            search: z.string().max(100).default(''),
            status: z
              .enum([
                'all',
                ...(Object.keys(supportStatuses) as [string, ...string[]]),
              ])
              .default('all'),
            offset: z.number().int().min(0).max(10000).default(0),
          })
          .parse(raw.data || {})
        const { rows } = await c.query(
          "SELECT * FROM support_tickets WHERE ($1::boolean OR requester_id=$2) AND ($3='all' OR status=$3) AND ($4='' OR strpos(lower(subject),lower($4))>0 OR number::text=$4 OR ($1::boolean AND strpos(lower(requester_email),lower($4))>0)) ORDER BY updated_at DESC,id LIMIT 51 OFFSET $5",
          [staff, actor.id, data.status, data.search, data.offset],
        )
        return {
          tickets: rows.slice(0, 50).map((t) => ticketView(t, staff)),
          hasMore: rows.length > 50,
        }
      }
      if (action === 'status') {
        const data = z
          .object({
            ticketId: uuid,
            status: z.enum([
              'new',
              'in_progress',
              'waiting_on_customer',
              'resolved',
            ]),
          })
          .parse(raw.data)
        const t = await getTicket(c, actor, data.ticketId, staff, true)
        if (
          !staff &&
          !(
            data.status === 'resolved' ||
            (t.status === 'resolved' && data.status === 'new')
          )
        )
          throw new SupportError(403, 'You can resolve or reopen your ticket.')
        await c.query(
          'UPDATE support_tickets SET status=$1,updated_at=NOW() WHERE id=$2',
          [data.status, t.id],
        )
        await supportAudit(c, actor, 'status_' + data.status, t.id)
        return detail(c, actor, t.id, staff)
      }
      if (action === 'saveSettings')
        return { settings: await saveSupportSettings(c, actor, raw.data) }
      if (action === 'confirmRecipient')
        return {
          settings: await confirmSupportRecipient(
            c,
            actor,
            z.number().int().parse(raw.data.version),
            z.string().parse(raw.data.confirmation),
          ),
        }
      throw new SupportError(400, 'Unsupported support operation.')
    })
    return Response.json(result, { headers })
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof SupportError || e instanceof AdminError
            ? e.message
            : e instanceof z.ZodError
              ? 'Check the required fields and try again.'
              : 'Support is temporarily unavailable. Your previous tickets remain saved. Please try again later.',
      },
      {
        status:
          e instanceof SupportError || e instanceof AdminError
            ? e.status
            : e instanceof z.ZodError
              ? 400
              : 503,
        headers,
      },
    )
  }
}
