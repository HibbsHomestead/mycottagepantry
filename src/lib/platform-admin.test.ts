// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- Fixtures exercise malformed provider and database inputs. */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import { randomUUID, createHash, generateKeyPairSync, sign } from 'node:crypto'
import type { Context } from '@netlify/functions'
const runtime = vi.hoisted(() => ({
  pool: null as any,
  loginId: 'platform-owner',
  recoveryStatus: 0,
  identities: {} as Record<string, any>,
  env: {} as Record<string, string>,
  functionContext: undefined as Context | undefined,
  queries: [] as string[],
  recoveryFails: false,
}))
vi.mock('@netlify/functions', () => ({
  getContext: () => runtime.functionContext,
}))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: runtime.pool }),
}))
vi.mock('@netlify/identity', () => ({
  login: vi.fn(async () => runtime.identities[runtime.loginId]),
  requestPasswordRecovery: vi.fn(async () => {
    if (runtime.recoveryStatus) throw { status: runtime.recoveryStatus }
  }),
  admin: {
    getUser: vi.fn(async (id: string) => {
      if (!runtime.identities[id]) throw new Error('Provider unavailable')
      return runtime.identities[id]
    }),
  },
  getUser: vi.fn(async () => runtime.identities[runtime.loginId]),
}))
vi.mock('../../netlify/lib/verified-session', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../netlify/lib/verified-session')
  >()),
  verifiedSession: async () => runtime.identities[runtime.loginId],
}))
vi.mock('../../netlify/lib/support-billing-recovery', () => ({
  reconcileSupportBilling: async (c: any, businessId: string) => {
    if (runtime.recoveryFails) throw new Error('provider-secret-must-not-leak')
    await c.query("SELECT set_config('app.billing_worker','true',true)")
    await c.query(
      'UPDATE workspace_billing SET last_reconciled_at=now() WHERE business_id=$1',
      [businessId],
    )
  },
}))
import { assistantTools } from '../../netlify/lib/support-ai-tools'
import { confirmAssistantAction } from '../../netlify/lib/support-ai-confirm'
import {
  supportActor,
  supportTransaction,
} from '../../netlify/lib/support-core'
import { openSecret, totpCode } from '../../netlify/lib/platform-admin-totp'
import handler from '../../netlify/functions/platform-admin.mts'
import {
  adminCookie,
  hash,
  requireAdminOrigin,
  sessionCookie,
} from '../../netlify/lib/platform-admin-core'
import { requireLegacyAdmin } from '../../netlify/lib/platform-admin-legacy'
import hostRouter from '../../netlify/edge-functions/admin-host'
import registration from '../../netlify/functions/registration.mts'
import support from '../../netlify/lib/support-handler'

const origin = 'https://admin.mycottagepantry.com'
const oven = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const cookies = { delete: vi.fn() }
const context = { ip: '203.0.113.41', cookies } as unknown as Context
const token = 'T'.repeat(43)
const database = new PGlite()
function request(
  query = '',
  body?: unknown,
  options: {
    token?: string
    origin?: string
    headers?: Record<string, string>
    host?: string
    method?: string
  } = {},
) {
  return new Request(
    (options.host || origin) + '/api/admin' + (query ? '?' + query : ''),
    {
      method: options.method || (body === undefined ? 'GET' : 'POST'),
      headers: {
        'x-cp-admin': '1',
        origin: options.origin || origin,
        'Content-Type': 'application/json',
        ...(options.token ? { cookie: `${adminCookie}=${options.token}` } : {}),
        ...options.headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  )
}
async function session(mfa = true, identity = 'platform-owner', value = token) {
  await database.query(
    "INSERT INTO platform_sessions(token_hash,identity_id,epoch,origin,mfa_at,expires_at) VALUES($1,$2,1,$3,CASE WHEN $4 THEN NOW() ELSE NULL END,NOW()+INTERVAL '10 minutes')",
    [hash(value), identity, origin, mfa],
  )
  return value
}
async function get(query: string, mfa = true) {
  await session(mfa)
  return handler(request(query, undefined, { token }), context)
}
beforeAll(async () => {
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root))
    await database.exec(
      await readFile(new URL(name + '/migration.sql', root), 'utf8'),
    )
  expect(
    (await database.query('SELECT identity_id,role FROM platform_admins')).rows,
  ).toEqual([
    { identity_id: '8a87b82e-1393-4c4d-9885-62f946204b6e', role: 'owner' },
    { identity_id: 'd62a6cbd-124a-4766-9e82-22cb062ea09a', role: 'admin' },
  ])
  await database.exec(
    'CREATE ROLE portal_test NOLOGIN;GRANT USAGE ON SCHEMA public TO portal_test;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO portal_test;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO portal_test;',
  )
  await database.query(
    'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3),($4,$5,$6)',
    [
      oven,
      'Cedar Kitchen',
      'customer-owner',
      other,
      'River Market',
      'other-owner',
    ],
  )
  for (const [id, business, identity] of [
    ['member-a', oven, 'customer-owner'],
    ['member-b', other, 'other-owner'],
  ])
    await database.query(
      "INSERT INTO users(id,business_id,identity_id,role,data) VALUES($1,$2,$3,'Owner',$4)",
      [
        id,
        business,
        identity,
        JSON.stringify({ name: 'PRIVATE_BUSINESS_CONTENT' }),
      ],
    )
  await database.query(
    "INSERT INTO receipt_extractions(id,business_id,data) VALUES('receipt-reference',$1,$2)",
    [
      oven,
      JSON.stringify({
        extractionStatus: 'failed',
        fileKey: 'PRIVATE_FILE_KEY',
        text: 'PRIVATE_RECEIPT_TEXT',
        error: 'PRIVATE_PROVIDER_ERROR',
        oauthToken: 'PRIVATE_CREDENTIAL',
      }),
    ],
  )
  await database.query(
    "INSERT INTO workspace_billing(business_id,plan_id,source,status,subscription_id,snapshot) VALUES($1,'mixing-bowl','square_sandbox','past_due','subscription-sensitive-reference',$2)",
    [oven, JSON.stringify({ token: 'PRIVATE_BILLING_PAYLOAD' })],
  )
  await database.query(
    "INSERT INTO integrations(id,business_id,data) VALUES('seller-square',$1,$2)",
    [
      oven,
      JSON.stringify({
        status: 'disconnected',
        accessToken: 'PRIVATE_SELLER_CREDENTIAL',
      }),
    ],
  )
  let tail = Promise.resolve()
  runtime.pool = {
    connect: async () => {
      const previous = tail
      let release!: () => void
      tail = new Promise<void>((r) => {
        release = r
      })
      await previous
      return {
        release,
        query: async (sql: string, params: any[] = []) => {
          runtime.queries.push(sql)
          if (sql === 'BEGIN') {
            await database.exec('BEGIN;SET LOCAL ROLE portal_test;')
            return { rows: [] }
          }
          return database.query(sql, params)
        },
      }
    },
  }
}, 30000)
beforeEach(async () => {
  await database.exec(
    'TRUNCATE platform_sessions,platform_credentials,platform_admins,platform_limits,platform_audit,registration_policies RESTART IDENTITY CASCADE',
  )
  await database.query(
    "INSERT INTO platform_admins(identity_id,role,enrollment_until,granted_by,reason) VALUES('platform-owner','owner',NOW()+INTERVAL '1 day','verified-operator','Test fixture'),('platform-agent','admin',NULL,'platform-owner','Test fixture')",
  )
  runtime.identities = Object.fromEntries(
    ['platform-owner', 'platform-agent', 'customer-owner', 'other-owner'].map(
      (id) => [
        id,
        {
          id,
          email: id + '@example.invalid',
          confirmedAt: '2026-01-01T00:00:00Z',
          roles: id === 'customer-owner' ? ['Owner', 'platform_admin'] : [],
        },
      ],
    ),
  )
  runtime.recoveryStatus = 0
  runtime.loginId = 'platform-owner'
  runtime.env = { CONTEXT: 'production' }
  runtime.functionContext = undefined
  runtime.queries = []
  vi.stubGlobal('Netlify', { env: { get: (key: string) => runtime.env[key] } })
  cookies.delete.mockClear()
})
afterAll(async () => {
  await database.close()
  vi.unstubAllGlobals()
})

it('publishes legal documents only for an owner with MFA and exposes the same public revision', async () => {
  const payload = {
    policy: {
      revision: 'synthetic-v1',
      terms: 'Synthetic Terms, isolated fixture only.',
      privacy: 'Synthetic Privacy, isolated fixture only.',
    },
    approved: true,
    expectedRevision: null,
  }
  const postPolicy = (value = token) =>
    handler(
      request('action=registration-policies', payload, { token: value }),
      context,
    )
  expect((await postPolicy()).status).toBe(401)
  await session(false)
  expect((await postPolicy()).status).toBe(403)
  const agentToken = 'A'.repeat(43)
  await session(true, 'platform-agent', agentToken)
  expect((await postPolicy(agentToken)).status).toBe(403)
  await database.query('DELETE FROM platform_sessions WHERE token_hash=$1', [
    hash(token),
  ])
  await session(true)
  const published = await postPolicy()
  expect(published.status).toBe(200)
  expect((await published.json()).policy).toEqual(payload.policy)
  const policies = await registration(
    new Request('https://mycottagepantry.com/api/registration?view=policies'),
  )
  expect(await policies.json()).toEqual({ policy: payload.policy })
  const readiness = await registration(
    new Request('https://mycottagepantry.com/api/registration?view=readiness'),
  )
  expect(await readiness.json()).toMatchObject({
    policyAcceptance: true,
    activation: true,
    liveCheckout: false,
  })
  const auditRow: any = (
    await database.query(
      "SELECT after FROM platform_audit WHERE action='publish:registration-policies'",
    )
  ).rows[0]
  expect(auditRow.after).toEqual({ revision: 'synthetic-v1' })
  expect(JSON.stringify(auditRow)).not.toContain('Synthetic Terms')
  const stale = await postPolicy()
  expect(stale.status).toBe(409)
  expect((await stale.json()).code).toBe('POLICY_CHANGED')
  const duplicate = await handler(
    request(
      'action=registration-policies',
      { ...payload, expectedRevision: 'synthetic-v1' },
      { token },
    ),
    context,
  )
  expect(duplicate.status).toBe(409)
  expect((await duplicate.json()).code).toBe('REVISION_EXISTS')
  await expect(
    database.query("UPDATE registration_policies SET terms='changed'"),
  ).rejects.toThrow('immutable')
  await expect(
    database.query('DELETE FROM registration_policies'),
  ).rejects.toThrow('immutable')
})

it('allows activation without published policies and rejects cross-origin publication', async () => {
  const readiness = await registration(
    new Request('https://mycottagepantry.com/api/registration?view=readiness'),
  )
  expect(await readiness.json()).toMatchObject({
    policyAcceptance: false,
    activation: true,
    blockers: [],
  })
  await session(true)
  const denied = await handler(
    request(
      'action=registration-policies',
      {
        policy: { revision: 'fixture', terms: 'Fixture', privacy: 'Fixture' },
        approved: true,
        expectedRevision: null,
      },
      { token, origin: 'https://foreign.invalid' },
    ),
    context,
  )
  expect(denied.status).toBe(403)
  expect(
    (await database.query('SELECT revision FROM registration_policies')).rows,
  ).toHaveLength(0)
  await database.exec('BEGIN; SET LOCAL ROLE portal_test;')
  try {
    await expect(
      database.query(
        "INSERT INTO registration_policies(revision,terms,privacy,published_by) VALUES('untrusted','Fixture','Fixture','untrusted')",
      ),
    ).rejects.toThrow('row-level security')
  } finally {
    await database.exec('ROLLBACK')
  }
})

