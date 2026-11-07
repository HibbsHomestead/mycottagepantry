// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
const runtime = vi.hoisted(() => ({
  client: null as any,
  session: null as any,
  current: null as any,
  values: {} as Record<string, string>,
}))
vi.mock('@netlify/identity', () => ({
  getUser: async () => runtime.session,
  admin: { getUser: async () => runtime.current },
}))
vi.mock('../../netlify/lib/verified-session', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../netlify/lib/verified-session')
  >()),
  verifiedSession: async () => (runtime.session ? runtime.current : null),
  selectedWorkspace: (request: Request) =>
    request.headers.get('cookie')?.match(/cp_selected_workspace=([^;]+)/)?.[1],
}))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: { connect: async () => runtime.client } }),
}))
// Registration workflow tests assume the separately tested platform MFA gate.
vi.mock('../../netlify/lib/platform-admin-legacy', () => ({
  requireLegacyAdmin: vi.fn(async () => {}),
}))
import {
  registrationActor,
  saveRegistrationDraft,
  acceptFixturePolicy,
  provisionTestWorkspace,
  billingView,
  currentMembership,
  type RegistrationActor,
} from '../../netlify/lib/registration-core'
import {
  assertRegistrationQuota,
  assertFullFreeStockCoverage,
} from '../../netlify/lib/registration-usage'
import registration from '../../netlify/functions/registration.mts'
import webhook from '../../netlify/functions/square-sandbox-webhook.mts'
import identityHook from '../../netlify/functions/identity.mts'
import { createHmac } from 'node:crypto'
const db = new PGlite()
const profile = {
  name: 'Juniper Crumb Kitchen',
  country: 'US',
  timezone: 'America/Chicago',
  currency: 'USD',
  measurements: 'metric',
  phone: '',
  website: '',
  description: '',
  focus: 'baked',
}
const actor: RegistrationActor = {
  id: 'fixture-admin',
  email: 'fixture@example.invalid',
  privateTest: true,
  platformAdmin: true,
}
beforeAll(async () => {
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root))
    await db.exec(
      await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
    )
  runtime.client = {
    query: (sql: string, values?: any[]) => db.query(sql, values),
    release() {},
  }
}, 30000)
afterAll(async () => {
  await db.close()
  vi.unstubAllGlobals()
})
beforeEach(async () => {
  await db.exec('TRUNCATE registration_policies RESTART IDENTITY')
  runtime.values = {
    CONTEXT: 'deploy-preview',
    REGISTRATION_PRIVATE_TESTS_ENABLED: 'true',
  }
  runtime.session = { id: actor.id }
  runtime.current = {
    id: actor.id,
    email: actor.email,
    confirmedAt: '2026-01-01T00:00:00Z',
    roles: ['platform_admin'],
  }
  vi.stubGlobal('Netlify', {
    env: { get: (name: string) => runtime.values[name] },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Real provider requests forbidden')
    }),
  )
})

it('rejects invented acceptance and requires current consent only when documents are published', async () => {
  runtime.current = {
    id: 'public-policy-account',
    email: 'public@example.invalid',
    confirmedAt: '2026-01-01',
    roles: [],
  }
  runtime.values.CONTEXT = 'production'
  const make = (consent: unknown) =>
    registration(
      new Request('https://example.test/api/registration?view=free', {
        method: 'POST',
        headers: { origin: 'https://example.test' },
        body: JSON.stringify({
          action: 'createFreeWorkspace',
          profile,
          consent,
        }),
      }),
    )
  const blocked = await make({ accepted: true, revision: 'unapproved' })
  expect(blocked.status).toBe(409)
  expect((await blocked.json()).code).toBe('POLICY_CHANGED')
  expect(
    (
      await db.query('SELECT id FROM businesses WHERE identity_owner=$1', [
        runtime.current.id,
      ])
    ).rows,
  ).toHaveLength(0)
  await db.query(
    'INSERT INTO registration_policies(revision,terms,privacy,published_by) VALUES($1,$2,$3,$4)',
    [
      'synthetic-approved-v1',
      'Synthetic Terms for this isolated test only.',
      'Synthetic Privacy for this isolated test only.',
      'fixture-owner',
    ],
  )
  expect((await make(undefined)).status).toBe(409)
  expect((await make({ accepted: true, revision: 'old' })).status).toBe(409)
  expect(
    (await make({ accepted: false, revision: 'synthetic-approved-v1' })).ok,
  ).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})

