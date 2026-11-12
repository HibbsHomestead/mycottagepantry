// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHmac, randomBytes } from 'node:crypto'
import {
  keyMatches,
  openStripe,
  sealStripe,
  stripePriceIssue,
  stripeRequest,
  verifyStripeSignature,
} from '../../netlify/lib/stripe-provider'
import {
  effectiveAccess,
  type ManualGrant,
} from '../../netlify/lib/manual-access'
import { stripeAdminAction } from '../../netlify/lib/stripe-provider'
import { stripeCheckout } from '../../netlify/lib/stripe-subscriptions'
const testKey = 'sk_test_' + randomBytes(20).toString('hex')
const root = randomBytes(32).toString('hex')
beforeEach(() =>
  vi.stubGlobal('Netlify', {
    env: {
      get: (name: string) =>
        name === 'STRIPE_BILLING_ENCRYPTION_KEY' ? root : '',
    },
  }),
)
afterEach(() => vi.unstubAllGlobals())
it('encrypts credentials with an environment binding and rejects tampering or missing root', () => {
  const value = sealStripe({ key: testKey, signing: 'fixture-signing' }, 'test')
  expect(value).not.toContain(testKey)
  expect(openStripe(value, 'test').key).toBe(testKey)
  expect(() => openStripe(value, 'live')).toThrow()
  const parts = value.split('.')
  parts[2] = randomBytes(16).toString('base64url')
  expect(() => openStripe(parts.join('.'), 'test')).toThrow()
  vi.stubGlobal('Netlify', { env: { get: () => '' } })
  expect(() => sealStripe({}, 'test')).toThrow(/hosting setup/)
})
it('rejects test/live key mismatches', () => {
  expect(keyMatches(testKey, 'test')).toBe(true)
  expect(keyMatches(testKey, 'live')).toBe(false)
  expect(keyMatches('pk_test_fixture', 'test')).toBe(false)
})
it('requires a timely exact raw-body signature and permits provider rotation signatures', () => {
  const now = Date.now(),
    t = String(Math.floor(now / 1000)),
    raw = '{"test": true}',
    signing = randomBytes(32).toString('hex')
  const h = createHmac('sha256', signing)
    .update(t + '.' + raw)
    .digest('hex')
  expect(
    verifyStripeSignature(raw, `t=${t},v1=invalid,v1=${h}`, signing, now),
  ).toBe(true)
  expect(verifyStripeSignature(raw + ' ', `t=${t},v1=${h}`, signing, now)).toBe(
    false,
  )
  expect(
    verifyStripeSignature(raw, `t=${t},v1=${h}`, signing, now + 301000),
  ).toBe(false)
  expect(verifyStripeSignature(raw, 't=invalid,v1=00', signing, now)).toBe(
    false,
  )
})
const price = {
  livemode: false,
  active: true,
  type: 'recurring',
  currency: 'usd',
  unit_amount: 3000,
  billing_scheme: 'per_unit',
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
  product: {
    active: true,
    metadata: { cottage_pantry_tier: 'cottage-kitchen' },
  },
}
it('validates recurring objects, approved amounts, environment and tier metadata', () => {
  expect(stripePriceIssue(price, 'cottage-kitchen', 'test')).toBeNull()
  for (const change of [
    { livemode: true },
    { active: false },
    { unit_amount: 4000 },
    { currency: 'eur' },
    { recurring: { interval: 'year' } },
    {
      product: {
        active: true,
        metadata: { cottage_pantry_tier: 'mixing-bowl' },
      },
    },
    { transform_quantity: { divide_by: 2 } },
  ])
    expect(
      stripePriceIssue({ ...price, ...change }, 'cottage-kitchen', 'test'),
    ).toBeTruthy()
})
it('does not surface provider errors and never fetches arbitrary URLs or follows redirects', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: { message: testKey } }), {
      status: 403,
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  await expect(stripeRequest(testKey, '/account')).rejects.toThrow(
    'Stripe rejected this request',
  )
  expect(fetcher.mock.calls[0][0]).toBe('https://api.stripe.com/v1/account')
  expect(fetcher.mock.calls[0][1].redirect).toBe('error')
  await expect(stripeRequest(testKey, 'https://example.com')).rejects.toThrow(
    'Invalid internal Stripe path',
  )
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('keeps manual overrides across Stripe changes and falls back on revocation/expiry; suspensions win', () => {
  const row = {
    plan_id: 'mixing-bowl' as const,
    status: 'paid_active',
    source: 'stripe_live',
    environment: 'live',
    paid_through: '2027-01-01',
  }
  const grant: ManualGrant = {
    id: 'fixture',
    plan_id: 'cottage-kitchen',
    operation: 'grant',
    grant_source: 'test',
    owner_identity: 'owner',
    actor_identity: 'admin',
    reason: 'Disposable test',
    created_at: '2026-01-01',
    expires_at: '2026-12-01',
  }
  const now = Date.parse('2026-11-12')
  expect(effectiveAccess(row, grant, 'owner', now).plan).toBe('cottage-kitchen')
  expect(
    effectiveAccess({ ...row, status: 'payment_failed' }, grant, 'owner', now)
      .plan,
  ).toBe('cottage-kitchen')
  expect(
    effectiveAccess(row, { ...grant, operation: 'revoke' }, 'owner', now).plan,
  ).toBe('mixing-bowl')
  expect(
    effectiveAccess(row, grant, 'owner', Date.parse('2026-12-02')).plan,
  ).toBe('mixing-bowl')
  expect(
    effectiveAccess(row, null, 'owner', Date.parse('2027-02-01')).plan,
  ).toBe('free')
  expect(
    effectiveAccess(
      { ...row, status: 'security_suspended' },
      grant,
      'owner',
      now,
    ).access?.write,
  ).toBe(false)
})
it('denies provider actions without platform MFA, even with a business Owner role', async () => {
  const c = { query: vi.fn(), release: vi.fn() }
  await expect(
    stripeAdminAction(
      c,
      new Request('https://admin.mycottagepantry.com/api/admin'),
      { role: 'Owner' },
      'fixture',
    ),
  ).rejects.toThrow('administrator')
  expect(c.query).not.toHaveBeenCalled()
})
it('denies checkout to non-owner business members before looking up credentials', async () => {
  const c = {
    query: vi.fn().mockResolvedValue({
      rows: [{ id: 'business', role: 'Manager', active: true }],
    }),
    release: vi.fn(),
  }
  await expect(
    stripeCheckout(
      c,
      {
        id: 'member',
        email: 'fixture@example.invalid',
        privateTest: false,
        platformAdmin: false,
      },
      { environment: 'live', plan: 'cottage-kitchen', confirmed: true },
    ),
  ).rejects.toThrow('business owner')
  expect(
    c.query.mock.calls.some(([sql]) =>
      sql.includes('stripe_provider_settings'),
    ),
  ).toBe(false)
})
it('returns masked metadata after credential save and audits only environment/action/tier', async () => {
  const queries: { sql: string; params: unknown[] }[] = []
  const c = {
    release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params })
      if (sql.startsWith('SELECT * FROM stripe_provider_settings'))
        return { rows: [{ configuration: {} }] }
      if (sql.startsWith('SELECT environment,fingerprint'))
        return {
          rows: [
            {
              environment: 'test',
              fingerprint: 'sha256:fixture',
              configuration: {},
            },
          ],
        }
      return { rows: [] }
    }),
  }
  const request = new Request(
    'https://admin.mycottagepantry.com/api/admin?action=stripe',
    {
      method: 'POST',
      body: JSON.stringify({
        environment: 'test',
        operation: 'save',
        key: testKey,
        signing: 'whsec_fixture',
        confirmation: 'SAVE TEST',
      }),
    },
  )
  const result = await stripeAdminAction(
    c,
    request,
    { role: 'owner', mfa_at: new Date().toISOString(), identity_id: 'admin' },
    'fixture',
  )
  expect(JSON.stringify(result)).not.toContain(testKey)
  const update = queries.find((q) =>
    q.sql.startsWith('UPDATE stripe_provider_settings'),
  )!
  expect(String(update.params[1])).not.toContain(testKey)
  const audit = queries.find((q) =>
    q.sql.startsWith('INSERT INTO platform_audit'),
  )!
  expect(JSON.stringify(audit.params)).not.toContain(testKey)
  expect(JSON.stringify(audit.params)).not.toContain('whsec_fixture')
})
it('cannot approve the unresolved $40 tier for purchase', async () => {
  const c = {
    release: vi.fn(),
    query: vi.fn(async (sql: string) => ({
      rows: sql.startsWith('SELECT * FROM stripe_provider_settings')
        ? [{ validated_at: new Date().toISOString(), configuration: {} }]
        : [],
    })),
  }
  const request = new Request(
    'https://admin.mycottagepantry.com/api/admin?action=stripe',
    {
      method: 'POST',
      body: JSON.stringify({
        environment: 'test',
        operation: 'map',
        plan: 'cottage-mercantile',
        price: 'price_fixture',
        purchase: true,
      }),
    },
  )
  await expect(
    stripeAdminAction(
      c,
      request,
      { role: 'owner', mfa_at: new Date().toISOString() },
      'fixture',
    ),
  ).rejects.toThrow('not approved for purchase')
})
it('never starts live checkout from a preview/dev copy of enabled production settings', async () => {
  const c = {
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT b.id'))
        return { rows: [{ id: 'business', role: 'Owner', active: true }] }
      if (sql.startsWith('SELECT * FROM stripe_provider_settings'))
        return {
          rows: [
            {
              checkout_enabled: true,
              validated_at: '2026-11-12',
              webhook_verified_at: '2026-11-12',
              configuration: {
                policy: {},
                mappings: {
                  'cottage-kitchen': { price: 'price_fixture', purchase: true },
                },
              },
            },
          ],
        }
      return { rows: [] }
    }),
  }
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(
    stripeCheckout(
      c,
      {
        id: 'owner',
        email: 'fixture@example.invalid',
        privateTest: true,
        platformAdmin: true,
      },
      { environment: 'live', plan: 'cottage-kitchen', confirmed: true },
    ),
  ).rejects.toThrow('not approved for checkout')
  expect(fetcher).not.toHaveBeenCalled()
  expect(
    c.query.mock.calls.some(([sql]) =>
      sql.startsWith('INSERT INTO stripe_checkouts'),
    ),
  ).toBe(false)
})