it.each([false, true])(
  'lists one created business and restores membership after sign-in with published policies=%s',
  async (published) => {
    // Provider/session transitions are fixtures. This does not send real signup or verification email.
    const preserved = async () => {
      const rows = []
      for (const table of [
        'businesses',
        'users',
        'settings',
        'workspace_billing',
        'registration_acceptances',
      ])
        rows.push(
          (await database.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
        )
      return rows
    }
    const before = await preserved()
    const identity = 'isolated-onboarding-owner'
    runtime.identities[identity] = {
      id: identity,
      email: 'isolated@example.invalid',
      confirmedAt: '2026-01-01T00:00:00Z',
      roles: [],
    }
    runtime.loginId = identity
    await session(true)
    const list = () =>
      handler(
        request('section=customers&kind=accounts&q=' + identity, undefined, {
          token,
        }),
        context,
      )
    const pending = await list()
    expect((await pending.json()).rows).toHaveLength(0)
    expect(
      (
        await database.query('SELECT id FROM users WHERE identity_id=$1', [
          identity,
        ])
      ).rows,
    ).toHaveLength(0)
    if (published)
      await handler(
        request(
          'action=registration-policies',
          {
            policy: {
              revision: 'isolated-v1',
              terms: 'Synthetic Terms for isolated testing.',
              privacy: 'Synthetic Privacy for isolated testing.',
            },
            approved: true,
            expectedRevision: null,
          },
          { token },
        ),
        context,
      )
    const create = () =>
      registration(
        new Request('https://mycottagepantry.com/api/registration?view=free', {
          method: 'POST',
          headers: { origin: 'https://mycottagepantry.com' },
          body: JSON.stringify({
            action: 'createFreeWorkspace',
            profile: {
              name: 'Isolated Kitchen',
              country: 'US',
              timezone: 'America/Chicago',
              currency: 'USD',
              measurements: 'us',
            },
            ...(published
              ? { consent: { accepted: true, revision: 'isolated-v1' } }
              : {}),
          }),
        }),
      )
    let workspaceId: string | undefined
    try {
      const response = await create()
      expect(response.status).toBe(200)
      workspaceId = (await response.json()).workspaceId
      for (const retry of await Promise.all([create(), create()]))
        expect(await retry.json()).toMatchObject({
          workspaceId,
          existing: true,
        })
      expect(
        (
          await database.query(
            'SELECT id FROM businesses WHERE identity_owner=$1',
            [identity],
          )
        ).rows,
      ).toHaveLength(1)
      const accounts = await (await list()).json()
      expect(accounts.rows).toEqual([
        expect.objectContaining({
          identity_id: identity,
          oven_count: 1,
          active_memberships: 1,
        }),
      ])
      expect(
        (
          await database.query(
            'SELECT identity_owner FROM businesses WHERE id=$1',
            [workspaceId],
          )
        ).rows,
      ).toEqual([{ identity_owner: identity }])
      const access = () =>
        registration(
          new Request(
            'https://mycottagepantry.com/api/registration?view=access',
          ),
        )
      expect((await (await access()).json()).memberships).toEqual([
        expect.objectContaining({ id: workspaceId, role: 'Owner' }),
      ])
      runtime.loginId = 'signed-out-fixture'
      expect((await access()).status).toBe(401)
      runtime.loginId = identity
      expect((await (await access()).json()).memberships).toEqual([
        expect.objectContaining({ id: workspaceId, role: 'Owner' }),
      ])
      expect(
        (
          await database.query(
            'SELECT business_id FROM workspace_billing WHERE business_id=$1',
            [workspaceId],
          )
        ).rows,
      ).toHaveLength(0)
      const settings: any = (
        await database.query(
          "SELECT data FROM settings WHERE business_id=$1 AND id='business'",
          [workspaceId],
        )
      ).rows[0]
      expect(settings.data.freeRegistration).toMatchObject({
        plan: 'free',
        identityId: identity,
        ...(published ? { acceptedPolicyRevision: 'isolated-v1' } : {}),
      })
      if (!published) {
        expect(settings.data.freeRegistration).not.toHaveProperty('acceptedAt')
        expect(settings.data.freeRegistration).not.toHaveProperty(
          'acceptedPolicyRevision',
        )
      }
      expect(
        (
          await database.query(
            'SELECT * FROM registration_acceptances WHERE identity_id=$1',
            [identity],
          )
        ).rows,
      ).toHaveLength(0)
    } finally {
      if (workspaceId) {
        for (const table of ['units', 'settings', 'users'])
          await database.query(`DELETE FROM ${table} WHERE business_id=$1`, [
            workspaceId,
          ])
        await database.query('DELETE FROM businesses WHERE id=$1', [
          workspaceId,
        ])
      }
    }
    expect(await preserved()).toEqual(before)
  },
)

it('denies every admin data view to logged-out users and to customer cookies or browser role flags', async () => {
  for (const section of [
    'overview',
    'customers',
    'plans',
    'billing',
    'operations',
    'content',
    'audit',
  ]) {
    const response = await handler(
      request('section=' + section, undefined, {
        headers: {
          cookie: 'nf_jwt=customer-cookie; platform_admin=true; OvenId=' + oven,
        },
      }),
      context,
    )
    expect(response.status).toBe(401)
    expect(await response.text()).not.toContain('Cedar Kitchen')
  }
})
it('does not turn a customer owner or server Identity role alone into a platform administrator', async () => {
  runtime.loginId = 'customer-owner'
  const response = await handler(
    request('action=login', {
      email: 'owner@example.invalid',
      password: 'test-password',
    }),
    context,
  )
  // Indistinguishable from a wrong password: admin status is never revealed.
  expect(response.status).toBe(401)
  expect((await response.json()).code).toBe('LOGIN_FAILED')
  expect(
    (await database.query('SELECT * FROM platform_sessions')).rows,
  ).toHaveLength(0)
  expect(cookies.delete).toHaveBeenCalledWith('nf_jwt')
  expect(cookies.delete).toHaveBeenCalledWith('nf_refresh')
})
it('allows password-verified administrator sessions to read every view without MFA', async () => {
  await session(false)
  for (const section of [
    'overview',
    'customers',
    'plans',
    'billing',
    'operations',
    'content',
    'audit',
  ]) {
    const response = await handler(
      request('section=' + section, undefined, { token }),
      context,
    )
    expect(response.status).toBe(200)
  }
  const row = (
    await database.query<any>('SELECT mfa_at FROM platform_sessions')
  ).rows[0]
  expect(row.mfa_at).toBeNull()
})
it.each(['none', 'expired', 'enrolled'])(
  'opens the dashboard after password login with %s passkey enrollment',
  async (state) => {
    await database.query(
      "UPDATE platform_admins SET enrollment_until=CASE WHEN $1='expired' THEN NOW()-INTERVAL '1 day' ELSE NULL END WHERE identity_id='platform-owner'",
      [state],
    )
    if (state === 'enrolled')
      await database.query(
        "INSERT INTO platform_credentials(id,identity_id,public_key) VALUES('existing-key','platform-owner','unchanged-key')",
      )
    const before = (await database.query('SELECT * FROM platform_credentials'))
      .rows
    const response = await handler(
      request('action=login', {
        email: 'owner@example.invalid',
        password: 'fixture-password',
      }),
      context,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ stage: 'authenticated' })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=1800')
    const cookieToken = /__Host-cp_admin=([^;]+)/.exec(
      response.headers.get('set-cookie')!,
    )![1]
    const status = await handler(
      request('action=session', undefined, { token: cookieToken }),
      context,
    )
    expect((await status.json()).stage).toBe('authenticated')
    const dashboard = await handler(
      request('section=overview', undefined, { token: cookieToken }),
      context,
    )
    expect(dashboard.status).toBe(200)
    const row = (
      await database.query<any>(
        'SELECT mfa_at,mfa_method,expires_at FROM platform_sessions',
      )
    ).rows[0]
    expect(row.mfa_at).toBeNull()
    expect(row.mfa_method).toBeNull()
    expect(Date.parse(row.expires_at) - Date.now()).toBeGreaterThan(29 * 60000)
    expect(
      (await database.query('SELECT * FROM platform_credentials')).rows,
    ).toEqual(before)
    expect(
      (
        await database.query(
          "SELECT action,outcome FROM platform_audit WHERE action='login'",
        )
      ).rows,
    ).toEqual([{ action: 'login', outcome: 'password_verified' }])
  },
)
it('rejects incorrect passwords, unconfirmed identities and disabled grants without creating sessions', async () => {
  const { login } = await import('@netlify/identity')
  vi.mocked(login).mockRejectedValueOnce(new Error('Invalid credentials'))
  const input = {
    email: 'owner@example.invalid',
    password: 'fixture-password',
  }
  const invalid = await handler(request('action=login', input), context)
  expect(invalid.status).toBe(401)
  expect((await invalid.json()).code).toBe('LOGIN_FAILED')
  runtime.identities['platform-owner'].confirmedAt = null
  expect((await handler(request('action=login', input), context)).status).toBe(
    403,
  )
  runtime.identities['platform-owner'].confirmedAt = '2026-01-01T00:00:00Z'
  runtime.loginId = 'platform-agent'
  await database.query(
    "UPDATE platform_admins SET enabled=false WHERE identity_id='platform-agent'",
  )
  expect((await handler(request('action=login', input), context)).status).toBe(
    401,
  )
  expect(
    (await database.query('SELECT * FROM platform_sessions')).rows,
  ).toHaveLength(0)
})
it('uses host-only HttpOnly Strict opaque sessions and rotates away Identity tokens', async () => {
  const response = await handler(
    request('action=login', {
      email: 'owner@example.invalid',
      password: 'test-password',
    }),
    context,
  )
  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')!
  expect(cookie).toMatch(
    /__Host-cp_admin=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict/,
  )
  expect(cookie).not.toMatch(/Domain=/)
  expect(await response.text()).not.toMatch(/token|password|email/)
  expect(sessionCookie('example')).not.toContain('Domain=')
})
it('rejects changed hosts, cross-origin requests, same-site subdomain requests, and missing custom headers', () => {
  expect(() =>
    requireAdminOrigin(
      request('', undefined, { host: 'https://mycottagepantry.com' }),
    ),
  ).toThrow()
  expect(() =>
    requireAdminOrigin(
      request('', {}, { origin: 'https://mycottagepantry.com' }),
    ),
  ).toThrow()
  expect(() =>
    requireAdminOrigin(
      request('', undefined, {
        headers: { 'x-cp-admin': '', 'sec-fetch-site': 'same-site' },
      }),
    ),
  ).toThrow()
  expect(() =>
    requireAdminOrigin(
      request('', undefined, {
        headers: { 'x-forwarded-host': 'admin.mycottagepantry.com' },
        host: 'https://attacker.invalid',
      }),
    ),
  ).toThrow()
})
it('does not permit production administration through a preview hostname and accepts only the configured preview in preview context', () => {
  const preview = 'https://deploy-preview-123--mycottagepantry.netlify.app'
  expect(() =>
    requireAdminOrigin(
      request('', undefined, { host: preview, origin: preview }),
    ),
  ).toThrow()
  runtime.env = { CONTEXT: 'deploy-preview', DEPLOY_URL: preview }
  expect(
    requireAdminOrigin(
      request('', undefined, { host: preview, origin: preview }),
    ),
  ).toBe(preview)
  expect(() =>
    requireAdminOrigin(
      request('', undefined, {
        host: preview.replace('123', '124'),
        origin: preview.replace('123', '124'),
      }),
    ),
  ).toThrow()
})
it('accepts only its runtime preview permalink when build metadata is absent', () => {
  const id = '6af7efbf2a028d658a6274f7'
  const preview = `https://${id}--mycottagepantry.netlify.app`
  runtime.env = {}
  runtime.functionContext = {
    deploy: { id, context: 'deploy-preview', published: false },
    site: { id: '299e7942-6246-467a-bef5-fa3f6817b210' },
  } as Context
  expect(
    requireAdminOrigin(
      request('', undefined, { host: preview, origin: preview }),
    ),
  ).toBe(preview)
  for (const host of [
    'https://6af7efbf2a028d658a6274f8--mycottagepantry.netlify.app',
    'https://deploy-preview-124--mycottagepantry.netlify.app',
  ])
    expect(() =>
      requireAdminOrigin(request('', undefined, { host, origin: host })),
    ).toThrow()
  expect(() =>
    requireAdminOrigin(request('', {}, { host: preview, origin })),
  ).toThrow()
  expect(() =>
    requireAdminOrigin(
      request('', undefined, {
        host: preview,
        origin: preview,
        headers: { 'x-cp-admin': '' },
      }),
    ),
  ).toThrow()
})
it.each(['production', 'branch-deploy'])(
  'rejects preview administration in runtime %s despite stale build metadata',
  (context) => {
    const preview =
      'https://6af7efbf2a028d658a6274f7--mycottagepantry.netlify.app'
    runtime.env = { CONTEXT: 'deploy-preview', DEPLOY_URL: preview }
    runtime.functionContext = {
      deploy: { id: '6af7efbf2a028d658a6274f7', context, published: false },
      site: { id: '299e7942-6246-467a-bef5-fa3f6817b210' },
    } as Context
    expect(() =>
      requireAdminOrigin(
        request('', undefined, { host: preview, origin: preview }),
      ),
    ).toThrow()
  },
)
it('rejects a runtime permalink from a different site', () => {
  const preview =
    'https://6af7efbf2a028d658a6274f7--mycottagepantry.netlify.app'
  runtime.env = {}
  runtime.functionContext = {
    deploy: {
      id: '6af7efbf2a028d658a6274f7',
      context: 'deploy-preview',
      published: false,
    },
    site: { id: 'another-site' },
  } as Context
  expect(() =>
    requireAdminOrigin(
      request('', undefined, { host: preview, origin: preview }),
    ),
  ).toThrow()
})
it('accepts its exact stable preview alias alongside the deployment permalink', () => {
  const stable = 'https://deploy-preview-123--mycottagepantry.netlify.app'
  const permalink = 'https://a1b2c3d4--mycottagepantry.netlify.app'
  runtime.env = {
    CONTEXT: 'deploy-preview',
    DEPLOY_URL: permalink,
    DEPLOY_PRIME_URL: stable,
  }
  for (const host of [stable, permalink]) {
    expect(
      requireAdminOrigin(request('', undefined, { host, origin: host })),
    ).toBe(host)
    expect(requireAdminOrigin(request('', {}, { host, origin: host }))).toBe(
      host,
    )
  }
  const foreign = stable.replace('123', '124')
  expect(() =>
    requireAdminOrigin(
      request('', undefined, {
        host: foreign,
        origin: foreign,
        headers: { 'x-forwarded-host': new URL(stable).host },
      }),
    ),
  ).toThrow()
  expect(() =>
    requireAdminOrigin(request('', {}, { host: stable, origin: permalink })),
  ).toThrow()
  expect(() =>
    requireAdminOrigin(
      request('', undefined, {
        host: stable,
        origin: stable,
        headers: { 'sec-fetch-site': 'same-site' },
      }),
    ),
  ).toThrow()
})
it.each(['production', 'branch-deploy', 'dev', ''])(
  'rejects stable preview administration in %s context',
  (context) => {
    const stable = 'https://deploy-preview-123--mycottagepantry.netlify.app'
    runtime.env = { CONTEXT: context, DEPLOY_PRIME_URL: stable }
    expect(() =>
      requireAdminOrigin(
        request('', undefined, { host: stable, origin: stable }),
      ),
    ).toThrow()
  },
)
it.each([
  'https://deploy-preview-123--mycottagepantry.netlify.app.attacker.invalid',
  'http://deploy-preview-123--mycottagepantry.netlify.app',
  'https://agent-other--mycottagepantry.netlify.app',
  '',
])('rejects an invalid stable preview configuration: %s', (stable) => {
  const host =
    stable || 'https://deploy-preview-123--mycottagepantry.netlify.app'
  runtime.env = { CONTEXT: 'deploy-preview', DEPLOY_PRIME_URL: stable }
  expect(() =>
    requireAdminOrigin(request('', undefined, { host, origin: host })),
  ).toThrow()
})
it('provides searchable paginated metadata without querying or mutating business content', async () => {
  const response = await get('section=customers&q=Cedar&page=1')
  expect(response.status).toBe(200)
  const data = await response.json()
  expect(data.total).toBe(1)
  expect(data.pageSize).toBe(25)
  expect(data.rows[0].id).toBe(oven)
  expect(
    runtime.queries
      .filter((q) => /^(INSERT INTO|UPDATE|DELETE FROM)/.test(q))
      .every((q) => /platform_/.test(q)),
  ).toBe(true)
  expect(
    runtime.queries.some((q) =>
      /FROM (recipes|expenses|finance_transactions|graphic_assets)/.test(q),
    ),
  ).toBe(false)
  const audit = (
    await database.query(
      "SELECT * FROM platform_audit WHERE action='read:customers'",
    )
  ).rows
  expect(audit).toHaveLength(1)
  expect((audit[0] as any).actor_id).toBe('platform-owner')
})
it('projects only safe customer detail, masks subscription references, and does not infer account or feature access', async () => {
  const response = await get('section=customers&id=' + oven)
  expect(response.status).toBe(200)
  const text = await response.text(),
    data = JSON.parse(text)
  expect(text).not.toContain('PRIVATE_')
  expect(text).not.toContain('subscription-sensitive-reference')
  expect(data.billing.subscription_reference).toBe('••••ence')
  expect(data.access.commercialRestrictionsEnabled).toBe(false)
  expect(data.accountStatus).toContain('No global account-status')
  expect(data.integrations[0].recorded_status).toBe('disconnected')
})
it('returns the same nonsecret storage status in Stripe and billing responses', async () => {
  const root =
    randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
  runtime.env.STRIPE_BILLING_ENCRYPTION_KEY = root
  await session()
  const stripe = await handler(
    request('action=stripe', undefined, { token }),
    context,
  )
  expect(stripe.status).toBe(200)
  const stripeText = await stripe.text()
  expect(stripeText).not.toContain(root)
  const stripeData = JSON.parse(stripeText)
  expect(stripeData.encryptionReady).toBe(true)
  expect(stripeData.encryptionStatus).toMatchObject({
    ready: true,
    status: 'valid',
    source: 'netlify',
  })
  const billing = await handler(
    request('section=billing', undefined, { token }),
    context,
  )
  expect(billing.status).toBe(200)
  const billingText = await billing.text()
  expect(billingText).not.toContain(root)
  expect(JSON.parse(billingText).stripe.encryptionStatus).toEqual(
    stripeData.encryptionStatus,
  )
  runtime.env.STRIPE_BILLING_ENCRYPTION_KEY = 'malformed'
  const refreshed = await handler(
    request('action=stripe', undefined, { token }),
    context,
  )
  const refreshedData = await refreshed.json()
  expect(refreshedData.encryptionReady).toBe(false)
  expect(refreshedData.encryptionStatus.status).toBe('invalid_format')
})
it('logs only fixed Stripe runtime statuses in production and preserves authentication and origin checks', async () => {
  const root =
    randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
  const key = 'sk_live_' + randomUUID().replaceAll('-', '')
  runtime.env.STRIPE_BILLING_ENCRYPTION_KEY = root
  runtime.env.STRIPE_LIVE_SECRET_KEY = key
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  try {
    const response = await handler(request('action=stripe'), context)
    expect(response.status).toBe(401)
    const body = await response.text()
    expect(body).not.toContain(root)
    expect(body).not.toContain(key)
    expect(log).toHaveBeenCalledTimes(1)
    const [event, payload] = log.mock.calls[0]
    expect(event).toBe('stripe_runtime_status_v2')
    expect(JSON.parse(String(payload))).toMatchObject({
      encryption: { ready: true, status: 'valid', source: 'netlify' },
      liveCredentialPresent: true,
    })
    expect(String(payload)).not.toContain(root)
    expect(String(payload)).not.toContain(key)
    log.mockClear()
    const denied = await handler(
      request('action=stripe', undefined, {
        host: 'https://untrusted.invalid',
      }),
      context,
    )
    expect(denied.status).toBe(404)
    expect(log).not.toHaveBeenCalled()
  } finally {
    log.mockRestore()
  }
})
it('keeps checkout gated and reports no successful production sync without evidence', async () => {
  await session()
  const billing = await handler(
    request('section=billing', undefined, { token }),
    context,
  )
  expect(billing.status).toBe(200)
  const data = await billing.json()
  expect(data.lastSuccessfulProductionSync).toBeNull()
  expect(data.notice).toContain('Historical billing records are preserved')
  const ops = await handler(
    request('section=operations', undefined, { token }),
    context,
  )
  const diagnostics = await ops.json()
  expect(
    diagnostics.coverage.find((x: any) => x.area === 'Product URL imports')
      .availability,
  ).toBe('unavailable')
  expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE_')
  expect(
    (
      await handler(
        request('', { action: 'override', plan: 'cottage-kitchen' }, { token }),
        context,
      )
    ).status,
  ).toBe(405)
})
it('excludes anonymous and private test Ovens and defines recent account metrics', async () => {
  await database.query(
    "INSERT INTO businesses(id,business_name) VALUES('10000000-0000-4000-8000-000000000003','Anonymous demo') ON CONFLICT DO NOTHING",
  )
  const response = await get('section=overview')
  expect(response.status).toBe(200)
  const data = await response.json()
  expect(data.totals.ovens).toBe(2)
  expect(data.totals.customer_accounts).toBe(2)
  expect(data.definitions.recent_accounts).toContain('30 days')
  expect(data.definitions.failed_jobs).toContain('Unavailable')
})
it('rechecks revoked grants and provider availability on every direct request', async () => {
  const agentToken = 'A'.repeat(43)
  await session(true, 'platform-agent', agentToken)
  expect(
    (
      await handler(
        request('section=plans', undefined, { token: agentToken }),
        context,
      )
    ).status,
  ).toBe(200)
  await database.query(
    "UPDATE platform_admins SET enabled=false WHERE identity_id='platform-agent'",
  )
  expect(
    (
      await handler(
        request('section=plans', undefined, { token: agentToken }),
        context,
      )
    ).status,
  ).toBe(401)
  await session()
  delete runtime.identities['platform-owner']
  expect(
    (await handler(request('section=customers', undefined, { token }), context))
      .status,
  ).toBe(503)
})
it('cannot remove the last enabled platform owner and protects audit rows against updates and deletion', async () => {
  await expect(
    database.query(
      "UPDATE platform_admins SET enabled=false WHERE identity_id='platform-owner'",
    ),
  ).rejects.toThrow('last enabled platform owner')
  await get('section=overview')
  await expect(
    database.query("UPDATE platform_audit SET outcome='changed'"),
  ).rejects.toThrow('immutable')
  await expect(database.query('DELETE FROM platform_audit')).rejects.toThrow(
    'immutable',
  )
})
it('rejects expired sessions and arbitrary or nonexistent Oven IDs', async () => {
  await session()
  await database.query(
    "UPDATE platform_sessions SET expires_at=NOW()-INTERVAL '1 second'",
  )
  expect(
    (await handler(request('section=customers', undefined, { token }), context))
      .status,
  ).toBe(401)
  await database.query(
    "UPDATE platform_sessions SET expires_at=NOW()+INTERVAL '10 minutes'",
  )
  expect(
    (
      await handler(
        request('section=customers&id=not-a-uuid', undefined, { token }),
        context,
      )
    ).status,
  ).toBe(400)
  expect(
    (
      await handler(
        request(
          'section=customers&id=10000000-0000-4000-8000-000000000099',
          undefined,
          { token },
        ),
        context,
      )
    ).status,
  ).toBe(404)
})
it('persists login rate limits across failed requests and ignores browser forwarded IP headers', async () => {
  runtime.loginId = 'customer-owner'
  for (let i = 0; i < 5; i++)
    expect(
      (
        await handler(
          request(
            'action=login',
            { email: 'customer@example.invalid', password: 'test-password' },
            { headers: { 'x-forwarded-for': '198.51.100.' + i } },
          ),
          context,
        )
      ).status,
    ).toBe(401)
  const blocked = await handler(
    request('action=login', {
      email: 'customer@example.invalid',
      password: 'test-password',
    }),
    context,
  )
  expect(blocked.status).toBe(429)
  expect(blocked.headers.get('retry-after')).toBe('600')
})
it('binds optional MFA challenges to the session and consumes invalid responses without upgrading factor state', async () => {
  await session(false)
  const options = await handler(
    request('action=mfa-options', { kind: 'registration' }, { token }),
    context,
  )
  expect(options.status).toBe(200)
  const data = await options.json()
  expect(data.options.rp.id).toBe('admin.mycottagepantry.com')
  expect(data.options.authenticatorSelection.userVerification).toBe('required')
  expect(
    data.options.authenticatorSelection.authenticatorAttachment,
  ).toBeUndefined()
  expect(data.options.hints).toEqual([
    'client-device',
    'hybrid',
    'security-key',
  ])
  const failure = await handler(
    request('action=mfa-verify', { id: 'invalid-response' }, { token }),
    context,
  )
  expect(failure.status).toBe(403)
  const row = (
    await database.query<any>('SELECT challenge,mfa_at FROM platform_sessions')
  ).rows[0]
  expect(row.challenge).toBeNull()
  expect(row.mfa_at).toBeNull()
  const replay = await handler(
    request('action=mfa-verify', { id: 'invalid-response' }, { token }),
    context,
  )
  expect((await replay.json()).code).toBe('MFA_CHALLENGE_EXPIRED')
})
it.each([
  ['internal', null],
  ['hybrid', null],
  ['usb', null],
  ['internal', 'origin'],
  ['hybrid', 'rp-id'],
  ['usb', 'challenge'],
  ['internal', 'user-verification'],
])(
  'validates a real signed %s WebAuthn assertion (fault: %s), session rotation and replay',
  async (transport, fault) => {
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const jwk = keys.publicKey.export({ format: 'jwk' })
    // COSE EC2 key: map {1:2,3:-7,-1:1,-2:x,-3:y}.
    const cose = Buffer.concat([
      Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
      Buffer.from(jwk.x!, 'base64url'),
      Buffer.from([0x22, 0x58, 0x20]),
      Buffer.from(jwk.y!, 'base64url'),
    ])
    const credentialId = Buffer.from('test-webauthn-credential').toString(
      'base64url',
    )
    await database.query(
      'INSERT INTO platform_credentials(id,identity_id,public_key,counter,transports) VALUES($1,$2,$3,0,$4)',
      [
        credentialId,
        'platform-owner',
        cose.toString('base64url'),
        JSON.stringify([transport]),
      ],
    )
    await session(false)
    const response = await handler(
      request('action=mfa-options', { kind: 'authentication' }, { token }),
      context,
    )
    const { options } = await response.json()
    expect(options.allowCredentials).toEqual([
      { id: credentialId, type: 'public-key' },
    ])
    expect(options.userVerification).toBe('required')
    const client = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge:
          fault === 'challenge' ? 'incorrect-challenge' : options.challenge,
        origin: fault === 'origin' ? 'https://mycottagepantry.com' : origin,
        crossOrigin: false,
      }),
    )
    const counter = Buffer.alloc(4)
    counter.writeUInt32BE(1)
    const authenticator = Buffer.concat([
      createHash('sha256')
        .update(
          fault === 'rp-id'
            ? 'mycottagepantry.com'
            : 'admin.mycottagepantry.com',
        )
        .digest(),
      Buffer.from([fault === 'user-verification' ? 0x01 : 0x05]),
      counter,
    ])
    const signature = sign(
      'sha256',
      Buffer.concat([
        authenticator,
        createHash('sha256').update(client).digest(),
      ]),
      keys.privateKey,
    )
    const assertion = {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: client.toString('base64url'),
        authenticatorData: authenticator.toString('base64url'),
        signature: signature.toString('base64url'),
        userHandle: Buffer.from('platform-owner').toString('base64url'),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'cross-platform',
    }
    const verified = await handler(
      request('action=mfa-verify', assertion, { token }),
      context,
    )
    if (fault) {
      expect(verified.status).toBe(403)
      expect(verified.headers.get('set-cookie')).toBeNull()
      expect(
        (
          await database.query<any>(
            'SELECT challenge,mfa_at FROM platform_sessions',
          )
        ).rows[0],
      ).toEqual({ challenge: null, mfa_at: null })
      expect(
        (
          await handler(
            request('section=overview', undefined, { token }),
            context,
          )
        ).status,
      ).toBe(200)
      return
    }
    expect(verified.status).toBe(200)
    expect((await verified.json()).stage).toBe('authenticated')
    const cookie = verified.headers.get('set-cookie')!,
      newToken = cookie.match(/__Host-cp_admin=([^;]+)/)![1]
    expect(newToken).not.toBe(token)
    expect(
      (
        await handler(
          request('section=overview', undefined, { token: newToken }),
          context,
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await handler(
          request('section=overview', undefined, { token }),
          context,
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await handler(
          request('action=mfa-verify', assertion, { token: newToken }),
          context,
        )
      ).status,
    ).toBe(403)
  },
)
it('enforces the same password session, host and identity checks on legacy admin APIs and file access', async () => {
  await expect(
    requireLegacyAdmin(
      new Request(
        'https://mycottagepantry.com/api/support?view=staff&attachment=' + oven,
      ),
      'platform-owner',
    ),
  ).rejects.toThrow()
  await session(false)
  await expect(
    requireLegacyAdmin(request('', undefined, { token }), 'platform-owner'),
  ).resolves.toBeUndefined()
  await expect(
    requireLegacyAdmin(request('', undefined, { token }), 'platform-agent'),
  ).rejects.toThrow('Administrator identities do not match')
})

