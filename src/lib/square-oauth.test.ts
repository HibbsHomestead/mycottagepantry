// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Context } from '@netlify/functions'
import type { AdminClient } from '../../netlify/lib/platform-admin-core'
const runtime = vi.hoisted(() => ({ client: null as AdminClient | null }))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: { connect: async () => runtime.client } }),
}))
import {
  beginSquareOAuth,
  completeSquareOAuth,
  confirmSquareConnection,
  squareBillingScopes,
  squareOAuthAdminStatus,
} from '../../netlify/lib/square-oauth'
import {
  openSquare,
  sealSquare,
  withSquareConnections,
  squareAccessToken,
} from '../../netlify/lib/square-credentials'
import {
  billingConfiguration,
  squareBillingRequest,
} from '../../netlify/lib/square-billing'
import callback from '../../netlify/functions/square-billing-oauth-callback.mts'
const db = new PGlite()
const origin = 'https://oauth-preview--mycottagepantry.netlify.app'
const owner = {
  role: 'owner',
  mfa_at: '2026-01-01',
  token_hash: 'session-hash',
  identity_id: 'owner',
  origin,
}
const env: Record<string, string> = {
  CONTEXT: 'deploy-preview',
  DEPLOY_URL: origin,
  REGISTRATION_PRIVATE_TESTS_ENABLED: 'true',
  SQUARE_SANDBOX_ENABLED: 'true',
  SQUARE_SANDBOX_APPLICATION_ID: 'fixture-app-id',
  SQUARE_SANDBOX_APPLICATION_SECRET: 'fixture-app-secret',
  SQUARE_SANDBOX_API_VERSION: '2026-01-22',
  SQUARE_BILLING_ENCRYPTION_KEY: '12'.repeat(32),
}
const client: AdminClient = {
  query: (sql, params) => db.query(sql, params),
  release() {},
}
beforeAll(async () => {
  await db.exec(`CREATE TABLE platform_admins(identity_id text PRIMARY KEY,role text,epoch int,enabled bool);
    CREATE TABLE platform_sessions(token_hash text PRIMARY KEY,identity_id text,origin text,epoch int,mfa_at timestamptz,expires_at timestamptz);
    CREATE TABLE platform_limits(key text PRIMARY KEY,count int,expires_at timestamptz);
    CREATE TABLE billing_subscriptions(environment text);
    CREATE TABLE billing_attempts(environment text,status text);
    CREATE TABLE billing_plan_mappings(environment text);
    CREATE TABLE billing_connection_checks(environment text);`)
  await db.exec(
    await readFile(
      new URL(
        '../../netlify/database/migrations/20261120010000_add_square_merchant_oauth/migration.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  runtime.client = client
})
beforeEach(async () => {
  await db.exec(
    'TRUNCATE square_billing_oauth_states,square_billing_connections,platform_sessions,platform_admins,platform_limits,billing_subscriptions,billing_attempts,billing_plan_mappings,billing_connection_checks,billing_sync_runs CASCADE',
  )
  await db.query("INSERT INTO platform_admins VALUES('owner','owner',1,true)")
  await db.query(
    "INSERT INTO platform_sessions VALUES('session-hash','owner',$1,1,NOW(),NOW()+INTERVAL '30 minutes')",
    [origin],
  )
  vi.stubGlobal('Netlify', { env: { get: (name: string) => env[name] } })
})
afterAll(async () => {
  await db.close()
  vi.unstubAllGlobals()
})
async function authorize() {
  const started = await beginSquareOAuth(client, owner, 'sandbox')
  const state = new URL(started.url).searchParams.get('state')!
  const response = await callback(
    new Request(
      origin +
        '/api/admin/square/callback?' +
        new URLSearchParams({ state, code: 'fixture-code' }),
      { headers: { Cookie: started.cookie.split(';')[0] } },
    ),
    { ip: '192.0.2.7' } as Context,
  )
  expect(response.headers.get('location')).toContain('square=return')
  return { state, cookie: started.cookie }
}
function provider() {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname
    if (path === '/oauth2/token')
      return Response.json({
        access_token: 'fixture-access',
        refresh_token: 'fixture-refresh',
        merchant_id: 'MERCHANT',
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      })
    if (path === '/oauth2/token/status') {
      expect(init?.method).toBe('POST')
      return Response.json({ scopes: squareBillingScopes })
    }
    if (path === '/v2/merchants/me')
      return Response.json({
        merchant: { id: 'MERCHANT', business_name: 'Platform fixture' },
      })
    if (path === '/v2/locations')
      return Response.json({
        locations: [
          {
            id: 'LOC',
            name: 'Revenue location',
            status: 'ACTIVE',
            currency: 'USD',
            country: 'US',
            capabilities: ['CREDIT_CARD_PROCESSING'],
          },
        ],
      })
    return Response.json({})
  }) as unknown as typeof fetch
}
it('requires the authorized platform owner and configured secure storage', async () => {
  await expect(
    beginSquareOAuth(client, { ...owner, role: 'admin' }, 'sandbox'),
  ).rejects.toMatchObject({ code: 'BILLING_OWNER_REQUIRED' })
  vi.stubGlobal('Netlify', { env: { get: () => '' } })
  await expect(
    beginSquareOAuth(client, owner, 'production'),
  ).rejects.toMatchObject({ code: 'SQUARE_CONTEXT_FORBIDDEN' })
})
it('binds callback to browser, session, origin and active owner; rejects replay', async () => {
  const started = await beginSquareOAuth(client, owner, 'sandbox')
  expect(started.cookie).toContain('HttpOnly; Secure; SameSite=Lax')
  const state = new URL(started.url).searchParams.get('state')!
  const url =
    origin +
    '/api/admin/square/callback?' +
    new URLSearchParams({ state, code: 'fixture-code' })
  const noCookie = await callback(new Request(url), {
    ip: '192.0.2.8',
  } as Context)
  expect(noCookie.headers.get('location')).toContain('square=failed')
  const request = () =>
    new Request(url, { headers: { Cookie: started.cookie.split(';')[0] } })
  expect(
    (await callback(request(), { ip: '192.0.2.8' } as Context)).headers.get(
      'location',
    ),
  ).toContain('square=return')
  expect(
    (await callback(request(), { ip: '192.0.2.8' } as Context)).headers.get(
      'location',
    ),
  ).toContain('square=failed')
  const row = (
    await db.query<{ code_ciphertext: string }>(
      'SELECT code_ciphertext FROM square_billing_oauth_states',
    )
  ).rows[0]
  expect(row.code_ciphertext).not.toContain('fixture-code')
})
it.each(['expired', 'revoked', 'role'])(
  'rejects callback with %s authorization',
  async (fault) => {
    const started = await beginSquareOAuth(client, owner, 'sandbox')
    const state = new URL(started.url).searchParams.get('state')!
    if (fault === 'expired')
      await db.query(
        "UPDATE square_billing_oauth_states SET expires_at=NOW()-INTERVAL '1 second'",
      )
    if (fault === 'revoked')
      await db.query('UPDATE platform_admins SET enabled=false')
    if (fault === 'role')
      await db.query("UPDATE platform_admins SET role='admin'")
    const response = await callback(
      new Request(
        origin +
          '/api/admin/square/callback?' +
          new URLSearchParams({ state, code: 'fixture-code' }),
        { headers: { Cookie: started.cookie.split(';')[0] } },
      ),
      { ip: '192.0.2.8' } as Context,
    )
    expect(response.headers.get('location')).toContain('square=failed')
  },
)
it('exchanges server-side once, confirms merchant/location separately and exposes no credentials', async () => {
  const { state } = await authorize()
  const transport = provider()
  await expect(
    completeSquareOAuth(
      client,
      { ...owner, token_hash: 'another-session' },
      state,
      transport,
    ),
  ).rejects.toMatchObject({ code: 'SQUARE_STATE_EXPIRED' })
  const result = await completeSquareOAuth(client, owner, state, transport)
  expect(result).toMatchObject({
    ok: true,
    candidate: { merchantId: 'MERCHANT', permissionsVerified: true },
  })
  expect(JSON.stringify(result)).not.toContain('fixture-access')
  expect(
    (await db.query('SELECT * FROM square_billing_connections')).rows,
  ).toHaveLength(0)
  await expect(
    completeSquareOAuth(client, owner, state, transport),
  ).rejects.toMatchObject({ code: 'SQUARE_STATE_USED' })
  await expect(
    confirmSquareConnection(client, owner, state, { locationId: 'LOC' }),
  ).rejects.toThrow()
  await expect(
    confirmSquareConnection(client, owner, state, {
      locationId: 'OTHER',
      confirm: true,
    }),
  ).rejects.toMatchObject({ code: 'SQUARE_LOCATION_INVALID' })
  await confirmSquareConnection(client, owner, state, {
    locationId: 'LOC',
    confirm: true,
  })
  const rows = await db.query<{
    token_ciphertext: string
    environment: string
  }>('SELECT * FROM square_billing_connections')
  expect(rows.rows[0].environment).toBe('sandbox')
  expect(rows.rows[0].token_ciphertext).not.toContain('fixture-access')
  const status = await squareOAuthAdminStatus(client, owner)
  expect(JSON.stringify(status)).not.toMatch(
    /fixture-access|fixture-refresh|token_ciphertext|fixture-app-secret/,
  )
  await withSquareConnections(client, async () => {
    expect(billingConfiguration('sandbox').merchantId).toBe('MERCHANT')
    expect(billingConfiguration('sandbox').checkoutPermitted).toBe(false)
    expect(await squareAccessToken('sandbox', transport)).toBe('fixture-access')
  })
})
it('consumes state even when provider exchange fails and preserves current account', async () => {
  const { state } = await authorize()
  const failed = vi.fn(
    async () => new Response('private-provider-error', { status: 401 }),
  ) as unknown as typeof fetch
  expect(await completeSquareOAuth(client, owner, state, failed)).toMatchObject(
    { ok: false },
  )
  await expect(
    completeSquareOAuth(client, owner, state, provider()),
  ).rejects.toMatchObject({ code: 'SQUARE_STATE_USED' })
})
it('refuses a missing required permission', async () => {
  const { state } = await authorize()
  const base = provider()
  const transport: typeof fetch = async (url, init) =>
    String(url).endsWith('/oauth2/token/status')
      ? Response.json({ scopes: ['MERCHANT_PROFILE_READ'] })
      : base(url, init)
  expect(
    await completeSquareOAuth(client, owner, state, transport),
  ).toMatchObject({ ok: false })
})
it('blocks replacing a merchant/location with existing subscriptions', async () => {
  const { state } = await authorize()
  await completeSquareOAuth(client, owner, state, provider())
  await db.query(
    "INSERT INTO square_billing_connections(environment,merchant_id,merchant_name,token_ciphertext,expires_at,scopes,locations,location_id,connected_by) VALUES('sandbox','OLD','Old','encrypted',NOW(),'[]','[]','OLD-LOC','owner')",
  )
  await db.query("INSERT INTO billing_subscriptions VALUES('sandbox')")
  await expect(
    confirmSquareConnection(client, owner, state, {
      locationId: 'LOC',
      confirm: true,
    }),
  ).rejects.toMatchObject({ code: 'SQUARE_EXISTING_BILLING_REVIEW' })
  expect(
    (
      await db.query<{ merchant_id: string }>(
        'SELECT merchant_id FROM square_billing_connections',
      )
    ).rows[0].merchant_id,
  ).toBe('OLD')
})
it('refreshes expiring tokens under a lock and isolates encryption by environment', async () => {
  const { state } = await authorize()
  await completeSquareOAuth(client, owner, state, provider())
  await confirmSquareConnection(client, owner, state, {
    locationId: 'LOC',
    confirm: true,
  })
  await db.query(
    "UPDATE square_billing_connections SET expires_at=NOW()+INTERVAL '1 hour'",
  )
  const transport = provider()
  await withSquareConnections(client, async () => {
    expect(await squareAccessToken('sandbox', transport)).toBe('fixture-access')
    expect(await squareAccessToken('sandbox', transport)).toBe('fixture-access')
  })
  expect((transport as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  expect(() =>
    openSquare(sealSquare({ test: true }, 'sandbox'), 'production'),
  ).toThrow()
})
it('marks revoked refresh credentials for reconnection and never falls back to another account', async () => {
  const { state } = await authorize()
  await completeSquareOAuth(client, owner, state, provider())
  await confirmSquareConnection(client, owner, state, {
    locationId: 'LOC',
    confirm: true,
  })
  await db.query(
    "UPDATE square_billing_connections SET expires_at=NOW()-INTERVAL '1 hour'",
  )
  const transport: typeof fetch = async () =>
    new Response('revoked', { status: 401 })
  await withSquareConnections(client, async () => {
    await expect(squareAccessToken('sandbox', transport)).rejects.toMatchObject(
      { code: 'SQUARE_AUTHORIZATION_FAILED' },
    )
  })
  expect(
    (
      await db.query<{ status: string }>(
        'SELECT status FROM square_billing_connections',
      )
    ).rows[0].status,
  ).toBe('reconnect_required')
})
it('retains Production write gates while permitting canonical reads before release', async () => {
  vi.stubGlobal('Netlify', {
    env: {
      get: (name: string) =>
        ({
          CONTEXT: 'production',
          SQUARE_PRODUCTION_ACCESS_TOKEN: 'fixture-production',
          SQUARE_PRODUCTION_API_VERSION: '2026-01-22',
        })[name],
    },
  })
  const transport: typeof fetch = async () => Response.json({})
  await expect(
    squareBillingRequest('production', '/v2/subscriptions/SUB', {}, transport),
  ).resolves.toEqual({})
  await expect(
    squareBillingRequest(
      'production',
      '/v2/catalog/object',
      { method: 'POST' },
      transport,
    ),
  ).rejects.toMatchObject({ code: 'PRODUCTION_BILLING_GATED' })
  await expect(
    squareBillingRequest(
      'production',
      '/v2/subscriptions/SUB/cancel',
      { method: 'POST' },
      transport,
    ),
  ).rejects.toMatchObject({ code: 'PRODUCTION_BILLING_GATED' })
})

it('keeps credentials and OAuth states outside customer and metadata read policies', async () => {
  const { state } = await authorize()
  await completeSquareOAuth(client, owner, state, provider())
  await confirmSquareConnection(client, owner, state, {
    locationId: 'LOC',
    confirm: true,
  })
  await db.exec(
    'CREATE ROLE square_reader NOLOGIN; GRANT USAGE ON SCHEMA public TO square_reader; GRANT SELECT ON square_billing_connections,square_billing_oauth_states TO square_reader',
  )
  await db.query('BEGIN')
  await db.query('SET LOCAL ROLE square_reader')
  await db.query("SELECT set_config('app.platform_read','true',true)")
  expect(
    (await db.query('SELECT * FROM square_billing_connections')).rows,
  ).toHaveLength(0)
  expect(
    (await db.query('SELECT * FROM square_billing_oauth_states')).rows,
  ).toHaveLength(0)
  await db.query('ROLLBACK')
  await db.exec('DROP OWNED BY square_reader; DROP ROLE square_reader')
})
