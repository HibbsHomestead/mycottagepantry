// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import {
  boardCsvCell,
  handleFeatureBoard,
} from '../../netlify/lib/feature-board-handler'

const fixture = vi.hoisted(() => ({
  client: null as unknown,
  account: '861552b4-a515-4457-8a25-5622bd105626',
  enabled: true,
  context: 'deploy-preview',
  deleted: false,
  images: new Map<string, ArrayBuffer>(),
}))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: { connect: async () => fixture.client } }),
}))
vi.mock('@netlify/identity', async (original) => {
  const real = await original<typeof import('@netlify/identity')>()
  return {
    ...real,
    getUser: async () => (fixture.account ? { id: fixture.account } : null),
    admin: {
      getUser: async (id: string) => {
        if (fixture.deleted) throw new real.AuthError('Missing in fixture', 404)
        return {
          id,
          confirmedAt: '2026-10-01T00:00:00Z',
          email: 'private-fixture@example.invalid',
        }
      },
    },
  }
})
vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    set: async (id: string, bytes: ArrayBuffer) => {
      fixture.images.set(id, bytes)
    },
    get: async (id: string) => fixture.images.get(id),
    delete: async (id: string) => {
      fixture.images.delete(id)
    },
  }),
}))
vi.mock('../../netlify/lib/runtime-environment', () => ({
  deploymentRuntime: () => ({ context: fixture.context }),
  serverEnvironment: (name: string) =>
    name === 'FEATURE_BOARD_REVIEW_ENABLED' && fixture.enabled ? 'true' : '',
}))
vi.mock('../../netlify/lib/platform-admin-core', async (original) => {
  const real =
    await original<typeof import('../../netlify/lib/platform-admin-core')>()
  return {
    ...real,
    requireAdminOrigin: (request: Request) => {
      if (request.headers.get('x-cp-admin') !== '1')
        throw new real.AdminError(
          403,
          'NOT_ADMIN',
          'Verified platform administrator access is required.',
        )
    },
    requireAdmin: async () => ({
      identity_id: 'fixture-moderator',
      role: 'owner',
      verified_at: new Date(),
      verification_method: 'totp',
    }),
  }
})

const db = new PGlite()
const bakerA = fixture.account
const bakerB = '7fc01f58-de41-44fa-a4ff-821e7218e475'
const origin = 'https://feature-board.example.invalid'
beforeAll(async () => {
  await db.exec(await readFile('db/review/feature-requests.sql', 'utf8'))
  fixture.client = {
    query: (sql: string, params?: unknown[]) => db.query(sql, params),
    release() {},
  }
  await db.exec(
    "CREATE TABLE business_fixture (name text); INSERT INTO business_fixture VALUES ('Unrelated private business')",
  )
})
beforeEach(async () => {
  fixture.account = bakerA
  fixture.deleted = false
  fixture.enabled = true
  fixture.context = 'deploy-preview'
  fixture.images.clear()
  await db.exec(
    `TRUNCATE feature_board.requests,feature_board.limits,feature_board.preferences CASCADE; UPDATE feature_board.settings SET vote_limit=NULL`,
  )
})
afterAll(async () => db.close())

function api(
  query = '',
  command?: unknown,
  authority = false,
  requestOrigin = origin,
) {
  return handleFeatureBoard(
    new Request(origin + '/api/feature-requests?' + query, {
      method: command ? 'POST' : 'GET',
      headers: {
        ...(command
          ? { origin: requestOrigin, 'Content-Type': 'application/json' }
          : {}),
        ...(authority ? { 'x-cp-admin': '1' } : {}),
      },
      ...(command ? { body: JSON.stringify(command) } : {}),
    }),
  )
}
async function command(body: Record<string, unknown>, staff = false) {
  const response = await api(staff ? 'admin=1' : '', body, staff)
  return { status: response.status, ...(await response.json()) }
}
async function submit(title: string, props = {}) {
  const response = await command({
    action: 'submit',
    title,
    category: 'Labels',
    useCase: 'I need to make individual labels for each container.',
    ...props,
  })
  expect(response.status, response.error).toBe(200)
  return response.id as string
}

it('fails closed in production, when disabled, and when signed out', async () => {
  fixture.context = 'production'
  expect(await (await api('availability=1')).json()).toEqual({
    enabled: false,
  })
  expect((await api()).status).toBe(404)
  fixture.context = 'deploy-preview'
  fixture.enabled = false
  expect((await api()).status).toBe(404)
  fixture.enabled = true
  fixture.account = ''
  expect((await api()).status).toBe(401)
})