it.each([
  ['device', 'client-device'],
  ['phone', 'hybrid'],
  ['security-key', 'security-key'],
])(
  'prefers %s without forcing attachment or changing enrolled credentials and deadlines',
  async (method, hint) => {
    await session(false)
    const before = (
      await database.query(
        'SELECT enrollment_until FROM platform_admins WHERE identity_id=$1',
        ['platform-owner'],
      )
    ).rows[0]
    const registration = await handler(
      request(
        'action=mfa-options',
        { kind: 'registration', method },
        { token },
      ),
      context,
    )
    const prepared = await registration.json()
    expect(registration.status).toBe(200)
    expect(prepared.options.hints[0]).toBe(hint)
    expect(prepared.options.hints).toHaveLength(3)
    expect(
      prepared.options.authenticatorSelection.authenticatorAttachment,
    ).toBeUndefined()
    expect(prepared.options.authenticatorSelection.userVerification).toBe(
      'required',
    )
    expect(Date.parse(prepared.expiresAt)).toBeGreaterThan(Date.now())
    const ownId = Buffer.from('own-credential').toString('base64url')
    const otherId = Buffer.from('other-credential').toString('base64url')
    await database.query(
      "INSERT INTO platform_credentials(id,identity_id,public_key,transports) VALUES($1,'platform-owner','preserved-key','[\"usb\"]'),($2,'platform-agent','other-key','[\"internal\"]')",
      [ownId, otherId],
    )
    const authentication = await handler(
      request(
        'action=mfa-options',
        { kind: 'authentication', method },
        { token },
      ),
      context,
    )
    const options = (await authentication.json()).options
    expect(options.hints[0]).toBe(hint)
    expect(options.allowCredentials).toEqual([
      { id: ownId, type: 'public-key' },
    ])
    expect(options.allowCredentials[0]).not.toHaveProperty('transports')
    expect(options.userVerification).toBe('required')
    const blocked = await handler(
      request(
        'action=mfa-options',
        { kind: 'registration', method },
        { token },
      ),
      context,
    )
    expect(blocked.status).toBe(403)
    expect(
      (
        await database.query(
          'SELECT enrollment_until FROM platform_admins WHERE identity_id=$1',
          ['platform-owner'],
        )
      ).rows[0],
    ).toEqual(before)
    expect(
      (
        await database.query(
          'SELECT public_key,transports FROM platform_credentials WHERE id=$1',
          [ownId],
        )
      ).rows[0],
    ).toEqual({ public_key: 'preserved-key', transports: ['usb'] })
    const history = (
      await database.query<any>(
        "SELECT after FROM platform_audit WHERE action='mfa_challenge' ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0].after
    expect(history).toEqual({
      kind: 'authentication',
      method,
      credentialCount: 1,
      transportFilter: false,
    })
  },
)

it('reports the exact account, credential routes and enrollment deadline only to its password-verified session', async () => {
  await session(false)
  let response = await handler(
    request('action=session', undefined, { token }),
    context,
  )
  let data = await response.json()
  expect(data.stage).toBe('authenticated')
  expect(data.identityEmail).toBe('platform-owner@example.invalid')
  expect(data.enrollmentAvailable).toBe(true)
  expect(data.credentials).toEqual([])
  expect(Date.parse(data.enrollmentUntil)).toBeGreaterThan(Date.now())
  await database.query(
    "INSERT INTO platform_credentials(id,identity_id,public_key,transports) VALUES('PRIVATE_CREDENTIAL_ID','platform-owner','PRIVATE_PUBLIC_KEY','[\"internal\",\"hybrid\"]')",
  )
  response = await handler(
    request('action=session', undefined, { token }),
    context,
  )
  const body = await response.text()
  data = JSON.parse(body)
  expect(data.stage).toBe('authenticated')
  expect(data.enrollmentAvailable).toBe(false)
  expect(data.credentials).toEqual([
    { transports: ['internal', 'hybrid'], createdAt: expect.any(String) },
  ])
  expect(body).not.toContain('PRIVATE_')
  expect(body).not.toContain('challenge')
  expect((await handler(request('action=session'), context)).status).toBe(401)
})

it('denies direct legacy registration operations and private mutations without a portal session', async () => {
  runtime.env = {
    CONTEXT: 'deploy-preview',
    REGISTRATION_PRIVATE_TESTS_ENABLED: 'true',
  }
  runtime.identities['platform-owner'].roles = ['platform_admin']
  const operations = await registration(
    new Request('https://mycottagepantry.com/api/registration?view=operations'),
  )
  expect(operations.status).toBe(404)
  const mutate = await registration(
    new Request('https://mycottagepantry.com/api/registration', {
      method: 'POST',
      headers: {
        origin: 'https://mycottagepantry.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'reconcileSandbox' }),
    }),
  )
  expect(mutate.status).toBe(404)
  const staffFile = await support(
    new Request(
      'https://mycottagepantry.com/api/support?view=staff&attachment=' + oven,
    ),
  )
  expect(staffFile.status).toBe(404)
})

it.each(['internal', 'hybrid', 'usb'])(
  'enrolls a real %s WebAuthn public key only within the controlled window and audits safe before/after state',
  async (transport) => {
    await session(false)
    const optionsResponse = await handler(
      request('action=mfa-options', { kind: 'registration' }, { token }),
      context,
    )
    const { options } = await optionsResponse.json()
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const jwk = keys.publicKey.export({ format: 'jwk' })
    const cose = Buffer.concat([
      Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
      Buffer.from(jwk.x!, 'base64url'),
      Buffer.from([0x22, 0x58, 0x20]),
      Buffer.from(jwk.y!, 'base64url'),
    ])
    const credentialId = Buffer.from('enrollment-credential-id')
    const length = Buffer.alloc(2)
    length.writeUInt16BE(credentialId.length)
    const authenticator = Buffer.concat([
      createHash('sha256').update('admin.mycottagepantry.com').digest(),
      Buffer.from([0x45]),
      Buffer.alloc(4),
      Buffer.alloc(16),
      length,
      credentialId,
      cose,
    ])
    const authLength = Buffer.alloc(2)
    authLength.writeUInt16BE(authenticator.length)
    // CBOR attestation map: { fmt:'none', attStmt:{}, authData:bytes }.
    const attestation = Buffer.concat([
      Buffer.from([0xa3, 0x63]),
      Buffer.from('fmt'),
      Buffer.from([0x64]),
      Buffer.from('none'),
      Buffer.from([0x67]),
      Buffer.from('attStmt'),
      Buffer.from([0xa0, 0x68]),
      Buffer.from('authData'),
      Buffer.from([0x59]),
      authLength,
      authenticator,
    ])
    const client = Buffer.from(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: options.challenge,
        origin,
        crossOrigin: false,
      }),
    )
    const registration = {
      id: credentialId.toString('base64url'),
      rawId: credentialId.toString('base64url'),
      type: 'public-key',
      response: {
        clientDataJSON: client.toString('base64url'),
        attestationObject: attestation.toString('base64url'),
        transports: [transport],
      },
      clientExtensionResults: {},
    }
    const registered = await handler(
      request('action=mfa-verify', registration, { token }),
      context,
    )
    expect(registered.status).toBe(200)
    const credentials = (
      await database.query<any>('SELECT * FROM platform_credentials')
    ).rows
    expect(credentials).toHaveLength(1)
    expect(credentials[0].public_key).toBe(cose.toString('base64url'))
    expect(credentials[0].transports).toEqual([transport])
    const history = (
      await database.query<any>(
        "SELECT * FROM platform_audit WHERE action='mfa_enrolled'",
      )
    ).rows[0]
    expect(history.before).toEqual({ mfaEnrolled: false })
    expect(history.target).toBe('platform-owner')
    expect(history.after).toEqual({ mfaEnrolled: true })
    expect(JSON.stringify(history)).not.toContain(cose.toString('base64url'))
    expect(
      (
        await database.query<any>(
          "SELECT enrollment_until FROM platform_admins WHERE identity_id='platform-owner'",
        )
      ).rows[0].enrollment_until,
    ).toBeNull()
    // Sign out the registration session, then authenticate the same enrolled
    // public key in a fresh password-only session. Transport is metadata only.
    const enrolledToken = registered.headers
      .get('set-cookie')!
      .match(/__Host-cp_admin=([^;]+)/)![1]
    await handler(
      request('action=logout', {}, { token: enrolledToken }),
      context,
    )
    await session(false)
    const subsequent = await handler(
      request(
        'action=mfa-options',
        {
          kind: 'authentication',
          method: transport === 'hybrid' ? 'phone' : 'device',
        },
        { token },
      ),
      context,
    )
    const nextOptions = (await subsequent.json()).options
    const authenticationClient = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: nextOptions.challenge,
        origin,
        crossOrigin: false,
      }),
    )
    const authenticationData = Buffer.concat([
      createHash('sha256').update('admin.mycottagepantry.com').digest(),
      Buffer.from([0x05]),
      Buffer.from([0, 0, 0, 1]),
    ])
    const authentication = await handler(
      request(
        'action=mfa-verify',
        {
          id: credentialId.toString('base64url'),
          rawId: credentialId.toString('base64url'),
          type: 'public-key',
          response: {
            clientDataJSON: authenticationClient.toString('base64url'),
            authenticatorData: authenticationData.toString('base64url'),
            signature: sign(
              'sha256',
              Buffer.concat([
                authenticationData,
                createHash('sha256').update(authenticationClient).digest(),
              ]),
              keys.privateKey,
            ).toString('base64url'),
          },
          clientExtensionResults: {},
        },
        { token },
      ),
      context,
    )
    expect(authentication.status).toBe(200)
    const authenticatedToken = authentication.headers
      .get('set-cookie')!
      .match(/__Host-cp_admin=([^;]+)/)![1]
    expect(
      (
        await handler(
          request('section=overview', undefined, { token: authenticatedToken }),
          context,
        )
      ).status,
    ).toBe(200)
    expect(
      (await database.query('SELECT id FROM platform_credentials')).rows,
    ).toHaveLength(1)
  },
)