it.each([false, true])(
  'creates exactly one free oven with published policies=%s, without touching billing or fixture records',
  async (published) => {
    runtime.current = {
      id: 'public-free-owner-' + published,
      email: 'free@example.invalid',
      confirmedAt: '2026-01-01',
      roles: [],
    }
    runtime.values.CONTEXT = 'production'
    if (published)
      await db.query(
        'INSERT INTO registration_policies(revision,terms,privacy,published_by) VALUES($1,$2,$3,$4)',
        [
          'synthetic-approved-v1',
          'Synthetic Terms for isolated testing.',
          'Synthetic Privacy for isolated testing.',
          'fixture-owner',
        ],
      )
    const make = () =>
      registration(
        new Request('https://example.test/api/registration?view=free', {
          method: 'POST',
          headers: { origin: 'https://example.test' },
          body: JSON.stringify({
            action: 'createFreeWorkspace',
            profile,
            ...(published
              ? {
                  consent: {
                    accepted: true,
                    revision: 'synthetic-approved-v1',
                  },
                }
              : {}),
          }),
        }),
      )
    const first = await make()
    expect(first.status).toBe(200)
    expect(first.headers.get('set-cookie')).toContain(
      'HttpOnly; Secure; SameSite=Lax',
    )
    const created = await first.json()
    const repeated = await (await make()).json()
    expect(repeated).toMatchObject({
      existing: true,
      workspaceId: created.workspaceId,
    })
    expect(
      (
        await db.query('SELECT id FROM businesses WHERE identity_owner=$1', [
          runtime.current.id,
        ])
      ).rows,
    ).toHaveLength(1)
    expect(
      (
        await db.query('SELECT role FROM users WHERE identity_id=$1', [
          runtime.current.id,
        ])
      ).rows,
    ).toEqual([{ role: 'Owner' }])
    const saved: any = (
      await db.query('SELECT data FROM settings WHERE business_id=$1', [
        created.workspaceId,
      ])
    ).rows[0]
    expect(saved.data).toMatchObject({
      name: profile.name,
      freeRegistration: {
        plan: 'free',
        ...(published
          ? { acceptedPolicyRevision: 'synthetic-approved-v1' }
          : {}),
        identityId: runtime.current.id,
      },
    })
    if (!published) {
      expect(saved.data.freeRegistration).not.toHaveProperty('acceptedAt')
      expect(saved.data.freeRegistration).not.toHaveProperty(
        'acceptedPolicyRevision',
      )
    }
    expect(
      (
        await db.query(
          'SELECT * FROM registration_acceptances WHERE identity_id=$1',
          [runtime.current.id],
        )
      ).rows,
    ).toHaveLength(0)
    expect(
      (
        await db.query('SELECT * FROM workspace_billing WHERE business_id=$1', [
          created.workspaceId,
        ])
      ).rows,
    ).toHaveLength(0)
    expect(
      (
        await db.query(
          'SELECT * FROM registration_drafts WHERE identity_id=$1',
          [runtime.current.id],
        )
      ).rows,
    ).toHaveLength(0)
    const access = await (
      await registration(
        new Request('https://example.test/api/registration?view=access'),
      )
    ).json()
    expect(access.membership).toMatchObject({
      id: created.workspaceId,
      role: 'Owner',
    })
    const denied = await registration(
      new Request('https://example.test/api/registration?view=access', {
        method: 'POST',
        headers: { origin: 'https://example.test' },
        body: JSON.stringify({ workspaceId: crypto.randomUUID() }),
      }),
    )
    expect(denied.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  },
)

it('does not provision for an unverified user, a signed-out request, or a foreign origin', async () => {
  runtime.values.CONTEXT = 'production'
  const make = (origin = 'https://example.test') =>
    registration(
      new Request('https://example.test/api/registration?view=free', {
        method: 'POST',
        headers: { origin },
        body: JSON.stringify({
          action: 'createFreeWorkspace',
          profile,
          consent: { accepted: true, revision: 'v1' },
        }),
      }),
    )
  runtime.current = { id: 'public-unverified', roles: [] }
  expect((await make()).status).toBe(403)
  runtime.session = null
  expect((await make()).status).toBe(401)
  runtime.session = { id: 'public-unverified' }
  runtime.current.confirmedAt = '2026-01-01'
  expect((await make('https://foreign.invalid')).status).toBe(403)
})
it('validates no-policy business details and refuses caller-controlled ownership or paid access', async () => {
  runtime.current = {
    id: 'no-policy-invalid-input',
    email: 'invalid@example.invalid',
    confirmedAt: '2026-01-01',
    roles: [],
  }
  runtime.values.CONTEXT = 'production'
  for (const input of [
    { profile: { ...profile, name: '' } },
    { profile: { ...profile, timezone: 'Not/AZone' } },
    { profile: { ...profile, currency: 'FAKE' } },
    { businessId: crypto.randomUUID() },
    { identityId: 'another-owner' },
    { role: 'platform_admin' },
    { planId: 'cottage-mercantile' },
    { paid: true },
  ]) {
    const result = await registration(
      new Request('https://example.test/api/registration?view=free', {
        method: 'POST',
        headers: { origin: 'https://example.test' },
        body: JSON.stringify({
          action: 'createFreeWorkspace',
          profile,
          ...input,
        }),
      }),
    )
    expect(result.status).toBe(400)
  }
  expect(
    (
      await db.query('SELECT id FROM businesses WHERE identity_owner=$1', [
        runtime.current.id,
      ])
    ).rows,
  ).toHaveLength(0)
})
const request = (data: any) =>
  new Request('https://fixture.netlify.app/api/registration', {
    method: 'POST',
    headers: {
      origin: 'https://fixture.netlify.app',
      'content-type': 'application/json',
    },
    body: JSON.stringify(data),
  })
it('allows provider signup without assigning privileges from caller-controlled metadata', () => {
  const deny = vi.fn()
  identityHook.userValidate({
    deny,
    user: { userMetadata: { beta: true, role: 'platform_admin' } },
  } as any)
  expect(deny).not.toHaveBeenCalled()
})
it('requires current verified admin and an explicit private deployment', async () => {
  expect((await registrationActor()).privateTest).toBe(true)
  runtime.current.roles = ['Owner']
  await expect(registrationActor()).rejects.toMatchObject({
    code: 'REGISTRATION_CLOSED',
  })
  runtime.current.roles = ['platform_admin']
  runtime.current.confirmedAt = undefined
  await expect(registrationActor()).rejects.toMatchObject({
    code: 'EMAIL_UNVERIFIED',
  })
  runtime.current.confirmedAt = '2026-01-01'
  runtime.values.CONTEXT = 'production'
  await expect(registrationActor()).rejects.toMatchObject({
    code: 'REGISTRATION_CLOSED',
  })
})
it('rejects forged ownership, prices, plans and production legal acceptance', async () => {
  for (const data of [
    { action: 'saveDraft', planId: 'free', profile, price: 1 },
    { action: 'saveDraft', planId: 'admin', profile },
    { action: 'saveDraft', planId: 'free', profile, businessId: 'foreign' },
    { action: 'acceptFixture', version: 'real-terms', accepted: true },
    { action: 'activate', planId: 'free' },
  ])
    expect((await registration(request(data))).ok).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})
it('stores resumable paid intent but cannot bypass payment or unfinished-plan readiness', async () => {
  await saveRegistrationDraft(runtime.client, actor, {
    action: 'saveDraft',
    planId: 'mixing-bowl',
    profile,
  })
  await acceptFixturePolicy(runtime.client, actor, {
    action: 'acceptFixture',
    version: 'fixture:registration-v1',
    accepted: true,
  })
  await expect(
    provisionTestWorkspace(runtime.client, actor),
  ).rejects.toMatchObject({ code: 'CHECKOUT_UNAVAILABLE' })
  expect(
    (
      await db.query('SELECT * FROM businesses WHERE identity_owner=$1', [
        actor.id,
      ])
    ).rows,
  ).toHaveLength(0)
  expect(
    (
      await db.query(
        'SELECT plan_id FROM registration_drafts WHERE identity_id=$1',
        [actor.id],
      )
    ).rows[0],
  ).toMatchObject({ plan_id: 'mixing-bowl' })
})
it('creates a cardless empty Free fixture once, keeps consent test-only and resumes the existing membership', async () => {
  await saveRegistrationDraft(runtime.client, actor, {
    action: 'saveDraft',
    planId: 'free',
    profile,
  })
  const first = await provisionTestWorkspace(runtime.client, actor)
  const second = await provisionTestWorkspace(runtime.client, actor)
  expect(second.workspaceId).toBe(first.workspaceId)
  expect(second.existing).toBe(true)
  for (const table of [
    'ingredients',
    'recipes',
    'products',
    'sales',
    'ledger',
    'batches',
  ])
    expect(
      (
        await db.query(`SELECT * FROM ${table} WHERE business_id=$1`, [
          first.workspaceId,
        ])
      ).rows,
    ).toHaveLength(0)
  const settings: any = (
    await db.query('SELECT data FROM settings WHERE business_id=$1', [
      first.workspaceId,
    ])
  ).rows[0]
  expect(settings.data).toMatchObject({
    name: profile.name,
    measurements: 'metric',
    currency: 'USD',
    appearance: { theme: 'cottage' },
  })
  const accepted: any = (
    await db.query(
      'SELECT * FROM registration_acceptances WHERE identity_id=$1',
      [actor.id],
    )
  ).rows[0]
  expect(accepted).toMatchObject({
    test_only: true,
    policy_version: 'fixture:registration-v1',
  })
  expect(accepted.accepted_at).toBeTruthy()
  await expect(
    db.query(
      'UPDATE registration_acceptances SET test_only=false WHERE identity_id=$1',
      [actor.id],
    ),
  ).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})
it('requires acceptance before provisioning and refuses inactive membership fallback', async () => {
  const other = { ...actor, id: 'fixture-incomplete' }
  await saveRegistrationDraft(runtime.client, other, {
    action: 'saveDraft',
    planId: 'free',
    profile,
  })
  await expect(
    provisionTestWorkspace(runtime.client, other),
  ).rejects.toMatchObject({ code: 'FIXTURE_ACCEPTANCE_REQUIRED' })
  await db.query('UPDATE users SET active=false WHERE identity_id=$1', [
    actor.id,
  ])
  await expect(currentMembership(runtime.client, actor)).rejects.toMatchObject({
    code: 'MEMBERSHIP_INACTIVE',
  })
  await db.query('UPDATE users SET active=true WHERE identity_id=$1', [
    actor.id,
  ])
})
it('counts tracked stock only, blocks cap races under the oven lock and preserves corrections/history', async () => {
  const membership = await currentMembership(runtime.client, actor)
  for (let n = 0; n < 10; n++)
    await db.query(
      'INSERT INTO ingredients(id,business_id,data) VALUES($1,$2,$3)',
      [
        `item-${n}`,
        membership.id,
        JSON.stringify({
          id: `item-${n}`,
          name: 'Tracked',
          trackInventory: true,
        }),
      ],
    )
  await expect(
    assertRegistrationQuota(
      runtime.client,
      membership.id,
      'free',
      'ingredients',
      { id: 'extra', name: 'Extra', trackInventory: true },
    ),
  ).rejects.toThrow('10 active stock-tracked')
  await expect(
    assertRegistrationQuota(
      runtime.client,
      membership.id,
      'free',
      'ingredients',
      { id: 'cost-only', name: 'Cost only', trackInventory: false },
    ),
  ).resolves.toBeUndefined()
  await expect(
    assertRegistrationQuota(
      runtime.client,
      membership.id,
      'free',
      'ingredients',
      { id: 'item-0', name: 'Correction', trackInventory: true },
    ),
  ).resolves.toBeUndefined()
  await expect(
    assertRegistrationQuota(
      runtime.client,
      membership.id,
      'mixing-bowl',
      'ingredients',
      { id: 'paid-extra', name: 'Paid' },
    ),
  ).resolves.toBeUndefined()
  expect(
    (
      await db.query('SELECT * FROM ingredients WHERE business_id=$1', [
        membership.id,
      ])
    ).rows,
  ).toHaveLength(10)
})
it('does not silently omit cost-only packaging from Free batch coverage', () => {
  expect(() =>
    assertFullFreeStockCoverage(
      {
        ingredients: [
          { id: 'flour', name: 'Flour', trackInventory: true },
          { id: 'bag', name: 'Bag', trackInventory: false },
        ],
        recipes: [
          { id: 'bread', name: 'Bread', lines: [{ ingredientId: 'flour' }] },
        ],
        products: [
          { id: 'loaf', name: 'Loaf', recipeId: 'bread', packagingId: 'bag' },
        ],
        batches: [{ id: 'batch', name: 'Batch', recipeId: 'bread' }],
      },
      'batch',
    ),
  ).toThrow('every ingredient and packaging')
})
it('protects draft/billing rows with real tenant policies and denies billing to non-Owners', async () => {
  const membership = await currentMembership(runtime.client, actor)
  await db.exec(
    'CREATE ROLE registration_reader; GRANT USAGE ON SCHEMA public TO registration_reader; GRANT SELECT,INSERT,UPDATE ON registration_drafts,registration_acceptances,workspace_billing,billing_attempts,users TO registration_reader; SET ROLE registration_reader;',
  )
  try {
    await db.query(
      "SELECT set_config('app.identity_id','foreign-identity',false),set_config('app.business_id',$1,false)",
      [membership.id],
    )
    expect(
      (await db.query('SELECT * FROM registration_drafts')).rows,
    ).toHaveLength(0)
    expect(
      (await db.query('SELECT * FROM workspace_billing')).rows,
    ).toHaveLength(0)
    await expect(
      db.query(
        'UPDATE registration_drafts SET identity_id=$1 WHERE identity_id=$2',
        ['foreign-identity', actor.id],
      ),
    ).resolves.toBeDefined()
    await expect(
      db.query('INSERT INTO registration_drafts(identity_id) VALUES($1)', [
        actor.id,
      ]),
    ).rejects.toThrow(/row.level security/i)
  } finally {
    await db.exec('RESET ROLE')
  }
  await db.query('UPDATE users SET role=$2 WHERE identity_id=$1', [
    actor.id,
    'Manager',
  ])
  await expect(billingView(runtime.client, actor)).rejects.toMatchObject({
    code: 'OWNER_REQUIRED',
  })
  await db.query('UPDATE users SET role=$2 WHERE identity_id=$1', [
    actor.id,
    'Owner',
  ])
})
it('authenticates, deduplicates and stores only references from Sandbox webhooks without paid activation', async () => {
  runtime.values = {
    ...runtime.values,
    SQUARE_SANDBOX_ENABLED: 'true',
    SQUARE_SANDBOX_WEBHOOK_URL:
      'https://fixture.netlify.app/api/square/sandbox/webhook',
    SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY: 'fixture-signature',
    SQUARE_SANDBOX_MERCHANT_ID: 'fixture-merchant',
  }
  const body = JSON.stringify({
    event_id: 'fixture-event',
    merchant_id: 'fixture-merchant',
    type: 'invoice.payment_made',
    data: { id: 'fixture-invoice' },
    buyer: { email: 'discard-this@example.invalid' },
  })
  const signature = createHmac('sha256', 'fixture-signature')
    .update(runtime.values.SQUARE_SANDBOX_WEBHOOK_URL + body)
    .digest('base64')
  const make = (sig: string) =>
    new Request(runtime.values.SQUARE_SANDBOX_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'x-square-hmacsha256-signature': sig },
      body,
    })
  expect((await webhook(make('bad'))).status).toBe(403)
  expect((await webhook(make(signature))).status).toBe(200)
  expect((await webhook(make(signature))).status).toBe(200)
  expect((await db.query('SELECT * FROM billing_events')).rows).toHaveLength(1)
  const event: any = (await db.query('SELECT * FROM billing_events')).rows[0]
  expect(event.status).toBe('pending')
  expect(JSON.stringify(event)).not.toContain('discard-this')
  expect(
    (
      await db.query(
        "SELECT * FROM workspace_billing WHERE status='paid_active'",
      )
    ).rows,
  ).toHaveLength(0)
  expect(fetch).not.toHaveBeenCalled()
})
it('enforces one unresolved checkout in SQL and preserves the oven on retry', async () => {
  const membership = await currentMembership(runtime.client, actor)
  const insert =
    'INSERT INTO billing_attempts(business_id,identity_id,plan_id,idempotency_key) VALUES($1,$2,$3,$4)'
  await db.query(insert, [
    membership.id,
    actor.id,
    'mixing-bowl',
    '00000000-0000-4000-8000-000000000101',
  ])
  await expect(
    db.query(insert, [
      membership.id,
      actor.id,
      'mixing-bowl',
      '00000000-0000-4000-8000-000000000102',
    ]),
  ).rejects.toThrow(/unique|duplicate/i)
  expect(
    (await db.query('SELECT * FROM businesses WHERE id=$1', [membership.id]))
      .rows,
  ).toHaveLength(1)
  expect(
    (
      await db.query('SELECT * FROM billing_attempts WHERE business_id=$1', [
        membership.id,
      ])
    ).rows,
  ).toHaveLength(1)
})
it('denies CSRF, public activation and unsupported invitation/grant bypasses', async () => {
  const foreign = new Request('https://fixture.netlify.app/api/registration', {
    method: 'POST',
    headers: { origin: 'https://foreign.invalid' },
    body: JSON.stringify({ action: 'saveDraft', planId: 'free', profile }),
  })
  expect((await registration(foreign)).status).toBe(403)
  for (const action of [
    'acceptInvitation',
    'complimentary',
    'checkout',
    'resend',
  ])
    expect((await registration(request({ action }))).ok).toBe(false)
  runtime.values.CONTEXT = 'production'
  expect(
    (await registration(request({ action: 'provisionTest' }))).status,
  ).toBe(403)
  expect(fetch).not.toHaveBeenCalled()
})
it('reconciles canonical Sandbox references out of order without granting paid access or deleting a grant', async () => {
  runtime.values = {
    ...runtime.values,
    SQUARE_SANDBOX_ENABLED: 'true',
    SQUARE_SANDBOX_ACCESS_TOKEN: 'fixture-only',
    SQUARE_SANDBOX_API_VERSION: '2026-01-22',
    SQUARE_SANDBOX_MERCHANT_ID: 'fixture-merchant',
    SQUARE_SANDBOX_LOCATION_ID: 'fixture-location',
  }
  const member = await currentMembership(runtime.client, actor)
  await db.query(
    'INSERT INTO complimentary_grants(business_id,owner_identity,actor_identity,reason) VALUES($1,$2,$3,$4)',
    [
      member.id,
      actor.id,
      'fixture-platform-admin',
      'Disposable database fixture only',
    ],
  )
  await db.query(
    "INSERT INTO billing_events(id,merchant_id,kind,object_id) VALUES('sandbox:older-event','fixture-merchant','invoice.updated','fixture-invoice')",
  )
  const fake = vi.fn().mockImplementation(async () =>
    Response.json({
      invoice: {
        id: 'fixture-invoice',
        status: 'PAID',
        subscription_id: 'unmapped-subscription',
      },
    }),
  )
  vi.stubGlobal('fetch', fake)
  for (let n = 0; n < 2; n++)
    expect(
      (await registration(request({ action: 'reconcileSandbox' }))).status,
    ).toBe(200)
  expect(
    (await db.query("SELECT * FROM billing_events WHERE status='needs_review'"))
      .rows,
  ).toHaveLength(2)
  expect(
    (
      await db.query(
        "SELECT * FROM workspace_billing WHERE status='paid_active'",
      )
    ).rows,
  ).toHaveLength(0)
  expect(
    (
      await db.query(
        'SELECT * FROM complimentary_grants WHERE business_id=$1',
        [member.id],
      )
    ).rows,
  ).toHaveLength(1)
  expect(
    fake.mock.calls.every((call: any[]) =>
      call[0].startsWith('https://connect.squareupsandbox.com/'),
    ),
  ).toBe(true)
})
it.each(['recipes', 'products'])(
  'enforces the five-active %s limit while retaining existing rows',
  async (table) => {
    const member = await currentMembership(runtime.client, actor)
    for (let n = 0; n < 5; n++)
      await db.query(
        `INSERT INTO ${table}(id,business_id,data) VALUES($1,$2,$3)`,
        [
          `cap-${n}`,
          member.id,
          JSON.stringify({
            id: `cap-${n}`,
            name: 'Fixture record',
            active: true,
          }),
        ],
      )
    await expect(
      assertRegistrationQuota(runtime.client, member.id, 'free', table, {
        id: 'cap-extra',
        name: 'Extra',
        active: true,
      }),
    ).rejects.toThrow('5 active')
    await expect(
      assertRegistrationQuota(runtime.client, member.id, 'free', table, {
        id: 'cap-0',
        name: 'Correction',
        active: true,
      }),
    ).resolves.toBeUndefined()
    expect(
      (
        await db.query(`SELECT id FROM ${table} WHERE business_id=$1`, [
          member.id,
        ])
      ).rows,
    ).toHaveLength(5)
  },
)

