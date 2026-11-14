// @vitest-environment node
import { randomBytes } from 'node:crypto'
import process from 'node:process'
import { afterEach, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import type { AdminMetadata } from './platform-admin-types'
import {
  sealStripe,
  openStripe,
  stripeSettings,
  stripeAdminView,
} from '../../netlify/lib/stripe-provider'
import { stripeEncryptionStatus } from '../../netlify/lib/runtime-environment'
const bootstrap = vi.hoisted(() => vi.fn())
vi.mock('../../netlify/lib/stripe-setup', () => ({
  setupStripeBilling: bootstrap,
}))
afterEach(() => {
  bootstrap.mockClear()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
it('recovers a misplaced credential using authenticated encryption without exposing root material', () => {
  vi.stubGlobal('Netlify', undefined)
  const value = 'sk_test_' + randomBytes(24).toString('hex')
  vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', value)
  const encrypted = sealStripe({ key: 'fixture', signing: '' }, 'test')
  expect(stripeEncryptionStatus().ready).toBe(true)
  expect(JSON.stringify(stripeEncryptionStatus())).not.toContain(value)
  expect(openStripe(encrypted, 'test').key).toBe('fixture')
  expect(() => openStripe(encrypted, 'live')).toThrow()
  vi.stubEnv(
    'STRIPE_BILLING_ENCRYPTION_KEY',
    'sk_test_' + randomBytes(24).toString('hex'),
  )
  expect(() => openStripe(encrypted, 'test')).toThrow()
})
it.each([
  { ciphertext: 'existing' },
  { configuration: { hostingImportDisabled: true } },
])(
  'never replaces existing credentials or reconnects an explicitly disconnected account',
  async (row) => {
    const query = vi.fn().mockResolvedValue({ rows: [row] })
    const transport = vi.fn()
    vi.stubGlobal('fetch', transport)
    expect(await stripeSettings({ query }, 'live')).toBe(row)
    expect(query).toHaveBeenCalledTimes(1)
    expect(transport).not.toHaveBeenCalled()
  },
)

async function connectionDatabase() {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE stripe_provider_settings (
      environment text PRIMARY KEY, ciphertext text, fingerprint text,
      account_id text, account_name text, validated_at timestamptz,
      webhook_verified_at timestamptz, checkout_enabled boolean DEFAULT false,
      configuration jsonb DEFAULT '{}', updated_at timestamptz DEFAULT NOW()
    );
    CREATE TABLE stripe_events (
      id text, environment text, kind text, status text, attempts int,
      error_code text, received_at timestamptz, processed_at timestamptz
    );
    CREATE TABLE stripe_checkouts (
      environment text, subscription_id text, access_verified_at timestamptz,
      portal_launched_at timestamptz, reconciled_at timestamptz
    );
  `)
  return {
    db,
    client: {
      query: (sql: string, params?: unknown[]) =>
        db.query<AdminMetadata>(sql, params),
      release: () => {},
    },
  }
}

it('connects on refresh after runtime injection replaces an environment that had no encryption root', async () => {
  const original = process.env
  const root = randomBytes(32).toString('hex')
  const key = 'sk_live_' + randomBytes(24).toString('hex')
  const { db, client } = await connectionDatabase()
  vi.stubGlobal('Netlify', undefined)
  const transport = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith('/account') ? { id: 'acct_fixture' } : { data: [] },
    ),
  )
  vi.stubGlobal('fetch', transport)
  try {
    process.env = { ...original, CONTEXT: '' }
    for (const name of [
      'STRIPE_BILLING_ENCRYPTION_KEY',
      'STRIPE_LIVE_SECRET_KEY',
      'STRIPE_TEST_SECRET_KEY',
      'STRIPE_LIVE_WEBHOOK_SECRET',
    ])
      delete process.env[name]
    await client.query('BEGIN')
    const missing = await stripeAdminView(client)
    await client.query('COMMIT')
    expect(missing.encryptionStatus.status).toBe('missing')
    expect(missing.rows).toEqual([])
    expect(transport).not.toHaveBeenCalled()
    process.env = {
      ...process.env,
      STRIPE_BILLING_ENCRYPTION_KEY: root,
      STRIPE_LIVE_SECRET_KEY: key,
    }
    await client.query('BEGIN')
    const connected = await stripeAdminView(client)
    await client.query('COMMIT')
    expect(connected.encryptionReady).toBe(true)
    expect(connected.connectionErrors).toEqual({})
    expect(connected.rows).toHaveLength(1)
    expect(connected.rows[0]).toMatchObject({
      environment: 'live',
      account_id: 'acct_fixture',
      checkout_enabled: false,
    })
    expect(connected.rows[0].validated_at).toBeTruthy()
    const saved = (await client.query('SELECT * FROM stripe_provider_settings'))
      .rows[0]
    expect(openStripe(saved.ciphertext, 'live').key).toBe(key)
    expect(JSON.stringify(connected)).not.toContain(key)
    expect(JSON.stringify(connected)).not.toContain(root)
    expect(JSON.stringify(connected)).not.toContain(saved.ciphertext)
  } finally {
    process.env = original
    await db.close()
  }
})

it.each(['provider', 'database'])(
  'commits verified encrypted credentials when %s setup fails, with checkout still disabled',
  async (failure) => {
    vi.stubGlobal('Netlify', undefined)
    vi.stubEnv('CONTEXT', 'production')
    vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', randomBytes(32).toString('hex'))
    const key = 'sk_live_' + randomBytes(24).toString('hex')
    vi.stubEnv('STRIPE_LIVE_SECRET_KEY', key)
    vi.stubEnv('STRIPE_LIVE_WEBHOOK_SECRET', '')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(
          url.endsWith('/account') ? { id: 'acct_fixture' } : { data: [] },
        ),
      ),
    )
    bootstrap.mockImplementationOnce(async (c) => {
      if (failure === 'database') await c.query('SELECT missing_setup_column')
      throw new Error('Private provider failure')
    })
    const { db, client } = await connectionDatabase()
    try {
      await client.query('BEGIN')
      await stripeSettings(client, 'live')
      await client.query('COMMIT')
      const row = (await client.query('SELECT * FROM stripe_provider_settings'))
        .rows[0]
      expect(row.account_id).toBe('acct_fixture')
      expect(row.validated_at).toBeTruthy()
      expect(openStripe(row.ciphertext, 'live').key).toBe(key)
      expect(row.configuration.setupError).toBe('BILLING_SETUP_INCOMPLETE')
      expect(row.checkout_enabled).toBe(false)
      expect(row.webhook_verified_at).toBeNull()
      expect(JSON.stringify(row)).not.toContain(key)
      expect(JSON.stringify(row)).not.toContain('Private provider failure')
    } finally {
      await db.close()
    }
  },
)

it('returns the saved LIVE connection when importing TEST credentials fails, without exposing credentials', async () => {
  vi.stubGlobal('Netlify', undefined)
  vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', randomBytes(32).toString('hex'))
  const key = 'sk_test_' + randomBytes(24).toString('hex')
  vi.stubEnv('STRIPE_TEST_SECRET_KEY', key)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 401 })),
  )
  const { db, client } = await connectionDatabase()
  try {
    await client.query(`INSERT INTO stripe_provider_settings
      (environment, ciphertext, fingerprint, account_id, validated_at)
      VALUES ('live', 'encrypted_fixture', 'sha256:fixture', 'acct_fixture', NOW())`)
    await client.query('BEGIN')
    const result = await stripeAdminView(client)
    await client.query('COMMIT')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].account_id).toBe('acct_fixture')
    expect(result.connectionErrors).toEqual({
      test: 'STRIPE_CONNECTION_UNAVAILABLE',
    })
    expect(JSON.stringify(result)).not.toContain(key)
    expect(JSON.stringify(result)).not.toContain('encrypted_fixture')
    expect(
      (await client.query('SELECT environment FROM stripe_provider_settings'))
        .rows,
    ).toEqual([{ environment: 'live' }])
  } finally {
    await db.close()
  }
})
it.each(['', 'production'])(
  'imports matching hosting credentials and bootstraps only trusted deployments (%s)',
  async (context) => {
    vi.stubEnv('CONTEXT', context)
    vi.stubGlobal('Netlify', undefined)
    vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', randomBytes(32).toString('hex'))
    const key = 'sk_live_' + randomBytes(24).toString('hex')
    vi.stubEnv('STRIPE_LIVE_SECRET_KEY', key)
    vi.stubEnv('STRIPE_LIVE_WEBHOOK_SECRET', '')
    let row: Record<string, unknown> = { environment: 'live' }
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('UPDATE'))
        row = { ...row, ciphertext: params[1], account_id: params[3] }
      return { rows: [row] }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(
          url.endsWith('/account') ? { id: 'acct_fixture' } : { data: [] },
        ),
      ),
    )
    const result = await stripeSettings({ query }, 'live')
    expect(result.account_id).toBe('acct_fixture')
    expect(result.ciphertext).not.toContain(key)
    expect(openStripe(result.ciphertext, 'live').key).toBe(key)
    expect(bootstrap).toHaveBeenCalledTimes(context === 'production' ? 1 : 0)
  },
)