it('closes expired enrollment and keeps raw customer content and writes outside platform metadata permissions', async () => {
  await session(false)
  await database.query(
    "UPDATE platform_admins SET enrollment_until=NOW()-INTERVAL '1 minute' WHERE identity_id='platform-owner'",
  )
  expect(
    (
      await handler(
        request('action=mfa-options', { kind: 'registration' }, { token }),
        context,
      )
    ).status,
  ).toBe(403)
  await database.exec(
    "BEGIN;SET LOCAL ROLE portal_test;SELECT set_config('app.platform_read','true',true);",
  )
  try {
    expect(
      (await database.query('SELECT * FROM platform_admins')).rows,
    ).toHaveLength(0)
    expect(
      (await database.query('SELECT * FROM platform_sessions')).rows,
    ).toHaveLength(0)
    expect((await database.query('SELECT * FROM recipes')).rows).toHaveLength(0)
    expect(
      (
        await database.query(
          'UPDATE users SET active=false RETURNING identity_id',
        )
      ).rows,
    ).toHaveLength(0)
  } finally {
    await database.exec('ROLLBACK')
  }
  expect(
    (await database.query<any>('SELECT active FROM users')).rows.every(
      (r) => r.active,
    ),
  ).toBe(true)
})
it('routes only the admin host and keeps customer /oven handling unchanged', async () => {
  expect(
    (await hostRouter(new Request(origin + '/')))?.headers.get('location'),
  ).toBe(origin + '/admin')
  expect((await hostRouter(new Request(origin + '/oven')))?.status).toBe(404)
  expect(
    (await hostRouter(new Request(origin + '/api/workspace')))?.status,
  ).toBe(404)
  expect(
    await hostRouter(new Request('https://mycottagepantry.com/oven')),
  ).toBeUndefined()
  expect(
    await hostRouter(
      new Request(origin + '/admin?section=customers&id=' + oven),
    ),
  ).toBeUndefined()
})