it('lets an ordinary existing Owner resolve access in production without public activation', async () => {
  await saveRegistrationDraft(runtime.client, actor, {
    action: 'saveDraft',
    planId: 'free',
    profile,
  })
  await acceptFixturePolicy(runtime.client, actor, {
    action: 'acceptFixture',
    version: 'fixture:registration-v1',
    accepted: true,
  })
  const created = await provisionTestWorkspace(runtime.client, actor)
  runtime.current.roles = []
  runtime.values.CONTEXT = 'production'
  const response = await registration(
    new Request('https://example.test/api/registration?view=access'),
  )
  expect(response.status).toBe(200)
  const access = await response.json()
  expect(access.membership).toMatchObject({
    id: created.workspaceId,
    role: 'Owner',
  })
  expect(access.privateTest).toBe(false)
  expect(
    (await registration(request({ action: 'provisionTest' }))).status,
  ).toBe(403)
})

it('requires a valid selection for multiple memberships and rejects a foreign oven', async () => {
  await saveRegistrationDraft(runtime.client, actor, {
    action: 'saveDraft',
    planId: 'free',
    profile,
  })
  await acceptFixturePolicy(runtime.client, actor, {
    action: 'acceptFixture',
    version: 'fixture:registration-v1',
    accepted: true,
  })
  const first = await provisionTestWorkspace(runtime.client, actor)
  const second = (
    await db.query(
      "INSERT INTO businesses(business_name) VALUES ('Second Kitchen') RETURNING id",
    )
  ).rows[0] as any
  await db.query(
    "INSERT INTO users(id,business_id,identity_id,role,data) VALUES($1,$2,$3,$4,'{}')",
    [crypto.randomUUID(), second.id, actor.id, 'Owner'],
  )
  const access = await (
    await registration(
      new Request('https://example.test/api/registration?view=access'),
    )
  ).json()
  expect(access.memberships).toHaveLength(2)
  expect(access.membership).toBeNull()
  await expect(currentMembership(runtime.client, actor)).rejects.toMatchObject({
    code: 'WORKSPACE_SELECTION_REQUIRED',
  })
  const choose = (workspaceId: string) =>
    registration(
      new Request('https://example.test/api/registration?view=access', {
        method: 'POST',
        headers: { origin: 'https://example.test' },
        body: JSON.stringify({ workspaceId }),
      }),
    )
  expect((await choose(crypto.randomUUID())).status).toBe(403)
  const selected = await choose(first.workspaceId)
  expect(selected.status).toBe(200)
  expect(selected.headers.get('set-cookie')).toContain(
    'HttpOnly; Secure; SameSite=Lax',
  )
  expect(
    (
      await currentMembership(runtime.client, {
        ...actor,
        selectedWorkspaceId: first.workspaceId,
      })
    ).id,
  ).toBe(first.workspaceId)
})

it('returns a retryable membership failure rather than an empty oven result', async () => {
  const original = runtime.client.query
  runtime.client.query = async (sql: string, values?: any[]) => {
    if (sql.includes('FROM users u JOIN businesses'))
      throw new Error('Membership lookup unavailable')
    return original(sql, values)
  }
  try {
    const response = await registration(
      new Request('https://example.test/api/registration?view=access'),
    )
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.code).toBe('REGISTRATION_REQUEST_FAILED')
    expect(body).not.toHaveProperty('membership')
  } finally {
    runtime.client.query = original
  }
})
