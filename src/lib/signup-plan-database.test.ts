// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Context } from '@netlify/functions'
import type { RegistrationClient } from '../../netlify/lib/registration-core'
const runtime = vi.hoisted(() => ({
  client: null as RegistrationClient | null,
  session: null as {
    id: string
    email: string
    confirmedAt?: string
    roles: string[]
    signupIntentId?: string
  } | null,
}))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: { connect: async () => runtime.client } }),
}))
vi.mock('../../netlify/lib/verified-session', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../netlify/lib/verified-session')
  >()),
  verifiedSession: async () => runtime.session,
}))
import handler from '../../netlify/functions/signup-plan.mts'
const db = new PGlite()
const origin = 'https://signup.example.test'
const request = (body: unknown, cookie?: string, from = origin) =>
  handler(
    new Request(origin + '/api/signup-plan', {
      method: 'POST',
      headers: { Origin: from, ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    }),
    { ip: '192.0.2.42' } as Context,
  )
beforeAll(async () => {
  await db.exec(
    'CREATE TABLE registration_limits(key text PRIMARY KEY,count integer,expires_at timestamptz)',
  )
  await db.exec(
    "CREATE TABLE registration_drafts(plan_id text CONSTRAINT registration_drafts_plan CHECK(plan_id IN ('free','mixing-bowl','bakers-bench','cottage-kitchen')))",
  )
  await db.exec(
    await readFile(
      new URL(
        '../../netlify/database/migrations/20261119010000_add_signup_plan_intents/migration.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  runtime.client = {
    query: (sql: string, values?: unknown[]) => db.query(sql, values),
    release() {},
  }
})
beforeEach(() => {
  runtime.session = null
})
afterAll(async () => {
  await db.close()
})
it.each([
  ['free', 0],
  ['mixing-bowl', 10],
  ['bakers-bench', 20],
  ['cottage-kitchen', 30],
  ['cottage-mercantile', 40],
])(
  'stores %s as a preference with server-owned pricing and no access assignment',
  async (planId, monthlyUsd) => {
    const result = await request({ action: 'prepare', planId })
    expect(result.status).toBe(200)
    const data = await result.json()
    expect(data.selection).toMatchObject({
      planId,
      monthlyUsd,
      currency: 'USD',
      interval: 'month',
      paidActivationAvailable: false,
    })
    expect(result.headers.get('set-cookie')).toMatch(
      /HttpOnly; Secure; SameSite=Lax/,
    )
    expect(
      (
        await db.query(
          'SELECT identity_id,plan_id FROM signup_plan_intents WHERE id=$1',
          [data.intentId],
        )
      ).rows[0],
    ).toEqual({ identity_id: null, plan_id: planId })
    // No billing, workspace or subscription tables exist in this fixture. Saving
    // preferences cannot depend on or create any of those resources.
  },
)
it('rejects browser prices, cadence, invalid IDs and cross-origin writes', async () => {
  expect(
    (await request({ action: 'prepare', planId: 'mixing-bowl', price: 1 }))
      .status,
  ).toBe(400)
  expect(
    (
      await request({
        action: 'prepare',
        planId: 'mixing-bowl',
        interval: 'year',
      })
    ).status,
  ).toBe(400)
  expect((await request({ action: 'prepare', planId: '$40' })).status).toBe(400)
  expect(
    (
      await request(
        { action: 'prepare', planId: 'free' },
        undefined,
        'https://attacker.invalid',
      )
    ).status,
  ).toBe(403)
})
it('requires a verified identity to resume', async () => {
  expect((await request({ action: 'resume' })).status).toBe(401)
  runtime.session = {
    id: 'unverified',
    email: 'test@example.invalid',
    roles: [],
  }
  expect((await request({ action: 'resume' })).status).toBe(403)
})
it('resumes after verification in another browser, retains later choices and never substitutes Free', async () => {
  const prepared = await (
    await request({ action: 'prepare', planId: 'cottage-mercantile' })
  ).json()
  runtime.session = {
    id: 'verified-owner',
    email: 'test@example.invalid',
    confirmedAt: '2026-01-01',
    roles: [],
    signupIntentId: prepared.intentId,
  }
  const resumed = await (await request({ action: 'resume' })).json()
  expect(resumed.selection.planId).toBe('cottage-mercantile')
  const changed = await (
    await request({ action: 'resume', planId: 'cottage-kitchen' })
  ).json()
  expect(changed.selection.planId).toBe('cottage-kitchen')
  expect(
    (await (await request({ action: 'resume' })).json()).selection.planId,
  ).toBe('cottage-kitchen')
  const before = (
    await db.query('SELECT id FROM signup_plan_intents WHERE identity_id=$1', [
      'verified-owner',
    ])
  ).rows.length
  await request({ action: 'resume', planId: 'cottage-kitchen' })
  expect(
    (
      await db.query(
        'SELECT id FROM signup_plan_intents WHERE identity_id=$1',
        ['verified-owner'],
      )
    ).rows,
  ).toHaveLength(before)
  runtime.session = { ...runtime.session, id: 'different-account' }
  expect((await request({ action: 'resume' })).status).toBe(409)
})
it('reports expired anonymous selections without creating an alternate choice', async () => {
  const data = await (
    await request({ action: 'prepare', planId: 'mixing-bowl' })
  ).json()
  await db.query(
    "UPDATE signup_plan_intents SET expires_at=now()-interval '1 hour' WHERE id=$1",
    [data.intentId],
  )
  runtime.session = {
    id: 'expired-intent-owner',
    email: 'test@example.invalid',
    confirmedAt: '2026-01-01',
    roles: [],
    signupIntentId: data.intentId,
  }
  const result = await request({ action: 'resume' })
  expect(result.status).toBe(409)
  expect((await result.json()).code).toBe('PLAN_SELECTION_EXPIRED')
  expect(
    (
      await db.query(
        'SELECT id FROM signup_plan_intents WHERE identity_id=$1',
        [runtime.session.id],
      )
    ).rows,
  ).toHaveLength(0)
})

it('forces row isolation for account readers and rejects cross-account updates', async () => {
  await db.exec(
    'CREATE ROLE signup_plan_reader; GRANT SELECT,INSERT,UPDATE ON signup_plan_intents TO signup_plan_reader;',
  )
  await db.exec('BEGIN; SET LOCAL ROLE signup_plan_reader;')
  try {
    await db.query("SELECT set_config('app.identity_id','verified-owner',true)")
    const rows = (
      await db.query<{ identity_id: string }>(
        'SELECT identity_id FROM signup_plan_intents',
      )
    ).rows
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.identity_id === 'verified-owner')).toBe(true)
    expect(
      (
        await db.query(
          "UPDATE signup_plan_intents SET plan_id='free' WHERE identity_id='expired-intent-owner' RETURNING id",
        )
      ).rows,
    ).toHaveLength(0)
  } finally {
    await db.exec('ROLLBACK')
  }
})