it('allows the Identity recovery and session endpoints without opening customer APIs', async () => {
  for (const path of [
    '/.netlify/identity/settings',
    '/.netlify/identity/token',
    '/.netlify/identity/recover',
    '/.netlify/identity/verify',
    '/.netlify/identity/user',
    '/.netlify/identity/logout',
    '/.netlify/identity/admin/users/verified-id',
  ])
    expect(await hostRouter(new Request(origin + path))).toBeUndefined()
  for (const path of [
    '/api/account-access',
    '/api/registration',
    '/api/workspace',
    '/oven',
  ])
    expect((await hostRouter(new Request(origin + path)))?.status).toBe(404)
  for (const path of ['/recover', '/login', '/verify-email']) {
    const response = await hostRouter(
      new Request(origin + path + '?from=email'),
    )
    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe(origin + '/admin?from=email')
  }
})

it('requests password recovery without creating an admin session or exposing account existence', async () => {
  const known = await handler(
    request('action=password-recovery', { email: 'owner@example.invalid' }),
    context,
  )
  expect(known.status).toBe(200)
  expect(known.headers.has('Set-Cookie')).toBe(false)
  runtime.recoveryStatus = 404
  const missing = await handler(
    request('action=password-recovery', { email: 'unknown@example.invalid' }),
    context,
  )
  expect(missing.status).toBe(200)
  expect(await missing.json()).toEqual(await known.json())
  expect(
    (await database.query('SELECT * FROM platform_sessions')).rows,
  ).toHaveLength(0)
})
it('rate limits password recovery and rejects cross-origin requests before sending email', async () => {
  const blocked = await handler(
    request(
      'action=password-recovery',
      { email: 'owner@example.invalid' },
      { origin: 'https://evil.example' },
    ),
    context,
  )
  expect(blocked.status).toBe(403)
  for (let i = 0; i < 3; i++) {
    expect(
      (
        await handler(
          request('action=password-recovery', {
            email: 'owner@example.invalid',
          }),
          context,
        )
      ).status,
    ).toBe(200)
  }
  expect(
    (
      await handler(
        request('action=password-recovery', { email: 'owner@example.invalid' }),
        context,
      )
    ).status,
  ).toBe(429)
})
it('reports recovery service failures without reporting that an email was sent', async () => {
  runtime.recoveryStatus = 503
  const response = await handler(
    request('action=password-recovery', { email: 'owner@example.invalid' }),
    context,
  )
  expect(response.status).toBe(503)
  expect(await response.text()).toContain('temporarily unavailable')
})

// TOTP exercises run through the same HTTP gateway, RLS role, and Identity checks.
async function phonePasskey() {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = keys.publicKey.export({ format: 'jwk' })
  const cose = Buffer.concat([
    Buffer.from([0xa5, 1, 2, 3, 0x26, 0x20, 1, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x!, 'base64url'),
    Buffer.from([0x22, 0x58, 0x20]),
    Buffer.from(jwk.y!, 'base64url'),
  ])
  const id = Buffer.from('existing-phone-passkey').toString('base64url')
  await database.query(
    'INSERT INTO platform_credentials(id,identity_id,public_key,transports) VALUES($1,$2,$3,$4)',
    [id, 'platform-owner', cose.toString('base64url'), '["internal","hybrid"]'],
  )
  let count = 0
  return async (purpose?: string) => {
    const prepared = await handler(
      request(
        'action=mfa-options',
        { kind: 'authentication', ...(purpose ? { purpose } : {}) },
        { token },
      ),
      context,
    )
    expect(prepared.status).toBe(200)
    const { options } = await prepared.json()
    const client = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: options.challenge,
        origin,
        crossOrigin: false,
      }),
    )
    const counter = Buffer.alloc(4)
    counter.writeUInt32BE(++count)
    const authenticator = Buffer.concat([
      createHash('sha256').update('admin.mycottagepantry.com').digest(),
      Buffer.from([5]),
      counter,
    ])
    const signature = sign(
      'sha256',
      Buffer.concat([
        authenticator,
        createHash('sha256').update(client).digest(),
      ]),
      keys.privateKey,
    )
    return handler(
      request(
        'action=mfa-verify',
        {
          id,
          rawId: id,
          type: 'public-key',
          response: {
            clientDataJSON: client.toString('base64url'),
            authenticatorData: authenticator.toString('base64url'),
            signature: signature.toString('base64url'),
            userHandle: Buffer.from('platform-owner').toString('base64url'),
          },
          clientExtensionResults: {},
        },
        { token },
      ),
      context,
    )
  }
}
async function startTotp() {
  runtime.env.ADMIN_MFA_ENCRYPTION_KEY = 'ab'.repeat(32)
  await session(true)
  const authorize = await phonePasskey()
  const result = await authorize('totp-enroll')
  expect(result.status).toBe(200)
  const setup = await result.json()
  expect(setup.stage).toBe('totp_setup')
  const row = (await database.query<any>('SELECT * FROM platform_totp')).rows[0]
  const secret = openSecret(row.pending_ciphertext, 'platform-owner')
  return { authorize, setup, secret }
}
async function activateTotp() {
  const state = await startTotp()
  const confirmation = await handler(
    request(
      'action=totp-confirm',
      { code: totpCode(state.secret, Math.floor(Date.now() / 30000)) },
      { token },
    ),
    context,
  )
  expect(confirmation.status).toBe(200)
  const result = await confirmation.json()
  expect(result.recoveryCodes).toHaveLength(10)
  return { ...state, codes: result.recoveryCodes as string[] }
}