it('shares only board content, hides opt-out names and identities, and suggests normalized duplicates', async () => {
  const id = await submit('Print a label checklist')
  await submit('Add small label margins', { displayName: 'Baker Fern' })
  fixture.account = bakerB
  expect(
    (
      await command({
        action: 'submit',
        title: 'Print a label CHECKLIST!',
        category: 'Other',
        useCase: 'This is another similar request.',
      })
    ).status,
  ).toBe(409)
  const list = await (
    await api('q=label%20check&category=Labels&sort=top')
  ).json()
  expect(list.requests).toHaveLength(1)
  expect(list.requests[0]).toMatchObject({
    id,
    displayName: 'Anonymous baker',
    own: false,
    editable: false,
  })
  const all = await (await api()).text()
  for (const hidden of [
    bakerA,
    bakerB,
    'private-fixture@example.invalid',
    'Unrelated private business',
    'author_id',
  ])
    expect(all).not.toContain(hidden)
  expect(all).toContain('Baker Fern')
  expect(
    (
      await command({
        action: 'edit',
        id,
        title: 'Someone else’s board title',
        category: 'Labels',
        useCase: 'Replace this label text with mine.',
      })
    ).status,
  ).toBe(403)
  fixture.account = bakerA
  expect(
    (
      await command({
        action: 'edit',
        id,
        title: 'Print a label checklist',
        category: 'Labels',
        useCase: 'I need an updated label checklist.',
        displayName: 'Fern',
      })
    ).status,
  ).toBe(200)
  await command({
    action: 'edit',
    id,
    title: 'Print a label checklist',
    category: 'Labels',
    useCase: 'I need an updated label checklist.',
    displayName: '',
  })
  expect(await (await api(`id=${id}`)).text()).not.toContain('Fern')
})

it('requires moderator authorization and a same-origin write', async () => {
  const id = await submit('Provide a review queue')
  const status = { action: 'status', id, status: 'Planned', note: '' }
  expect((await command(status)).status).toBe(403)
  expect((await command({ action: 'merge', id, targetId: id })).status).toBe(
    403,
  )
  expect((await api('admin=1', status)).status).toBe(403)
  expect(
    (
      await api(
        '',
        { action: 'vote', id, enabled: true },
        false,
        'https://foreign.example.invalid',
      )
    ).status,
  ).toBe(403)
  expect((await api('export=1')).status).toBe(403)
  expect(
    (await command({ ...status, status: 'Not planned' }, true)).status,
  ).toBe(400)
  expect(
    (
      await command(
        {
          ...status,
          status: 'Not planned',
          note: 'Already supported by print presets.',
        },
        true,
      )
    ).status,
  ).toBe(200)
  expect((await (await api(`id=${id}`)).json()).history[0]).toMatchObject({
    status: 'Not planned',
    note: 'Already supported by print presets.',
  })
})

it('toggles votes, respects the limit, and sends a single opted-in status update to voters and followers', async () => {
  const id = await submit('Add paper source presets')
  const other = await submit('Rename printing settings')
  await command({ action: 'voteLimit', limit: 1 }, true)
  await command({ action: 'preferences', notifications: true })
  await command({ action: 'vote', id, enabled: true })
  await command({ action: 'vote', id, enabled: true })
  expect(
    (await command({ action: 'vote', id: other, enabled: true })).status,
  ).toBe(409)
  await command({ action: 'follow', id, enabled: true })
  fixture.account = bakerB
  await command({ action: 'follow', id, enabled: true })
  await command(
    {
      action: 'status',
      id,
      status: 'Under review',
      note: 'Checking supported sizes.',
    },
    true,
  )
  expect((await (await api()).json()).inbox).toEqual([])
  fixture.account = bakerA
  const { inbox } = await (await api()).json()
  expect(inbox).toHaveLength(1)
  expect(inbox[0]).toMatchObject({ requestId: id, status: 'Under review' })
  await command({ action: 'read', eventId: inbox[0].id })
  expect((await (await api()).json()).inbox).toEqual([])
  await command({ action: 'vote', id, enabled: false })
  expect((await (await api(`id=${id}`)).json()).request).toMatchObject({
    voted: false,
    votes: 0,
    following: true,
  })
})

