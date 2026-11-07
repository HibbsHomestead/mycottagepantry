// @vitest-environment node
import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
const runtime = vi.hoisted(() => ({
  session: 'maker-a' as string | null,
  identities: {} as Record<string, any>,
  pool: null as any,
  files: new Map<string, ArrayBuffer>(),
  env: {} as Record<string, string>,
  queries: [] as string[],
  errors: [] as string[],
}))
vi.mock('@netlify/identity', () => ({
  getUser: async () =>
    runtime.session ? { id: runtime.session, roles: ['platform_admin'] } : null,
  admin: {
    getUser: async (id: string) => {
      if (!runtime.identities[id]) throw new Error('Account unavailable')
      return runtime.identities[id]
    },
  },
}))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: runtime.pool }),
}))
// Support workflow unit tests assume an already verified MFA middleware result.
// Real origin/session/MFA denial is covered by platform-admin.test.ts.
vi.mock('../../netlify/lib/platform-admin-legacy', () => ({
  requireLegacyAdmin: vi.fn(async () => {}),
}))
vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    set: async (key: string, bytes: ArrayBuffer) => {
      runtime.files.set(key, bytes)
    },
    get: async (key: string) => runtime.files.get(key) || null,
  }),
}))
import handler from '../../netlify/lib/support-handler'
import {
  dispatchSupportMail,
  supportDeliveryWebhook,
  supportMailText,
} from '../../netlify/lib/support-mail'
import { supportTransaction } from '../../netlify/lib/support-core'
import { safeSupportRoute } from './support'
let db: PGlite
const fetcher = vi.fn()
const business = '10000000-0000-4000-8000-000000000001'
const origin = 'https://mycottagepantry.com'
function post(action: string, data: any, staff = false) {
  return handler(
    new Request(origin + '/api/support' + (staff ? '?view=staff' : ''), {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data }),
    }),
  )
}
function get(query: string) {
  return handler(new Request(origin + '/api/support?' + query))
}
function createData() {
  return {
    subject: 'Recipe import question',
    category: 'Question',
    message: 'How do I review a method?',
    submissionKey: randomUUID(),
    route: '/oven?private=value#Recipes',
  }
}
async function create() {
  const response = await post('create', createData())
  expect(response.status, runtime.errors.join('; ')).toBe(200)
  return response.json()
}
async function asAdmin() {
  runtime.session = 'support-owner'
}
async function upload(
  message: string,
  ticketKey: string,
  bytes: Uint8Array,
  type = 'image/png',
  staff = false,
) {
  const form = new FormData()
  form.set(
    'screenshot',
    new File([new Uint8Array(bytes)], 'screenshot', { type }),
  )
  return handler(
    new Request(
      `${origin}/api/support?upload=1&view=${staff ? 'staff' : 'customer'}&messageId=${message}&submissionKey=${ticketKey}`,
      { method: 'POST', headers: { Origin: origin }, body: form },
    ),
  )
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(
    "CREATE TABLE businesses(id uuid PRIMARY KEY); CREATE TABLE users(identity_id text,business_id uuid,active boolean); INSERT INTO businesses VALUES('10000000-0000-4000-8000-000000000001'); INSERT INTO users VALUES('maker-a','10000000-0000-4000-8000-000000000001',true),('maker-b','10000000-0000-4000-8000-000000000001',true); CREATE ROLE support_test NOLOGIN; GRANT USAGE ON SCHEMA public TO support_test;",
  )
  await db.exec(
    await readFile(
      'netlify/database/migrations/20261103010000_add_platform_support/migration.sql',
      'utf8',
    ),
  )
  await db.exec(
    'GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO support_test; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO support_test;',
  )
  // Serialize pool connections over the embedded engine. Production uses PostgreSQL row/advisory locks.
  let tail = Promise.resolve()
  runtime.pool = {
    connect: async () => {
      const prior = tail
      let release!: () => void
      tail = new Promise<void>((r) => {
        release = r
      })
      await prior
      return {
        release,
        query: async (sql: string, params: any[] = []) => {
          runtime.queries.push(sql)
          if (sql === 'BEGIN') {
            await db.exec('BEGIN; SET LOCAL ROLE support_test;')
            return { rows: [] }
          }
          try {
            return await db.query(sql, params)
          } catch (e) {
            runtime.errors.push((e as Error).message)
            throw e
          }
        },
      }
    },
  }
}, 30000)
afterAll(async () => {
  await db?.close()
})
beforeEach(async () => {
  await db.exec(
    'TRUNCATE support_tickets,support_messages,support_attachments,support_outbox,support_delivery_events,support_audit CASCADE; UPDATE support_settings SET recipient=NULL,pending_recipient=NULL,recipient_verified_at=NULL,from_address=NULL,reply_to=NULL,enabled=false,version=1;',
  )
  runtime.session = 'maker-a'
  runtime.files.clear()
  runtime.env = {}
  runtime.queries = []
  runtime.errors = []
  runtime.identities = Object.fromEntries(
    ['maker-a', 'maker-b', 'maker-c', 'support-owner', 'support-agent'].map(
      (id) => [
        id,
        {
          id,
          email: id + '@example.test',
          confirmedAt: '2026-01-01T00:00:00Z',
          roles:
            id === 'support-owner'
              ? ['platform_admin']
              : id === 'support-agent'
                ? ['platform_support']
                : ['Owner'],
        },
      ],
    ),
  )
  vi.stubGlobal('Netlify', {
    env: { get: (name: string) => runtime.env[name] },
  })
  fetcher.mockReset()
  fetcher.mockRejectedValue(new Error('No network transport in tests'))
  vi.stubGlobal('fetch', fetcher)
})
it('persists a ticket, conversation and deduplicated notification events without business mutations', async () => {
  const value = await create()
  expect(value.ticket.number).toBeGreaterThan(0)
  expect(value.ticket.status).toBe('new')
  expect(value.messages[0].body).toBe('How do I review a method?')
  expect(value.ticket).not.toHaveProperty('requesterEmail')
  expect(value).not.toHaveProperty('notifications')
  const records = await db.query<any>('SELECT * FROM support_tickets')
  expect(records.rows[0].workspace_id).toBe(business)
  expect(records.rows[0].diagnostics).toEqual({
    route: '/oven#Recipes',
    appVersion: 'unknown',
  })
  expect((await db.query('SELECT * FROM support_outbox')).rows).toHaveLength(2)
  expect(
    runtime.queries.some((q) =>
      /\b(ingredients|ledger|journals|sales|expenses|batches)\b/.test(q),
    ),
  ).toBe(false)
  expect(fetcher).not.toHaveBeenCalled()
})
it('deduplicates concurrent duplicate clicks, persists one ticket and rejects a reused key with edited content', async () => {
  const data = createData()
  const responses = await Promise.all([
    post('create', data),
    post('create', data),
  ])
  expect(responses.map((r) => r.status)).toEqual([200, 200])
  const values = await Promise.all(responses.map((r) => r.json()))
  expect(values[0].ticket.id).toBe(values[1].ticket.id)
  expect((await db.query('SELECT * FROM support_tickets')).rows).toHaveLength(1)
  expect((await db.query('SELECT * FROM support_messages')).rows).toHaveLength(
    1,
  )
  expect((await db.query('SELECT * FROM support_outbox')).rows).toHaveLength(2)
  expect(
    (await post('create', { ...data, message: 'Different content' })).status,
  ).toBe(409)
})
it('denies same-workspace peers and other ovens direct ticket, reply and status access', async () => {
  const t = await create()
  for (const id of ['maker-b', 'maker-c']) {
    runtime.session = id
    expect((await get('ticket=' + t.ticket.id)).status).toBe(404)
    expect(
      (
        await post('reply', {
          ticketId: t.ticket.id,
          message: 'Guess',
          submissionKey: randomUUID(),
        })
      ).status,
    ).toBe(404)
    expect(
      (await post('status', { ticketId: t.ticket.id, status: 'resolved' }))
        .status,
    ).toBe(404)
    expect((await (await post('list', {})).json()).tickets).toHaveLength(0)
  }
})
it('requires verified current Identity and ignores oven or cached platform roles', async () => {
  expect((await get('view=staff')).status).toBe(403)
  runtime.identities['maker-a'].userMetadata = { roles: ['platform_admin'] }
  expect((await get('settings=1')).status).toBe(403)
  runtime.identities['maker-a'].confirmedAt = undefined
  expect((await post('create', createData())).status).toBe(403)
  runtime.session = null
  expect((await get('')).status).toBe(401)
  await asAdmin()
  expect((await get('view=staff')).status).toBe(200)
  runtime.identities['support-owner'].roles = []
  expect((await get('view=staff')).status).toBe(403)
})
it('keeps internal notes and their screenshots out of every customer response and notification', async () => {
  const t = await create()
  await asAdmin()
  const note = await (
    await post(
      'reply',
      {
        ticketId: t.ticket.id,
        message: 'Private investigation detail',
        submissionKey: randomUUID(),
        internal: true,
      },
      true,
    )
  ).json()
  const internalId = note.messages.find((m: any) => m.kind === 'internal').id
  const image = await sharp({
    create: { width: 10, height: 10, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer()
  const screenshot = await (
    await upload(internalId, randomUUID(), image, 'image/png', true)
  ).json()
  expect(screenshot.attachmentId).toBeTruthy()
  await expect(
    supportTransaction(
      {
        id: 'support-owner',
        email: 'support-owner@example.test',
        staff: true,
        admin: true,
      },
      (c) =>
        c.query(
          'INSERT INTO support_outbox(ticket_id,message_id,kind,target_identity) VALUES($1,$2,$3,$4)',
          [t.ticket.id, internalId, 'reply', 'maker-a'],
        ),
    ),
  ).rejects.toThrow('Only public support messages can notify')
  expect((await db.query('SELECT * FROM support_outbox')).rows).toHaveLength(2)
  runtime.session = 'maker-a'
  const response = await get('ticket=' + t.ticket.id),
    text = await response.text()
  expect(text).not.toContain('Private investigation')
  expect(text).not.toContain(internalId)
  expect(text).not.toContain(screenshot.attachmentId)
  expect((await get('attachment=' + screenshot.attachmentId)).status).toBe(404)
  expect(
    (await get('view=staff&attachment=' + screenshot.attachmentId)).status,
  ).toBe(403)
  expect(
    (
      await post('reply', {
        ticketId: t.ticket.id,
        message: 'Pretend note',
        submissionKey: randomUUID(),
        internal: true,
      })
    ).status,
  ).toBe(403)
  // Even bypassing the response mapper, real PostgreSQL RLS hides internal notes and attachments.
  const direct = await supportTransaction(
    {
      id: 'maker-a',
      email: 'maker-a@example.test',
      staff: false,
      admin: false,
    },
    (c) =>
      c.query('SELECT * FROM support_messages WHERE ticket_id=$1', [
        t.ticket.id,
      ]),
  )
  expect(direct.rows.every((m) => m.kind !== 'internal')).toBe(true)
})
it('supports staff/customer replies, deduplicates replies, and allows explicit resolve/reopen', async () => {
  const t = await create()
  runtime.session = 'support-agent'
  const data = {
    ticketId: t.ticket.id,
    message: 'Review the Method section.',
    submissionKey: randomUUID(),
    internal: false,
  }
  const result = await (await post('reply', data, true)).json()
  expect(result.ticket.status).toBe('waiting_on_customer')
  expect((await post('reply', data, true)).status).toBe(200)
  expect(
    (await db.query("SELECT * FROM support_outbox WHERE kind='reply'")).rows,
  ).toHaveLength(1)
  expect((await get('view=staff&settings=1')).status).toBe(403)
  const listed = await (
    await post(
      'list',
      { search: 'Recipe', status: 'waiting_on_customer' },
      true,
    )
  ).json()
  expect(listed.tickets).toHaveLength(1)
  runtime.session = 'maker-a'
  expect(
    (
      await (
        await post('status', { ticketId: t.ticket.id, status: 'resolved' })
      ).json()
    ).ticket.status,
  ).toBe('resolved')
  expect(
    (
      await (
        await post('status', { ticketId: t.ticket.id, status: 'new' })
      ).json()
    ).ticket.status,
  ).toBe('new')
  const reply = await (
    await post('reply', {
      ticketId: t.ticket.id,
      message: 'Thank you',
      submissionKey: randomUUID(),
    })
  ).json()
  expect(reply.messages.map((m: any) => m.body)).toEqual([
    'How do I review a method?',
    'Review the Method section.',
    'Thank you',
  ])
})
it('validates and re-encodes screenshots, preserves private downloads and denies guessed attachment IDs', async () => {
  const t = await create(),
    key = randomUUID()
  const jpeg = await sharp({
    create: { width: 20, height: 20, channels: 3, background: 'green' },
  })
    .jpeg()
    .withMetadata()
    .toBuffer()
  const a = await (
    await upload(t.messages[0].id, key, jpeg, 'image/jpeg')
  ).json()
  const duplicate = await (
    await upload(t.messages[0].id, key, jpeg, 'image/jpeg')
  ).json()
  expect(duplicate).toEqual(a)
  expect(runtime.files.size).toBe(1)
  const bytes = [...runtime.files.values()][0],
    metadata = await sharp(Buffer.from(bytes)).metadata()
  expect(metadata.format).toBe('png')
  expect(metadata.exif).toBeUndefined()
  const download = await get('attachment=' + a.attachmentId)
  expect(download.status).toBe(200)
  expect(download.headers.get('Cache-Control')).toBe('private, no-store')
  expect(download.headers.get('Content-Disposition')).toContain('attachment;')
  runtime.session = 'maker-b'
  expect((await get('attachment=' + a.attachmentId)).status).toBe(404)
  runtime.session = 'maker-a'
  expect(
    (
      await upload(
        t.messages[0].id,
        randomUUID(),
        new TextEncoder().encode('<svg><script/></svg>'),
      )
    ).status,
  ).toBe(400)
  expect(
    (
      await upload(
        t.messages[0].id,
        randomUUID(),
        new Uint8Array(2 * 1024 * 1024 + 1),
      )
    ).status,
  ).toBe(400)
})
it('requires same-origin writes and validates client selectors without trusting oven input', async () => {
  const response = await handler(
    new Request(origin + '/api/support', {
      method: 'POST',
      headers: { Origin: 'https://attacker.test' },
      body: '{}',
    }),
  )
  expect(response.status).toBe(403)
  expect(
    (
      await post('create', {
        ...createData(),
        workspaceId: business,
        requesterId: 'maker-b',
      })
    ).status,
  ).toBe(400)
  expect((await get('ticket=guessed')).status).toBe(400)
  expect(safeSupportRoute('/oven?password=private#Settings?key=private')).toBe(
    '/oven#Settings',
  )
  expect(safeSupportRoute('/customer/private/123?account=456')).toBe('/oven')
})
it('persists tickets when email is OFF and never contacts a provider or spends attempts', async () => {
  await create()
  await dispatchSupportMail()
  await dispatchSupportMail()
  expect(fetcher).not.toHaveBeenCalled()
  const outbox = (await db.query<any>('SELECT * FROM support_outbox')).rows
  expect(outbox.map((n) => n.status)).toEqual([
    'blocked_setup',
    'blocked_setup',
  ])
  expect(outbox.every((n) => n.attempts === 0)).toBe(true)
  expect((await db.query('SELECT * FROM support_tickets')).rows).toHaveLength(1)
})
async function mailSetup() {
  runtime.env = {
    SUPPORT_EMAIL_ENABLED: 'true',
    CONTEXT: 'production',
    SUPPORT_EMAIL_ORIGIN: origin,
    SUPPORT_VERIFIED_FROM: 'application@example.test',
    SUPPORT_POSTMARK_SERVER_TOKEN: 'test-fixture',
    SUPPORT_EMAIL_WEBHOOK_SECRET: 'test-fixture-'.repeat(4),
  }
  await db.query(
    "UPDATE support_settings SET recipient=$1,recipient_verified_at=NOW(),from_address='application@example.test',enabled=true",
    ['support-owner@example.test'],
  )
  await db.query(
    "INSERT INTO support_audit(actor_id,action) VALUES('support-owner','notification_recipient_confirmed')",
  )
}
it('never sends from previews, missing sender approval or an unconfirmed recipient', async () => {
  await create()
  await mailSetup()
  runtime.env.CONTEXT = 'deploy-preview'
  await dispatchSupportMail()
  expect(fetcher).not.toHaveBeenCalled()
  runtime.env.CONTEXT = 'production'
  delete runtime.env.SUPPORT_VERIFIED_FROM
  await dispatchSupportMail()
  expect(fetcher).not.toHaveBeenCalled()
  runtime.env.SUPPORT_VERIFIED_FROM = 'application@example.test'
  await db.exec('UPDATE support_settings SET recipient_verified_at=NULL')
  await dispatchSupportMail()
  expect(fetcher).not.toHaveBeenCalled()
})
it('keeps ambiguous failures saved and avoids automatic retries and sensitive email contents', async () => {
  await create()
  await mailSetup()
  await dispatchSupportMail()
  expect(fetcher).toHaveBeenCalledTimes(2)
  await dispatchSupportMail()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(
    (await db.query<any>('SELECT status FROM support_outbox')).rows.every(
      (n) => n.status === 'unknown',
    ),
  ).toBe(true)
  const body = JSON.parse(fetcher.mock.calls[0][1].body)
  expect(body.From).toBe('application@example.test')
  expect(body.TextBody).toContain('Reply in Cottage Pantry')
  expect(body.TextBody).not.toContain('How do I review')
  expect(body.Subject).not.toContain('Recipe import question')
  expect(supportMailText('reply', 123, origin + '/support')).not.toContain(
    'Private investigation',
  )
  expect((await db.query('SELECT * FROM support_tickets')).rows).toHaveLength(1)
})
it('tracks accepted separately from delivered, authenticates and deduplicates provider events', async () => {
  await create()
  await mailSetup()
  let sequence = 0
  fetcher.mockImplementation(async () =>
    Response.json({ ErrorCode: 0, MessageID: 'provider-' + ++sequence }),
  )
  await dispatchSupportMail()
  const outbox = (
    await db.query<any>(
      'SELECT * FROM support_outbox ORDER BY provider_message_id',
    )
  ).rows
  expect(outbox.every((n) => n.status === 'accepted')).toBe(true)
  const body = {
    RecordType: 'Delivery',
    MessageID: outbox[0].provider_message_id,
    DeliveredAt: '2026-10-31T00:00:00Z',
    Metadata: { supportNotificationId: outbox[0].id },
  }
  function event(auth = true) {
    return supportDeliveryWebhook(
      new Request(origin + '/api/support-delivery', {
        method: 'POST',
        headers: auth
          ? {
              Authorization:
                'Basic ' +
                Buffer.from(
                  'support:' + runtime.env.SUPPORT_EMAIL_WEBHOOK_SECRET,
                ).toString('base64'),
            }
          : {},
        body: JSON.stringify(body),
      }),
    )
  }
  expect((await event(false)).status).toBe(401)
  expect((await event()).status).toBe(200)
  expect((await event()).status).toBe(200)
  expect(
    (
      await db.query<any>('SELECT status FROM support_outbox WHERE id=$1', [
        outbox[0].id,
      ])
    ).rows[0].status,
  ).toBe('delivered')
  expect(
    (await db.query('SELECT * FROM support_delivery_events')).rows,
  ).toHaveLength(1)
})
it('bounds retries for definitive rate-limit rejections and never changes stock or accounting', async () => {
  await create()
  await mailSetup()
  fetcher.mockResolvedValue(new Response('', { status: 429 }))
  for (let i = 0; i < 5; i++) {
    await db.exec(
      "UPDATE support_outbox SET retry_at=NOW()-INTERVAL '1 minute'",
    )
    await dispatchSupportMail()
  }
  expect(fetcher).toHaveBeenCalledTimes(6)
  expect(
    (await db.query<any>('SELECT attempts FROM support_outbox')).rows.every(
      (n) => n.attempts === 3,
    ),
  ).toBe(true)
  expect(
    runtime.queries.some((q) =>
      /\b(ingredients|ledger|journals|sales|expenses|batches)\b/.test(q),
    ),
  ).toBe(false)
})
it('stages and verifies a changed recipient without sending email or exposing settings to customers', async () => {
  await asAdmin()
  let response = await (
    await post(
      'saveSettings',
      {
        recipient: 'support-owner@example.test',
        fromAddress: '',
        replyTo: '',
        enabled: false,
        version: 1,
      },
      true,
    )
  ).json()
  expect(response.settings.pendingRecipient).toBe('support-owner@example.test')
  expect(response.settings.recipientVerified).toBe(false)
  expect(
    (
      await post(
        'confirmRecipient',
        {
          version: response.settings.version,
          confirmation: 'someone@example.test',
        },
        true,
      )
    ).status,
  ).toBe(403)
  response = await (
    await post(
      'confirmRecipient',
      {
        version: response.settings.version,
        confirmation: 'support-owner@example.test',
      },
      true,
    )
  ).json()
  expect(response.settings.recipientVerified).toBe(true)
  expect(response.settings.enabled).toBe(false)
  expect(fetcher).not.toHaveBeenCalled()
  response = await (
    await post(
      'saveSettings',
      {
        recipient: 'another@example.test',
        fromAddress: '',
        replyTo: '',
        enabled: true,
        version: response.settings.version,
      },
      true,
    )
  ).json()
  expect(response.settings.recipient).toBe('')
  expect(response.settings.recipientVerified).toBe(false)
  expect(response.settings.enabled).toBe(false)
  runtime.session = 'maker-a'
  expect((await get('settings=1')).status).toBe(403)
})
it('enforces customer rate limits, preserves duplicate retries at capacity and forces RLS on all support tables', async () => {
  const first = createData()
  expect((await post('create', first)).status).toBe(200)
  for (let n = 0; n < 9; n++)
    expect((await post('create', createData())).status).toBe(200)
  expect((await post('create', createData())).status).toBe(429)
  expect((await post('create', first)).status).toBe(200)
  const policies = await db.query<any>(
    "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('support_tickets','support_messages','support_attachments','support_settings','support_outbox','support_delivery_events','support_audit')",
  )
  expect(policies.rows).toHaveLength(7)
  expect(
    policies.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity),
  ).toBe(true)
  const raw = await supportTransaction(
    {
      id: 'maker-b',
      email: 'maker-b@example.test',
      staff: false,
      admin: false,
    },
    async (c) => ({
      tickets: (await c.query('SELECT * FROM support_tickets')).rows,
      outbox: (await c.query('SELECT * FROM support_outbox')).rows,
      settings: (await c.query('SELECT * FROM support_settings')).rows,
    }),
  )
  expect(raw).toEqual({ tickets: [], outbox: [], settings: [] })
})
it('handles non-JSON provider errors and suppresses future notices after a verified bounce', async () => {
  const t = await create()
  await mailSetup()
  fetcher.mockResolvedValue(
    new Response('<html>Gateway unavailable</html>', { status: 502 }),
  )
  await dispatchSupportMail()
  expect(
    (await db.query<any>('SELECT status FROM support_outbox')).rows.every(
      (n) => n.status === 'unknown',
    ),
  ).toBe(true)
  await db.exec(
    "UPDATE support_outbox SET status='pending',attempts=0,retry_at=NOW()-INTERVAL '1 minute'",
  )
  let count = 0
  fetcher.mockImplementation(async () =>
    Response.json({ ErrorCode: 0, MessageID: 'bounce-test-' + ++count }),
  )
  await dispatchSupportMail()
  const notification = (
    await db.query<any>(
      "SELECT * FROM support_outbox WHERE kind='acknowledgment'",
    )
  ).rows[0]
  const event = {
    RecordType: 'Bounce',
    MessageID: notification.provider_message_id,
    ID: 42,
    BouncedAt: '2026-10-31T00:00:00Z',
  }
  const response = await supportDeliveryWebhook(
    new Request(origin + '/api/support-delivery', {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(
            'support:' + runtime.env.SUPPORT_EMAIL_WEBHOOK_SECRET,
          ).toString('base64'),
      },
      body: JSON.stringify(event),
    }),
  )
  expect(response.status).toBe(200)
  await asAdmin()
  await post(
    'reply',
    {
      ticketId: t.ticket.id,
      message: 'A safe in-app answer',
      submissionKey: randomUUID(),
    },
    true,
  )
  const before = fetcher.mock.calls.length
  await dispatchSupportMail()
  expect(fetcher).toHaveBeenCalledTimes(before)
  expect(
    (
      await db.query<any>(
        "SELECT status FROM support_outbox WHERE kind='reply'",
      )
    ).rows[0].status,
  ).toBe('suppressed')
})