it('enrolls TOTP only after fresh signed phone verification and confirmation, preserving the phone credential and grant', async () => {
  const { setup, secret } = await startTotp()
  expect(setup.uri).toMatch(/^otpauth:\/\/totp\//)
  const pending = (await database.query<any>('SELECT * FROM platform_totp'))
    .rows[0]
  expect(pending.enabled_at).toBeNull()
  expect(pending.secret_ciphertext).toBeNull()
  expect(pending.pending_ciphertext).not.toContain(setup.secret)
  expect(
    (
      await handler(
        request(
          'action=totp-verify',
          { code: totpCode(secret, Math.floor(Date.now() / 30000)) },
          { token },
        ),
        context,
      )
    ).status,
  ).toBe(403)
  const confirmation = await handler(
    request(
      'action=totp-confirm',
      { code: totpCode(secret, Math.floor(Date.now() / 30000)) },
      { token },
    ),
    context,
  )
  expect(confirmation.status).toBe(200)
  const codes = (await confirmation.json()).recoveryCodes
  const row = (await database.query<any>('SELECT * FROM platform_totp')).rows[0]
  expect(row.enabled_at).toBeTruthy()
  expect(row.pending_ciphertext).toBeNull()
  expect(row.secret_ciphertext).not.toContain(setup.secret)
  expect(
    (await database.query('SELECT * FROM platform_credentials')).rows,
  ).toHaveLength(1)
  expect(
    (
      await database.query<any>(
        'SELECT role FROM platform_admins WHERE identity_id=$1',
        ['platform-owner'],
      )
    ).rows[0].role,
  ).toBe('owner')
  const storedCodes = (
    await database.query<any>('SELECT code_hash FROM platform_recovery_codes')
  ).rows
  expect(JSON.stringify(storedCodes)).not.toContain(codes[0])
  const audits = (await database.query('SELECT * FROM platform_audit')).rows
  expect(JSON.stringify(audits)).not.toContain(setup.secret)
  expect(JSON.stringify(audits)).not.toContain(codes[0])
  // Confirmation consumes its own time step, so it cannot immediately log in again.
  expect(
    (
      await handler(
        request(
          'action=totp-verify',
          { code: totpCode(secret, Math.floor(Date.now() / 30000)) },
          { token },
        ),
        context,
      )
    ).status,
  ).toBe(403)
})

it('requires authenticated phone session, a fresh bound passkey assertion and same-session unexpired setup', async () => {
  runtime.env.ADMIN_MFA_ENCRYPTION_KEY = 'ab'.repeat(32)
  await session(false)
  expect(
    (
      await handler(
        request(
          'action=mfa-options',
          { kind: 'authentication', purpose: 'totp-enroll' },
          { token },
        ),
        context,
      )
    ).status,
  ).toBe(403)
  expect(
    (
      await handler(
        request('action=totp-confirm', { code: '123456' }, { token }),
        context,
      )
    ).status,
  ).toBe(403)
  await database.query('UPDATE platform_sessions SET mfa_at=NOW()')
  expect(
    (
      await handler(
        request('action=totp-confirm', { code: '123456' }, { token }),
        context,
      )
    ).status,
  ).toBe(403)
  const authorize = await phonePasskey()
  await authorize('totp-enroll')
  await session(true, 'platform-owner', 'S'.repeat(43))
  expect(
    (
      await handler(
        request(
          'action=totp-confirm',
          { code: '123456' },
          { token: 'S'.repeat(43) },
        ),
        context,
      )
    ).status,
  ).toBe(403)
  await database.query(
    "UPDATE platform_totp SET pending_until=NOW()-INTERVAL '1 second'",
  )
  expect(
    (
      await handler(
        request('action=totp-confirm', { code: '123456' }, { token }),
        context,
      )
    ).status,
  ).toBe(403)
})

it('rejects simultaneous code replay, rotates the admin session, permits dashboard access, and denies logout reuse', async () => {
  const { secret } = await activateTotp()
  await database.query('UPDATE platform_totp SET last_step=-1')
  await database.query('UPDATE platform_sessions SET mfa_at=NULL')
  const code = totpCode(secret, Math.floor(Date.now() / 30000))
  const results = await Promise.all(
    [1, 2].map(() =>
      handler(request('action=totp-verify', { code }, { token }), context),
    ),
  )
  expect(results.filter((r) => r.status === 200)).toHaveLength(1)
  const good = results.find((r) => r.status === 200)!
  const fresh = /__Host-cp_admin=([^;]+)/.exec(
    good.headers.get('set-cookie')!,
  )![1]
  expect(fresh).not.toBe(token)
  expect(
    (
      await handler(
        request('section=overview', undefined, { token: fresh }),
        context,
      )
    ).status,
  ).toBe(200)
  expect(
    (await handler(request('action=session', undefined, { token }), context))
      .status,
  ).toBe(401)
  expect(
    (await handler(request('action=logout', {}, { token: fresh }), context))
      .status,
  ).toBe(200)
  expect(
    (
      await handler(
        request('section=overview', undefined, { token: fresh }),
        context,
      )
    ).status,
  ).toBe(401)
})

it('consumes recovery codes once with a password-verified session and leaves the existing passkey usable', async () => {
  const { codes, authorize } = await activateTotp()
  expect(
    (await handler(request('action=totp-recover', { code: codes[0] }), context))
      .status,
  ).toBe(401)
  await database.query('UPDATE platform_sessions SET mfa_at=NULL')
  const response = await handler(
    request('action=totp-recover', { code: codes[0] }, { token }),
    context,
  )
  expect(response.status).toBe(200)
  const fresh = /__Host-cp_admin=([^;]+)/.exec(
    response.headers.get('set-cookie')!,
  )![1]
  expect(
    (
      await handler(
        request('section=overview', undefined, { token: fresh }),
        context,
      )
    ).status,
  ).toBe(200)
  await session(false)
  expect(
    (
      await handler(
        request('action=totp-recover', { code: codes[0] }, { token }),
        context,
      )
    ).status,
  ).toBe(403)
  // Existing phone key still signs in normally after TOTP enrollment and recovery.
  const phone = await authorize()
  expect(phone.status).toBe(200)
  const phoneToken = /__Host-cp_admin=([^;]+)/.exec(
    phone.headers.get('set-cookie')!,
  )![1]
  expect(
    (
      await handler(
        request('section=overview', undefined, { token: phoneToken }),
        context,
      )
    ).status,
  ).toBe(200)
})

it('requires a fresh passkey to regenerate recovery codes or remove TOTP, revoking codes and other sessions on removal', async () => {
  const { authorize, codes } = await activateTotp()
  expect(
    (await handler(request('action=totp-remove', {}, { token }), context))
      .status,
  ).toBe(404)
  const regenerated = await authorize('totp-recovery')
  expect(regenerated.status).toBe(200)
  const newCodes = (await regenerated.json()).recoveryCodes
  expect(newCodes).not.toContain(codes[0])
  const oldHash = hash('platform-owner:' + codes[0].replaceAll('-', ''))
  expect(
    (
      await database.query(
        'SELECT * FROM platform_recovery_codes WHERE code_hash=$1',
        [oldHash],
      )
    ).rows,
  ).toHaveLength(0)
  await session(true, 'platform-owner', 'S'.repeat(43))
  expect((await authorize('totp-remove')).status).toBe(200)
  expect(
    (await database.query('SELECT * FROM platform_totp')).rows,
  ).toHaveLength(0)
  expect(
    (await database.query('SELECT * FROM platform_recovery_codes')).rows,
  ).toHaveLength(0)
  expect(
    (
      await handler(
        request('action=session', undefined, { token: 'S'.repeat(43) }),
        context,
      )
    ).status,
  ).toBe(401)
  expect(
    (await handler(request('section=overview', undefined, { token }), context))
      .status,
  ).toBe(200)
  expect(
    (await database.query('SELECT * FROM platform_credentials')).rows,
  ).toHaveLength(1)
})

it('rate-limits invalid TOTP attempts persistently across password-only sessions and rejects revoked grants', async () => {
  const { secret } = await activateTotp()
  await database.exec('TRUNCATE platform_limits')
  await database.query('UPDATE platform_sessions SET mfa_at=NULL')
  for (let i = 0; i < 10; i++)
    expect(
      (
        await handler(
          request('action=totp-verify', { code: 'bad' }, { token }),
          context,
        )
      ).status,
    ).toBe(403)
  const good = totpCode(secret, Math.floor(Date.now() / 30000) + 1)
  expect(
    (
      await handler(
        request('action=totp-verify', { code: good }, { token }),
        context,
      )
    ).status,
  ).toBe(429)
  await database.exec('TRUNCATE platform_limits')
  await database.query(
    'UPDATE platform_admins SET epoch=epoch+1 WHERE identity_id=$1',
    ['platform-owner'],
  )
  expect(
    (
      await handler(
        request('action=totp-recover', { code: 'not-used' }, { token }),
        context,
      )
    ).status,
  ).toBe(401)
})

it('cancels pending enrollment without enabling or removing methods, and fails closed without the encryption key', async () => {
  const { secret } = await startTotp()
  expect(
    (await handler(request('action=totp-cancel', {}, { token }), context))
      .status,
  ).toBe(200)
  expect(
    (
      await handler(
        request(
          'action=totp-confirm',
          { code: totpCode(secret, Math.floor(Date.now() / 30000)) },
          { token },
        ),
        context,
      )
    ).status,
  ).toBe(403)
  const row = (await database.query<any>('SELECT * FROM platform_totp')).rows[0]
  expect(row.pending_ciphertext).toBeNull()
  delete runtime.env.ADMIN_MFA_ENCRYPTION_KEY
  expect(
    (
      await handler(
        request(
          'action=mfa-options',
          { kind: 'authentication', purpose: 'totp-enroll' },
          { token },
        ),
        context,
      )
    ).status,
  ).toBe(503)
  expect(
    (await handler(request('section=overview', undefined, { token }), context))
      .status,
  ).toBe(200)
})

it('isolates TOTP by account, enforces origin/session expiry/provider checks, and denies non-gateway reads', async () => {
  const { secret, codes } = await activateTotp()
  await session(false, 'platform-agent', 'S'.repeat(43))
  expect(
    (
      await handler(
        request(
          'action=totp-recover',
          { code: codes[0] },
          { token: 'S'.repeat(43) },
        ),
        context,
      )
    ).status,
  ).toBe(403)
  expect(
    (
      await handler(
        request(
          'action=totp-verify',
          { code: totpCode(secret, Math.floor(Date.now() / 30000) + 1) },
          { token, origin: 'https://attacker.example' },
        ),
        context,
      )
    ).status,
  ).toBe(403)
  await database.exec('SET ROLE portal_test')
  expect(
    (await database.query('SELECT * FROM platform_totp')).rows,
  ).toHaveLength(0)
  expect(
    (await database.query('SELECT * FROM platform_recovery_codes')).rows,
  ).toHaveLength(0)
  await database.exec('RESET ROLE')
  delete runtime.identities['platform-owner']
  expect(
    (
      await handler(
        request('action=totp-recover', { code: codes[0] }, { token }),
        context,
      )
    ).status,
  ).toBe(503)
  expect(
    (
      await database.query<any>(
        'SELECT used_at FROM platform_recovery_codes WHERE code_hash=$1',
        [hash('platform-owner:' + codes[0].replaceAll('-', ''))],
      )
    ).rows[0].used_at,
  ).toBeNull()
  await database.query(
    "UPDATE platform_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=$1",
    [hash(token)],
  )
  expect(
    (
      await handler(
        request('action=totp-recover', { code: codes[0] }, { token }),
        context,
      )
    ).status,
  ).toBe(401)
})

it('atomically rejects reuse of one recovery code across two password-verified sessions', async () => {
  const { codes } = await activateTotp()
  await database.query('UPDATE platform_sessions SET mfa_at=NULL')
  await session(false, 'platform-owner', 'S'.repeat(43))
  const results = await Promise.all(
    [token, 'S'.repeat(43)].map((t) =>
      handler(
        request('action=totp-recover', { code: codes[0] }, { token: t }),
        context,
      ),
    ),
  )
  expect(results.map((r) => r.status).sort()).toEqual([200, 403])
})

it('refuses an invalid fresh assertion for TOTP enrollment and consumes its challenge', async () => {
  runtime.env.ADMIN_MFA_ENCRYPTION_KEY = 'ab'.repeat(32)
  await session(true)
  await phonePasskey()
  expect(
    (
      await handler(
        request(
          'action=mfa-options',
          { kind: 'authentication', purpose: 'totp-enroll' },
          { token },
        ),
        context,
      )
    ).status,
  ).toBe(200)
  expect(
    (
      await handler(
        request('action=mfa-verify', { id: 'invalid-signature' }, { token }),
        context,
      )
    ).status,
  ).toBe(403)
  expect(
    (await database.query('SELECT * FROM platform_totp')).rows,
  ).toHaveLength(0)
  expect(
    (
      await database.query<any>(
        'SELECT challenge FROM platform_sessions WHERE token_hash=$1',
        [hash(token)],
      )
    ).rows[0].challenge,
  ).toBeNull()
})

it('rolls back activation and recovery-code generation if the immutable audit write fails', async () => {
  const { secret } = await startTotp()
  await database.exec(
    "CREATE FUNCTION reject_totp_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='totp_enrolled' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_totp_audit BEFORE INSERT ON platform_audit FOR EACH ROW EXECUTE FUNCTION reject_totp_audit();",
  )
  try {
    expect(
      (
        await handler(
          request(
            'action=totp-confirm',
            { code: totpCode(secret, Math.floor(Date.now() / 30000)) },
            { token },
          ),
          context,
        )
      ).status,
    ).toBe(503)
    const row = (await database.query<any>('SELECT * FROM platform_totp'))
      .rows[0]
    expect(row.enabled_at).toBeNull()
    expect(row.pending_ciphertext).toBeTruthy()
    expect(
      (await database.query('SELECT * FROM platform_recovery_codes')).rows,
    ).toHaveLength(0)
  } finally {
    await database.exec(
      'DROP TRIGGER reject_totp_audit ON platform_audit;DROP FUNCTION reject_totp_audit()',
    )
  }
})

// Password + SMS: a fake Twilio Verify with the provider's documented
// single-use, pending-reuse and attempt-limit semantics.
const twilio = {
  verifications: new Map<
    string,
    { to: string; code: string; status: string; checks: number }
  >(),
  failNext: null as null | { status: number; code?: number } | 'network',
  sends: 0,
  bodies: [] as string[],
}
const phone = '(312) 555-0147'
function stubTwilio() {
  twilio.verifications.clear()
  twilio.failNext = null
  twilio.sends = 0
  twilio.bodies = []
  Object.assign(runtime.env, {
    ADMIN_MFA_ENCRYPTION_KEY: 'ab'.repeat(32),
    ADMIN_SMS_ENABLED: 'true',
    TWILIO_API_KEY_SID: 'SK' + '0'.repeat(32),
    TWILIO_API_KEY_SECRET: 'fixture-secret-value-not-real',
    TWILIO_VERIFY_SERVICE_SID: 'VA' + '1'.repeat(32),
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toMatch(
        /^https:\/\/verify\.twilio\.com\/v2\/Services\/VA1+\//,
      )
      expect(String((init.headers as any).Authorization)).toMatch(/^Basic /)
      const form = new URLSearchParams(String(init.body))
      twilio.bodies.push(String(init.body))
      if (url.endsWith('/Verifications')) {
        twilio.sends++
        const failure = twilio.failNext
        twilio.failNext = null
        if (failure === 'network') throw new TypeError('fetch failed')
        if (failure)
          return Response.json(
            { code: failure.code },
            { status: failure.status },
          )
        const to = form.get('To')!
        expect(form.get('Channel')).toBe('sms')
        const existing = [...twilio.verifications].find(
          ([, v]) => v.to === to && v.status === 'pending',
        )
        if (existing)
          return Response.json(
            { sid: existing[0], status: 'pending' },
            { status: 201 },
          )
        const sid =
          'VE' + String(twilio.verifications.size + 1).padStart(32, '0')
        twilio.verifications.set(sid, {
          to,
          code: String(100000 + twilio.verifications.size * 7919),
          status: 'pending',
          checks: 0,
        })
        return Response.json({ sid, status: 'pending' }, { status: 201 })
      }
      const v = twilio.verifications.get(form.get('VerificationSid')!)
      if (!v || v.status !== 'pending')
        return Response.json({ code: 20404 }, { status: 404 })
      if (++v.checks > 5) return Response.json({ code: 60202 }, { status: 429 })
      if (v.code === form.get('Code')) {
        v.status = 'approved'
        return Response.json({ status: 'approved', valid: true })
      }
      return Response.json({ status: 'pending', valid: false })
    }),
  )
}
const latestCode = () => [...twilio.verifications.values()].at(-1)!.code
async function post(action: string, body: unknown, value = token) {
  return handler(request('action=' + action, body, { token: value }), context)
}
async function enrollSms() {
  stubTwilio()
  await session(true)
  const authorize = await phonePasskey()
  const setup = await authorize('sms-enroll')
  expect(setup.status).toBe(200)
  expect((await setup.json()).stage).toBe('sms_setup')
  const sent = await post('sms-enroll-send', { phone })
  expect(sent.status).toBe(200)
  const confirmed = await post('sms-enroll-confirm', { code: latestCode() })
  expect(confirmed.status).toBe(200)
  twilio.verifications.clear()
  return authorize
}
async function passwordLogin() {
  const response = await handler(
    request('action=login', {
      email: 'platform-owner@example.invalid',
      password: 'test-password',
    }),
    context,
  )
  expect(response.status).toBe(200)
  return /__Host-cp_admin=([^;]+)/.exec(response.headers.get('set-cookie')!)![1]
}
function noPlaintextPhone(value: unknown) {
  const text = JSON.stringify(value)
  expect(text).not.toContain('3125550147')
  expect(text).not.toContain('555-0147')
}

