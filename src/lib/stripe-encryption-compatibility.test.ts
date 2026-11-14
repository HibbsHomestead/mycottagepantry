// @vitest-environment node
import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, expect, it, vi } from 'vitest'
import {
  openStripe,
  sealStripe,
  stripeSettings,
  stripeCheckoutEnabled,
} from '../../netlify/lib/stripe-provider'
import { stripeEncryptionStatus } from '../../netlify/lib/runtime-environment'
import type { AdminMetadata } from './platform-admin-types'

// Produce old-format records independently of the application's current writer.
// All key material is disposable test data, never project configuration.
function historicalRecord(
  version: 'v1' | 'v2live',
  root: string,
  binding: string,
  credentials: { key: string; signing: string },
) {
  const storageKey = /^(sk|rk)_/.test(root)
    ? Buffer.from(
        hkdfSync('sha256', root, '', 'cottage-stripe:storage-root:v1', 32),
      )
    : Buffer.from(root, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', storageKey, iv)
  cipher.setAAD(Buffer.from('cottage-stripe:v1:' + binding))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), 'utf8'),
    cipher.final(),
  ])
  return [
    version,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it.each(['sk', 'rk'])(
  'reads earlier %s-derived fallback records with a new dedicated root and keeps writes on that root',
  (kind) => {
    const originalCredential = kind + '_live_' + randomBytes(24).toString('hex')
    const dedicated = randomBytes(32).toString('hex')
    const credentials = { key: originalCredential, signing: 'fixture-signing' }
    const historical = historicalRecord(
      'v2live',
      originalCredential,
      'live',
      credentials,
    )
    // Exercise the mixed Netlify/Node delivery used by deployed Functions.
    vi.stubGlobal('Netlify', {
      env: {
        get: (name: string) =>
          name === 'STRIPE_BILLING_ENCRYPTION_KEY' ? dedicated : undefined,
      },
    })
    vi.stubEnv('STRIPE_LIVE_SECRET_KEY', originalCredential)
    expect(stripeEncryptionStatus()).toMatchObject({
      ready: true,
      source: 'netlify',
    })
    expect(openStripe(historical, 'live')).toEqual(credentials)
    expect(() => openStripe(historical, 'test')).toThrow()

    const current = sealStripe(credentials, 'live')
    expect(current).toMatch(/^v1\./)
    expect(openStripe(current, 'live')).toEqual(credentials)
    vi.stubEnv('STRIPE_LIVE_SECRET_KEY', undefined)
    expect(openStripe(current, 'live')).toEqual(credentials)
    // The new dedicated key cannot replace an old fallback's original key.
    expect(() => openStripe(historical, 'live')).toThrow()
    vi.stubEnv('STRIPE_LIVE_SECRET_KEY', originalCredential)
    expect(openStripe(historical, 'live')).toEqual(credentials)

    const tampered = historical.split('.')
    tampered[2] = randomBytes(16).toString('base64url')
    expect(() => openStripe(tampered.join('.'), 'live')).toThrow()
    expect(() =>
      openStripe(historical.replace(/^v2live/, 'v1'), 'live'),
    ).toThrow()
  },
)

it.each(['dedicated', 'credential'])(
  'does not claim recovery for v1 records encrypted with an unavailable previous %s root',
  (kind) => {
    const credential = 'sk_live_' + randomBytes(24).toString('hex')
    const previous =
      kind === 'dedicated' ? randomBytes(32).toString('hex') : credential
    const historical = historicalRecord('v1', previous, 'live', {
      key: credential,
      signing: 'fixture-signing',
    })
    vi.stubGlobal('Netlify', undefined)
    vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', randomBytes(32).toString('hex'))
    vi.stubEnv('STRIPE_LIVE_SECRET_KEY', credential)
    expect(() => openStripe(historical, 'live')).toThrow()
    // Restoring the original root in this isolated fixture proves the dependency.
    vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', previous)
    expect(openStripe(historical, 'live').key).toBe(credential)
  },
)

it('preserves persisted fallback and dedicated-root records across separate reads without provider calls or checkout activation', async () => {
  const credential = 'rk_live_' + randomBytes(24).toString('hex')
  const dedicated = randomBytes(32).toString('hex')
  const oldRoot = randomBytes(32).toString('hex')
  const records = [
    {
      environment: 'live',
      ciphertext: historicalRecord('v2live', credential, 'live', {
        key: credential,
        signing: 'fixture-live-signing',
      }),
    },
    {
      environment: 'test',
      ciphertext: historicalRecord('v1', dedicated, 'test', {
        key: 'sk_test_' + randomBytes(24).toString('hex'),
        signing: 'fixture-test-signing',
      }),
    },
  ]
  vi.stubGlobal('Netlify', undefined)
  vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', dedicated)
  vi.stubEnv('STRIPE_LIVE_SECRET_KEY', credential)
  const transport = vi.fn(() => {
    throw new Error('Provider calls are forbidden during compatibility checks')
  })
  vi.stubGlobal('fetch', transport)
  const db = new PGlite()
  const statements: string[] = []
  const client = {
    query: (sql: string, params?: unknown[]) => {
      statements.push(sql)
      return db.query<AdminMetadata>(sql, params)
    },
  }
  try {
    await db.exec(`CREATE TABLE stripe_provider_settings (
      environment text PRIMARY KEY, ciphertext text NOT NULL,
      checkout_enabled boolean DEFAULT false,
      configuration jsonb DEFAULT '{}'
    )`)
    for (const row of records)
      await db.query(
        'INSERT INTO stripe_provider_settings(environment,ciphertext) VALUES($1,$2)',
        [row.environment, row.ciphertext],
      )
    for (let request = 0; request < 2; request++) {
      await client.query('BEGIN READ ONLY')
      for (const record of records) {
        const row = await stripeSettings(
          client,
          record.environment as 'test' | 'live',
        )
        expect(row.ciphertext).toBe(record.ciphertext)
        expect(openStripe(row.ciphertext, record.environment).signing).toBe(
          `fixture-${record.environment}-signing`,
        )
        expect(stripeCheckoutEnabled(row, 'live')).toBe(false)
      }
      await client.query('COMMIT')
    }
    // An unreadable old v1 row is also preserved, never silently reimported.
    const unavailable = historicalRecord('v1', oldRoot, 'test', {
      key: 'sk_test_' + randomBytes(24).toString('hex'),
      signing: 'fixture-test-signing',
    })
    await db.query(
      "UPDATE stripe_provider_settings SET ciphertext=$1 WHERE environment='test'",
      [unavailable],
    )
    await client.query('BEGIN READ ONLY')
    const row = await stripeSettings(client, 'test')
    expect(() => openStripe(row.ciphertext, 'test')).toThrow()
    expect(row.ciphertext).toBe(unavailable)
    await client.query('COMMIT')
    expect(
      statements.some((sql) =>
        /^(INSERT|UPDATE|DELETE|ALTER|DROP)\b/.test(sql),
      ),
    ).toBe(false)
    expect(transport).not.toHaveBeenCalled()
    expect(
      stripeCheckoutEnabled(
        { checkout_enabled: true, configuration: { hostedLaunchReady: true } },
        'live',
      ),
    ).toBe(false)
  } finally {
    await db.close()
  }
})