it('merges and redirects without hard-deleting votes, moves comments and reports, and protects moderation details', async () => {
  const primary = await submit('Add a daily label counter')
  const duplicate = await submit('Track daily totals of labels')
  await command({ action: 'vote', id: primary, enabled: true })
  await command({ action: 'vote', id: duplicate, enabled: true })
  await command({
    action: 'comment',
    id: duplicate,
    body: 'This also helps me print a second run.',
  })
  const commentId = (await (await api(`id=${duplicate}`)).json()).comments[0].id
  fixture.account = bakerB
  await command({ action: 'vote', id: duplicate, enabled: true })
  await command({
    action: 'report',
    id: duplicate,
    commentId,
    reason: 'Fixture report reason',
  })
  expect(
    (await command({ action: 'merge', id: duplicate, targetId: primary }, true))
      .status,
  ).toBe(200)
  expect(await (await api(`id=${duplicate}`)).json()).toMatchObject({
    redirected: true,
    request: { id: primary, votes: 2 },
    comments: [{ id: commentId }],
  })
  expect(
    (
      await db.query(
        'SELECT count(*)::int AS total FROM feature_board.participation WHERE request_id=$1 AND voted',
        [duplicate],
      )
    ).rows,
  ).toEqual([{ total: 2 }])
  const board = await (await api('admin=1', undefined, true)).json()
  expect(board.reports[0]).toMatchObject({ requestId: primary, commentId })
  expect(await (await api()).text()).not.toContain('Fixture report reason')
  await command(
    {
      action: 'hide',
      id: primary,
      commentId,
      reason: 'Fixture moderation decision',
    },
    true,
  )
  expect((await (await api(`id=${primary}`)).json()).comments).toEqual([])
})

it('verifies account deletion, strips author data and uploads, and retains reviewed text and vote totals', async () => {
  const jpeg = await sharp({
    create: { width: 8, height: 8, channels: 3, background: 'ivory' },
  })
    .withMetadata({ exif: { IFD0: { Artist: 'Private Fixture' } } })
    .jpeg()
    .toBuffer()
  const id = await submit('Original private reference', {
    displayName: 'Private Alias',
    image: 'data:image/jpeg;base64,' + jpeg.toString('base64'),
  })
  await command({
    action: 'comment',
    id,
    body: 'Remove all of this original comment.',
  })
  await command({ action: 'vote', id, enabled: true })
  fixture.account = bakerB
  await command({ action: 'vote', id, enabled: true })
  expect((await api(`image=${id}`)).headers.get('content-type')).toBe(
    'image/webp',
  )
  expect(
    (await sharp(Buffer.from(fixture.images.get(id)!)).metadata()).exif,
  ).toBeUndefined()
  const anonymize = {
    action: 'anonymize',
    subject: bakerA,
    confirmation: 'Verified account deletion',
    reviewed: [
      {
        id,
        title: 'Add print review reminders',
        useCase: 'Ask me to review a new template before print.',
      },
    ],
  }
  expect((await command(anonymize, true)).status).toBe(409)
  fixture.deleted = true
  expect((await command(anonymize, true)).status).toBe(200)
  fixture.deleted = false
  const detail = await (await api(`id=${id}`)).json()
  expect(detail.request).toMatchObject({
    title: 'Add print review reminders',
    displayName: 'Anonymous baker',
    votes: 2,
    hasImage: false,
  })
  expect(detail.comments[0]).toMatchObject({
    displayName: 'Anonymous baker',
    body: 'Original comment removed for privacy.',
  })
  expect(await (await api(`id=${id}`)).text()).not.toMatch(
    /Private Alias|Original private reference|Remove all of this/,
  )
  expect(fixture.images.has(id)).toBe(false)
  expect((await api(`image=${id}`)).status).toBe(404)
})

it('charges rejected duplicate submissions against the rate limit and guards CSV formulas', async () => {
  await submit('Daily label preparation')
  for (let attempt = 0; attempt < 4; attempt++) {
    expect(
      (
        await command({
          action: 'submit',
          title: 'Daily label preparation',
          category: 'Labels',
          useCase: 'A valid use case for a duplicate.',
        })
      ).status,
    ).toBe(409)
  }
  expect(
    (
      await command({
        action: 'submit',
        title: 'Another valid feature',
        category: 'Labels',
        useCase: 'A valid use case for another request.',
      })
    ).status,
  ).toBe(429)
  expect(boardCsvCell('  =1+2')).toBe('"\'  =1+2"')
  expect(boardCsvCell('Say "hello"')).toBe('"Say ""hello"""')
})