it('enrolls SMS only from an MFA session after a fresh passkey and a confirmed text, storing only ciphertext and a masked number', async () => {
  stubTwilio()
  await session(true)
  // Without fresh passkey authorization no number is accepted or texted.
  expect((await post('sms-enroll-send', { phone })).status).toBe(403)
  const authorize = await phonePasskey()
  expect((await (await authorize('sms-enroll')).json()).stage).toBe('sms_setup')
  for (const bad of ['+44 20 7946 0958', '011 44 20 7946', '(312) 155-0147']) {
    const response = await post('sms-enroll-send', { phone: bad })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('SMS_NUMBER_INVALID')
  }
  expect(twilio.sends).toBe(0)
  const sent = await post('sms-enroll-send', { phone })
  expect(await sent.json()).toMatchObject({
    stage: 'sms_enroll_sent',
    masked: '+1 •••-•••-0147',
  })
  expect(twilio.bodies[0]).toContain('To=%2B13125550147')
  const wrong = await post('sms-enroll-confirm', { code: '000000' })
  expect(wrong.status).toBe(403)
  expect((await wrong.json()).code).toBe('SMS_INCORRECT')
  let row = (await database.query<any>('SELECT * FROM platform_sms')).rows[0]
  expect(row.verified_at).toBeNull()
  const confirmed = await post('sms-enroll-confirm', { code: latestCode() })
  expect(await confirmed.json()).toMatchObject({
    stage: 'sms_enrolled',
    masked: '+1 •••-•••-0147',
    notification: 'unavailable',
  })
  row = (await database.query<any>('SELECT * FROM platform_sms')).rows[0]
  expect(row.verified_at).toBeTruthy()
  expect(
    openSecret(row.phone_ciphertext, 'platform-owner', 'admin-sms').toString(),
  ).toBe('+13125550147')
  expect(() =>
    openSecret(row.phone_ciphertext, 'platform-agent', 'admin-sms'),
  ).toThrow()
  noPlaintextPhone(row)
  const audits = (await database.query<any>('SELECT * FROM platform_audit'))
    .rows
  noPlaintextPhone(audits)
  noPlaintextPhone((await database.query('SELECT * FROM platform_limits')).rows)
  expect(audits.map((a) => a.action)).toContain('sms_enrolled')
  expect(JSON.stringify(audits)).not.toContain(latestCode())
  expect(JSON.stringify(audits)).not.toContain('fixture-secret-value')
  // The existing passkey is untouched.
  expect(
    (await database.query('SELECT * FROM platform_credentials')).rows,
  ).toHaveLength(1)
})

it('never lets a password-only or SMS-only session enroll or replace a destination number', async () => {
  stubTwilio()
  const pending = await session(false, 'platform-owner', 'P'.repeat(43))
  expect((await post('sms-enroll-send', { phone }, pending)).status).toBe(403)
  expect(
    (
      await post(
        'mfa-options',
        { kind: 'authentication', purpose: 'sms-enroll' },
        pending,
      )
    ).status,
  ).toBe(403)
  await enrollSms()
  const login = await passwordLogin()
  await post('sms-send', {}, login)
  const verified = await post('sms-verify', { code: latestCode() }, login)
  expect(verified.status).toBe(200)
  const smsSession = /__Host-cp_admin=([^;]+)/.exec(
    verified.headers.get('set-cookie')!,
  )![1]
  const status = await (
    await handler(
      request('action=session', undefined, { token: smsSession }),
      context,
    )
  ).json()
  expect(status).toMatchObject({ stage: 'authenticated', mfaMethod: 'sms' })
  const replaced = await post(
    'sms-enroll-send',
    { phone: '(415) 555-0199' },
    smsSession,
  )
  expect(replaced.status).toBe(403)
  expect((await replaced.json()).code).toBe('FRESH_PASSKEY_REQUIRED')
  expect(
    (await post('sms-enroll-confirm', { code: '123456' }, smsSession)).status,
  ).toBe(403)
  // Enrollment + one sign-in text; refused requests never reached the provider.
  expect(twilio.sends).toBe(2)
})

it('signs in with password + SMS without WebAuthn, then rotates the session, rejects reuse, and logout invalidates it', async () => {
  await enrollSms()
  const login = await passwordLogin()
  const before = await (
    await handler(
      request('action=session', undefined, { token: login }),
      context,
    )
  ).json()
  expect(before).toMatchObject({
    stage: 'authenticated',
    smsEnabled: true,
    smsMasked: '+1 •••-•••-0147',
  })
  noPlaintextPhone(before)
  // No code exists before a text is requested.
  expect(
    (await (await post('sms-verify', { code: '123456' }, login)).json()).code,
  ).toBe('SMS_EXPIRED')
  const sent = await post('sms-send', {}, login)
  expect(await sent.json()).toMatchObject({
    stage: 'sms_sent',
    masked: '+1 •••-•••-0147',
    resendsRemaining: 2,
  })
  const cooldown = await post('sms-send', {}, login)
  expect(cooldown.status).toBe(429)
  expect((await cooldown.json()).code).toBe('SMS_COOLDOWN')
  expect(cooldown.headers.get('retry-after')).toBe('30')
  const wrong = await post('sms-verify', { code: '000000' }, login)
  expect(wrong.status).toBe(403)
  expect((await wrong.json()).code).toBe('SMS_INCORRECT')
  expect(
    (
      await handler(
        request('section=overview', undefined, { token: login }),
        context,
      )
    ).status,
  ).toBe(200)
  const code = latestCode()
  const ok = await post('sms-verify', { code }, login)
  expect(ok.status).toBe(200)
  const fresh = /__Host-cp_admin=([^;]+)/.exec(
    ok.headers.get('set-cookie')!,
  )![1]
  expect(fresh).not.toBe(login)
  expect(
    (
      await handler(
        request('section=overview', undefined, { token: fresh }),
        context,
      )
    ).status,
  ).toBe(200)
  expect((await post('sms-verify', { code }, login)).status).toBe(401)
  // Reused code on a new pending sign-in is rejected (single use).
  const second = await passwordLogin()
  expect((await post('sms-verify', { code }, second)).status).toBe(403)
  expect((await post('logout', {}, fresh)).status).toBe(200)
  expect(
    (
      await handler(
        request('section=overview', undefined, { token: fresh }),
        context,
      )
    ).status,
  ).toBe(401)
  const audits = (await database.query<any>('SELECT * FROM platform_audit'))
    .rows
  expect(JSON.stringify(audits)).not.toContain(code)
  noPlaintextPhone(audits)
})

it('rejects expired, superseded and over-attempted codes and enforces the resend limit', async () => {
  await enrollSms()
  const a = await passwordLogin()
  await post('sms-send', {}, a)
  const b = await passwordLogin()
  await post('sms-send', {}, b)
  // Twilio re-sent the same pending code, but it is now bound only to B.
  const superseded = await post('sms-verify', { code: latestCode() }, a)
  expect((await superseded.json()).code).toBe('SMS_EXPIRED')
  await database.query(
    "UPDATE platform_sessions SET sms_until=NOW()-INTERVAL '1 second' WHERE token_hash=$1",
    [hash(b)],
  )
  expect(
    (await (await post('sms-verify', { code: latestCode() }, b)).json()).code,
  ).toBe('SMS_EXPIRED')
  // Attempt limit.
  const c = await passwordLogin()
  await post('sms-send', {}, c)
  for (let i = 0; i < 5; i++)
    expect(
      (await (await post('sms-verify', { code: '000000' }, c)).json()).code,
    ).toBe('SMS_INCORRECT')
  expect(
    (await (await post('sms-verify', { code: latestCode() }, c)).json()).code,
  ).toBe('SMS_EXHAUSTED')
  expect(
    (
      await handler(
        request('section=overview', undefined, { token: c }),
        context,
      )
    ).status,
  ).toBe(200)
  // Resend limit per pending sign-in (hourly destination/account caps reset).
  await database.exec('TRUNCATE platform_limits')
  const d = await passwordLogin()
  for (let i = 0; i < 3; i++) {
    await database.query(
      "UPDATE platform_sessions SET sms_sent_at=NOW()-INTERVAL '1 minute'",
    )
    expect((await post('sms-send', {}, d)).status).toBe(200)
  }
  await database.query(
    "UPDATE platform_sessions SET sms_sent_at=NOW()-INTERVAL '1 minute'",
  )
  const limited = await post('sms-send', {}, d)
  expect(limited.status).toBe(429)
  expect((await limited.json()).code).toBe('SMS_SEND_LIMIT')
})

it('reports provider and delivery failures distinctly, never sends when switched off, and fails closed without an active grant', async () => {
  await enrollSms()
  const login = await passwordLogin()
  twilio.failNext = { status: 400, code: 60410 }
  const blocked = await post('sms-send', {}, login)
  expect(blocked.status).toBe(403)
  expect((await blocked.json()).code).toBe('SMS_DESTINATION_BLOCKED')
  twilio.failNext = 'network'
  const offline = await post('sms-send', {}, login)
  expect(offline.status).toBe(502)
  expect((await offline.json()).code).toBe('SMS_PROVIDER_UNREACHABLE')
  twilio.failNext = { status: 401, code: 20003 }
  expect((await (await post('sms-send', {}, login)).json()).code).toBe(
    'SMS_PROVIDER_CONFIGURATION',
  )
  const audits = (
    await database.query<any>(
      "SELECT * FROM platform_audit WHERE outcome='provider_rejected'",
    )
  ).rows
  expect(audits.length).toBeGreaterThanOrEqual(2)
  expect(JSON.stringify(audits)).not.toContain('fixture-secret-value')
  expect(
    (
      await database.query<any>(
        'SELECT sms_verification_sid FROM platform_sessions WHERE token_hash=$1',
        [hash(login)],
      )
    ).rows[0].sms_verification_sid,
  ).toBeNull()
  // Switched off: no provider call, no bypass.
  const calls = twilio.sends
  runtime.env.ADMIN_SMS_ENABLED = 'false'
  const off = await post('sms-send', {}, login)
  expect(off.status).toBe(503)
  expect((await off.json()).code).toBe('SMS_UNAVAILABLE')
  expect(twilio.sends).toBe(calls)
  runtime.env.ADMIN_SMS_ENABLED = 'true'
  await post('sms-send', {}, login)
  // Rotating the grant epoch revokes every outstanding session for the account.
  await database.query(
    "UPDATE platform_admins SET epoch=epoch+1 WHERE identity_id='platform-owner'",
  )
  expect((await post('sms-verify', { code: latestCode() }, login)).status).toBe(
    401,
  )
  expect(
    (
      await database.query(
        'SELECT * FROM platform_sessions WHERE mfa_at IS NOT NULL AND token_hash<>$1',
        [hash(token)],
      )
    ).rows,
  ).toHaveLength(0)
})

it('keeps the existing phone passkey working after SMS enrollment and requires it to remove SMS', async () => {
  const authorize = await enrollSms()
  await database.query('UPDATE platform_sessions SET mfa_at=NULL')
  const signedIn = await authorize()
  expect((await signedIn.json()).stage).toBe('authenticated')
  const fresh = /__Host-cp_admin=([^;]+)/.exec(
    signedIn.headers.get('set-cookie')!,
  )![1]
  expect(
    (
      await handler(
        request('section=overview', undefined, { token: fresh }),
        context,
      )
    ).status,
  ).toBe(200)
  await database.query(
    'UPDATE platform_sessions SET token_hash=$1 WHERE token_hash=$2',
    [hash(token), hash(fresh)],
  )
  const removed = await authorize('sms-remove')
  expect((await removed.json()).stage).toBe('sms_removed')
  expect(
    (await database.query('SELECT * FROM platform_sms')).rows,
  ).toHaveLength(0)
  expect(
    (await database.query('SELECT * FROM platform_credentials')).rows,
  ).toHaveLength(1)
})

it('caps texts per destination, account and source across sign-ins to prevent cost exhaustion', async () => {
  await enrollSms()
  let accepted = 0
  let limited: Response | null = null
  for (let i = 0; i < 8 && !limited; i++) {
    // Isolate the SMS caps from the separate password-attempt limits.
    await database.query('DELETE FROM platform_limits WHERE key=ANY($1)', [
      [
        hash('login-account:platform-owner@example.invalid'),
        hash('login-ip:' + context.ip),
      ],
    ])
    const login = await passwordLogin()
    const response = await post('sms-send', {}, login)
    if (response.status === 200) accepted++
    else limited = response
  }
  // One enrollment text plus five sign-in texts reach the hourly destination cap.
  expect(accepted).toBe(5)
  expect(limited!.status).toBe(429)
  expect((await limited!.json()).code).toBe('RATE_LIMITED')
  expect(twilio.sends).toBe(6)
})

it.each(['platform-agent', 'platform-owner'])(
  'retires Square connection and setup actions for %s without creating OAuth state',
  async (identity) => {
    await session(false, identity)
    for (const action of [
      'billing-connect',
      'billing-oauth-complete',
      'billing-confirm-connection',
      'billing-verify',
      'billing-verify-mappings',
      'billing-sync-plans',
    ]) {
      const response = await handler(
        request(`action=${action}&environment=production`, {}, { token }),
        context,
      )
      expect(response.status).toBe(404)
      expect((await response.json()).code).toBe('ACTION_UNAVAILABLE')
      expect(response.headers.get('set-cookie')).toBeNull()
    }
    expect(
      (await database.query('SELECT * FROM square_billing_oauth_states')).rows,
    ).toHaveLength(0)
  },
)

it('refreshes a previously verified admin session with an enrolled SMS code and rotates the cookie', async () => {
  await enrollSms()
  await database.query(
    "UPDATE platform_sessions SET mfa_at=NOW()-INTERVAL '15 minutes' WHERE token_hash=$1",
    [hash(token)],
  )
  expect((await post('sms-send', {})).status).toBe(200)
  const denied = await post('sms-verify', { code: '000000' })
  expect(denied.status).toBe(403)
  const response = await post('sms-verify', { code: latestCode() })
  expect(response.status).toBe(200)
  const rotated = /__Host-cp_admin=([^;]+)/.exec(
    response.headers.get('set-cookie')!,
  )![1]
  expect(rotated).not.toBe(token)
  const oldSession = await handler(
    request('action=session', undefined, { token }),
    context,
  )
  expect(oldSession.status).toBe(401)
  const fresh = await handler(
    request('action=session', undefined, { token: rotated }),
    context,
  )
  expect((await fresh.json()).mfaMethod).toBe('sms')
})

it('previews and appends manual access with audit without billing writes, and rejects ordinary callers', async () => {
  const input = {
    businessId: oven,
    operation: 'grant',
    plan: 'cottage-kitchen',
    source: 'test',
    expiresAt: null,
    reason: 'Disposable fixture access test',
  }
  const before = (
    await database.query(
      'SELECT * FROM workspace_billing WHERE business_id=$1',
      [oven],
    )
  ).rows
  expect(
    (await handler(request('action=business-access', input), context)).status,
  ).toBe(401)
  await session(false)
  expect(
    (
      await handler(
        request('action=business-access', input, { token }),
        context,
      )
    ).status,
  ).toBe(403)
  await database.query('UPDATE platform_sessions SET mfa_at=NOW()')
  const previewResponse = await handler(
    request('action=business-access', input, { token }),
    context,
  )
  expect(previewResponse.status).toBe(200)
  const preview = await previewResponse.json()
  expect(preview.preview.business.id).toBe(oven)
  expect(preview.preview.billingContinues).toBe(true)
  expect(preview.preview.after.plan).toBe('cottage-kitchen')
  const applied = await handler(
    request(
      'action=business-access',
      { ...input, confirmation: preview.confirmation },
      { token },
    ),
    context,
  )
  expect(applied.status).toBe(200)
  expect((await applied.json()).applied).toBe(true)
  expect(
    (
      await database.query(
        'SELECT * FROM workspace_billing WHERE business_id=$1',
        [oven],
      )
    ).rows,
  ).toEqual(before)
  const detail = await handler(
    request('section=customers&id=' + oven, undefined, { token }),
    context,
  )
  expect((await detail.json()).effective).toMatchObject({
    plan: 'cottage-kitchen',
    source: 'test',
    manualValid: true,
  })
  const entries = (
    await database.query(
      "SELECT * FROM platform_audit WHERE action='access:grant'",
    )
  ).rows as any[]
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({
    target: oven,
    actor_id: 'platform-owner',
    reason: input.reason,
  })
  expect(entries[0].before).toBeTruthy()
  expect(entries[0].after.grant.expires_at).toBeNull()
  const revoke = {
    ...input,
    operation: 'revoke',
    reason: 'End disposable access test',
  }
  const r = await handler(
    request('action=business-access', revoke, { token }),
    context,
  )
  const rp = await r.json()
  expect(
    (
      await handler(
        request(
          'action=business-access',
          { ...revoke, confirmation: rp.confirmation },
          { token },
        ),
        context,
      )
    ).status,
  ).toBe(200)
  expect(
    (
      await database.query(
        'SELECT operation FROM complimentary_grants WHERE business_id=$1 ORDER BY created_at DESC',
        [oven],
      )
    ).rows,
  ).toHaveLength(2)
})

function inboxRequest(query = '', body?: unknown, value = token) {
  return new Request(origin + '/api/support?view=staff' + query, {
    method: body ? 'POST' : 'GET',
    headers: {
      'x-cp-admin': '1',
      origin,
      'content-type': 'application/json',
      ...(value ? { cookie: `${adminCookie}=${value}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
it('restores the portal-only admin inbox without a customer cookie and denies signed-out, expired and non-admin sessions', async () => {
  await session(false)
  const success = await support(inboxRequest())
  expect(success.status).toBe(200)
  expect(await success.json()).toEqual({ staff: true, admin: true })
  expect((await support(inboxRequest('', undefined, ''))).status).toBe(401)
  await database.query(
    "UPDATE platform_sessions SET expires_at=now()-interval '1 minute'",
  )
  expect((await support(inboxRequest())).status).toBe(401)
  runtime.loginId = 'customer-owner' // Even an Identity platform_admin role cannot grant a portal session.
  expect((await support(inboxRequest('', undefined, ''))).status).toBe(403)
  await database.query(
    "UPDATE platform_admins SET enabled=false WHERE identity_id='platform-agent'",
  )
  await session(false, 'platform-agent', 'A'.repeat(43))
  expect(
    (await support(inboxRequest('', undefined, 'A'.repeat(43)))).status,
  ).toBe(401)
})
async function assistantFixture(
  audience: 'admin' | 'customer',
  identity = 'platform-owner',
) {
  const ticket = randomUUID(),
    chat = randomUUID()
  await database.query(
    "INSERT INTO support_tickets(id,requester_id,requester_email,workspace_id,subject,category,submission_key,diagnostics) VALUES($1,'customer-owner','fixture@example.invalid',$2,'Fixture support question','Question',$3,'{}')",
    [ticket, oven, randomUUID()],
  )
  await database.query(
    "INSERT INTO support_ai_conversations(id,requester_id,business_id,audience,context_ticket_id,messages,expires_at) VALUES($1,$2,$3,$4,$5,'[]',now()+interval '1 day')",
    [
      chat,
      identity,
      audience === 'customer' ? oven : null,
      audience,
      audience === 'admin' ? ticket : null,
    ],
  )
  return { ticket, chat }
}
it('executes business-scoped diagnostic tools with role checks, consent, sanitized projections and immediate membership revocation', async () => {
  runtime.loginId = 'customer-owner'
  const { chat } = await assistantFixture('customer', 'customer-owner')
  const req = new Request('https://mycottagepantry.com/api/support')
  await expect(
    assistantTools(req, chat, false, false).run('business_status', {}),
  ).rejects.toThrow()
  const tools = assistantTools(req, chat, false, true)
  const result = await tools.run('business_status', {})
  expect(JSON.stringify(result)).toContain('past_due')
  expect(JSON.stringify(result)).not.toMatch(
    /PRIVATE_|subscription-sensitive|customer-owner/,
  )
  const diagnostics = await tools.run('troubleshoot', {})
  expect(JSON.stringify(diagnostics)).toContain('failed')
  expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE_')
  await database.query(
    "UPDATE users SET role='Production Staff' WHERE identity_id='customer-owner'",
  )
  expect(await tools.run('business_status', {})).toMatchObject({
    billing: null,
    billingPermission: false,
  })
  await database.query(
    "UPDATE users SET active=false WHERE identity_id='customer-owner'",
  )
  await expect(tools.run('troubleshoot', {})).rejects.toThrow(/membership/)
  await database.query(
    "UPDATE users SET role='Owner',active=true WHERE identity_id='customer-owner'",
  )
  await expect(
    tools.run('propose_billing_reconciliation', {}),
  ).rejects.toThrow()
  await expect(
    tools.run('business_status', { businessId: other }),
  ).rejects.toThrow()
})
it('keeps private admin chats out of customer requests and executes recovery only after a scoped proposal, MFA and confirmation', async () => {
  await session(true)
  const { chat } = await assistantFixture('admin')
  const tools = assistantTools(inboxRequest(), chat, true, true)
  const lookup = (await tools.run('support_lookup', {
    query: 'Fixture support',
  })) as { tickets: unknown[] }
  expect(lookup.tickets.length).toBeGreaterThan(0)
  expect(await tools.run('account_status', {})).toMatchObject({
    subject: 'selected ticket requester',
    role: 'Owner',
    emailVerified: true,
  })
  const proposal = (await tools.run('propose_billing_reconciliation', {})) as {
    actionId: string
  }
  expect(proposal.actionId).toBeTruthy()
  await expect(
    confirmAssistantAction(inboxRequest(), {
      actionId: proposal.actionId,
      confirmation: 'yes',
    }),
  ).rejects.toThrow()
  runtime.loginId = 'customer-owner'
  await expect(
    assistantTools(
      new Request('https://mycottagepantry.com/api/support'),
      chat,
      false,
      true,
    ).run('search_help', { question: 'inventory' }),
  ).rejects.toThrow()
  const response = await support(
    new Request('https://mycottagepantry.com/api/support?ai=1', {
      method: 'POST',
      headers: {
        origin: 'https://mycottagepantry.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'escalate',
        conversationId: chat,
        summary: 'Try to expose admin conversation',
      }),
    }),
  )
  expect(response.status).toBe(404)
  runtime.loginId = 'platform-owner'
  runtime.identities['platform-owner'].roles = ['platform_admin']
  // RLS also denies private rows when Identity alone carries a platform role.
  const customerActor = await supportActor()
  const privateRows = await supportTransaction(customerActor, (c) =>
    c.query('SELECT id FROM support_ai_conversations WHERE id=$1', [chat]),
  )
  expect(privateRows.rows).toHaveLength(0)
  // The same person’s customer session still cannot see their private admin chat.
  const customerView = await support(
    new Request('https://mycottagepantry.com/api/support?ai=1'),
  )
  expect(
    (await customerView.json()).conversations.some(
      (c: { id: string }) => c.id === chat,
    ),
  ).toBe(false)
  const deletePrivate = await support(
    new Request('https://mycottagepantry.com/api/support?ai=1', {
      method: 'POST',
      headers: {
        origin: 'https://mycottagepantry.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'delete', conversationId: chat }),
    }),
  )
  expect(deletePrivate.status).toBe(404)
  runtime.recoveryFails = false
  const confirmed = await confirmAssistantAction(inboxRequest(), {
    actionId: proposal.actionId,
    confirmation: 'RECONCILE',
  })
  expect(confirmed.verified).toBe(true)
  expect(confirmed.message).toContain('does not establish')
  await expect(
    confirmAssistantAction(inboxRequest(), {
      actionId: proposal.actionId,
      confirmation: 'RECONCILE',
    }),
  ).rejects.toThrow(/already attempted/)
  expect(
    (
      await database.query(
        'SELECT status FROM support_ai_actions WHERE id=$1',
        [proposal.actionId],
      )
    ).rows[0],
  ).toMatchObject({ status: 'verified_success' })
})
it('records uncertain recovery without claiming a fix and requires fresh MFA before consuming a proposal', async () => {
  await session(false)
  const { chat } = await assistantFixture('admin')
  const proposal = (await assistantTools(inboxRequest(), chat, true, true).run(
    'propose_billing_reconciliation',
    {},
  )) as { actionId: string }
  await expect(
    confirmAssistantAction(inboxRequest(), {
      actionId: proposal.actionId,
      confirmation: 'RECONCILE',
    }),
  ).rejects.toThrow(/authentication/)
  expect(
    (
      await database.query(
        'SELECT status FROM support_ai_actions WHERE id=$1',
        [proposal.actionId],
      )
    ).rows[0],
  ).toMatchObject({ status: 'proposed' })
  await database.query('UPDATE platform_sessions SET mfa_at=now()')
  runtime.recoveryFails = true
  const result = await confirmAssistantAction(inboxRequest(), {
    actionId: proposal.actionId,
    confirmation: 'RECONCILE',
  })
  expect(result.verified).toBe(false)
  expect(JSON.stringify(result)).not.toContain('provider-secret')
  expect(
    (
      await database.query(
        'SELECT status FROM support_ai_actions WHERE id=$1',
        [proposal.actionId],
      )
    ).rows[0],
  ).toMatchObject({ status: 'unverified' })
  runtime.recoveryFails = false
})
