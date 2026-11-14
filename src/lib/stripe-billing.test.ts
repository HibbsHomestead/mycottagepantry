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
  stripeTierPurchasable,
  stripePortalMatchesPolicy,
  stripeEncryptionReady,
} from '../../netlify/lib/stripe-provider'
import {
  effectiveAccess,
  type ManualGrant,
} from '../../netlify/lib/manual-access'
import { stripeAdminAction } from '../../netlify/lib/stripe-provider'
import {
  stripeCheckout,
  stripePortal,
} from '../../netlify/lib/stripe-subscriptions'
import { launchPricing } from './launch-plans'
const testKey = 'sk_test_' + randomBytes(20).toString('hex')
const root = randomBytes(32).toString('hex')
beforeEach(() =>
  vi.stubGlobal('Netlify', {
    env: {
      get: (name: string) =>
        name === 'STRIPE_BILLING_ENCRYPTION_KEY'
          ? root
          : name === 'CONTEXT'
            ? 'production'
            : '',
    },
  }),
)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it('uses the existing encryption root from Node Functions without requiring Netlify.env', () => {
  const existing = sealStripe({ key: testKey }, 'test')
  vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', root)
  vi.stubGlobal('Netlify', undefined)
  expect(stripeEncryptionReady()).toBe(true)
  expect(openStripe(existing, 'test').key).toBe(testKey)
  expect(openStripe(sealStripe({ key: testKey }, 'test'), 'test').key).toBe(
    testKey,
  )
  vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', '')
  expect(stripeEncryptionReady()).toBe(false)
  expect(() => sealStripe({}, 'test')).toThrow(/hosting setup/)
  vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', 'invalid-root')
  expect(stripeEncryptionReady()).toBe(false)
  expect(() => sealStripe({}, 'test')).toThrow(/hosting setup/)
})
it('does not override an explicitly empty Netlify encryption root with a Node value', () => {
  vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', root)
  vi.stubGlobal('Netlify', { env: { get: () => '' } })
  expect(stripeEncryptionReady()).toBe(false)
  expect(() => sealStripe({}, 'test')).toThrow(/hosting setup/)
})
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
const portalConfiguration = {
  active: true,
  livemode: false,
  features: {
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
    subscription_update: { enabled: false },
    subscription_cancel: { enabled: false },
  },
}
it('requires portal payment methods/invoices and rejects subscription actions or environment mismatches', () => {
  expect(stripePortalMatchesPolicy(portalConfiguration, 'test')).toBe(true)
  expect(stripePortalMatchesPolicy(portalConfiguration, 'live')).toBe(false)
  for (const [feature, enabled] of [
    ['payment_method_update', false],
    ['invoice_history', false],
    ['subscription_update', true],
    ['subscription_cancel', true],
  ] as const)
    expect(
      stripePortalMatchesPolicy(
        {
          ...portalConfiguration,
          features: { ...portalConfiguration.features, [feature]: { enabled } },
        },
        'test',
      ),
    ).toBe(false)
})
it('launches the reviewed portal for the verified owner customer and records return evidence', async () => {
  const c = {
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT b.id'))
        return { rows: [{ id: 'business', role: 'Owner', active: true }] }
      if (sql.startsWith('SELECT * FROM stripe_checkouts'))
        return {
          rows: [
            { id: 'attempt', customer_id: 'cus_fixture', environment: 'test' },
          ],
        }
      if (sql.startsWith('SELECT * FROM stripe_provider_settings'))
        return {
          rows: [
            {
              ciphertext: sealStripe({ key: testKey, signing: '' }, 'test'),
              configuration: { policy: { portal: 'bpc_fixture' } },
            },
          ],
        }
      return { rows: [] }
    }),
  }
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/billing_portal/configurations/bpc_fixture'))
      return Response.json(portalConfiguration)
    if (url.endsWith('/billing_portal/sessions')) {
      const body = options?.body as URLSearchParams
      expect(body.get('customer')).toBe('cus_fixture')
      expect(body.get('configuration')).toBe('bpc_fixture')
      expect(body.get('return_url')).toBe(
        'https://mycottagepantry.com/oven/billing?checkout=verifying',
      )
      return Response.json({
        url: 'https://billing.stripe.com/p/session/fixture',
      })
    }
    throw new Error('Unexpected portal fixture request')
  })
  vi.stubGlobal('fetch', fetcher)
  expect(
    await stripePortal(c, {
      id: 'owner',
      email: 'fixture@example.invalid',
      privateTest: true,
      platformAdmin: false,
    }),
  ).toEqual({ url: 'https://billing.stripe.com/p/session/fixture' })
  expect(
    c.query.mock.calls.some(([sql]) =>
      sql.startsWith('UPDATE stripe_checkouts SET portal_launched_at'),
    ),
  ).toBe(true)
})
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
it('saves replacement credentials even when hosting import fails and returns only masked metadata', async () => {
  vi.stubGlobal('Netlify', undefined)
  vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', root)
  vi.stubEnv('STRIPE_TEST_SECRET_KEY', testKey)
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unavailable')))

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
    {
      role: 'owner',
      verified_at: new Date().toISOString(),
      verification_method: 'totp',
      mfa_at: new Date().toISOString(),
      identity_id: 'admin',
    },
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
it('preserves account validation and mappings when saving only a webhook secret', async () => {
  const mappings = { 'cottage-kitchen': { price: 'price_fixture' } }
  const row = {
    ciphertext: sealStripe({ key: testKey, signing: '' }, 'test'),
    configuration: { mappings, hostedLaunchReady: true },
    validated_at: new Date().toISOString(),
  }
  const query = vi.fn(async (sql: string, params: unknown[] = []) => ({
    rows:
      sql.startsWith('SELECT * FROM stripe_provider_settings') && params.length
        ? [row]
        : [],
  }))
  await stripeAdminAction(
    { query, release: vi.fn() },
    new Request('https://admin.mycottagepantry.com/api/admin?action=stripe', {
      method: 'POST',
      body: JSON.stringify({
        environment: 'test',
        operation: 'save',
        signing: ' whsec_fixture ',
        confirmation: 'SAVE TEST',
      }),
    }),
    {
      role: 'owner',
      verified_at: new Date().toISOString(),
      verification_method: 'totp',
      mfa_at: new Date().toISOString(),
    },
    'fixture',
  )
  const update = query.mock.calls.find(([sql]) =>
    sql.startsWith('UPDATE stripe_provider_settings'),
  )!
  expect(update[1]?.[4]).toBe(false)
  expect(update[1]?.[3]).toEqual({ mappings })
  expect(openStripe(String(update[1]?.[1]), 'test').signing).toBe(
    'whsec_fixture',
  )
  expect(update[0]).toContain('webhook_verified_at=NULL,checkout_enabled=false')
})
it('approves the $40 six-user tier in test mode without enabling live purchase', async () => {
  expect(stripeTierPurchasable('cottage-mercantile', 'test')).toBe(true)
  expect(stripeTierPurchasable('cottage-mercantile', 'live')).toBe(false)
  const c = {
    release: vi.fn(),
    query: vi.fn(async (sql: string) => ({
      rows: sql.startsWith('SELECT * FROM stripe_provider_settings')
        ? [
            {
              validated_at: new Date().toISOString(),
              configuration: {},
              ciphertext: sealStripe({ key: testKey, signing: '' }, 'test'),
            },
          ]
        : [],
    })),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ...price,
        unit_amount: 4000,
        product: {
          active: true,
          metadata: { cottage_pantry_tier: 'cottage-mercantile' },
        },
      }),
    ),
  )
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
      {
        role: 'owner',
        verified_at: new Date().toISOString(),
        verification_method: 'totp',
        mfa_at: new Date().toISOString(),
      },
      'fixture',
    ),
  ).resolves.toBeDefined()
  expect(
    c.query.mock.calls.some(([sql]) =>
      sql.startsWith(
        'UPDATE stripe_provider_settings SET configuration=$2,checkout_enabled=false',
      ),
    ),
  ).toBe(true)
  const writes = c.query.mock.calls.length
  await expect(
    stripeAdminAction(
      c,
      new Request(request.url, {
        method: 'POST',
        body: JSON.stringify({
          environment: 'live',
          operation: 'map',
          plan: 'cottage-mercantile',
          price: 'price_fixture',
          purchase: true,
        }),
      }),
      {
        role: 'owner',
        verified_at: new Date().toISOString(),
        verification_method: 'totp',
        mfa_at: new Date().toISOString(),
      },
      'fixture',
    ),
  ).rejects.toMatchObject({ code: 'TIER_INCOMPLETE' })
  expect(
    c.query.mock.calls
      .slice(writes)
      .some(([sql]) => sql.startsWith('UPDATE stripe_provider_settings')),
  ).toBe(false)
})
it('never starts live checkout from a preview/dev copy of enabled production settings', async () => {
  vi.stubGlobal('Netlify', {
    env: {
      get: (name: string) =>
        name === 'STRIPE_BILLING_ENCRYPTION_KEY'
          ? root
          : name === 'CONTEXT'
            ? 'deploy-preview'
            : '',
    },
  })
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

it.each(launchPricing.plans.filter((p) => p.monthlyUsd > 0))(
  'creates and resumes one test checkout for $id at the approved price',
  async (tier) => {
    let attempt: Record<string, unknown> | null = null
    const url = 'https://checkout.stripe.com/c/pay/fixture'
    const c = {
      release: vi.fn(),
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.startsWith('SELECT b.id'))
          return { rows: [{ id: 'business', role: 'Owner', active: true }] }
        if (sql.startsWith('SELECT * FROM stripe_provider_settings'))
          return {
            rows: [
              {
                checkout_enabled: true,
                validated_at: '2026-11-14',
                webhook_verified_at: '2026-11-14',
                ciphertext: sealStripe({ key: testKey, signing: '' }, 'test'),
                configuration: {
                  policy: {},
                  mappings: {
                    [tier.id]: { price: 'price_fixture', purchase: true },
                  },
                },
              },
            ],
          }
        if (sql.startsWith('SELECT * FROM stripe_checkouts'))
          return { rows: attempt ? [attempt] : [] }
        if (sql.startsWith('INSERT INTO stripe_checkouts')) {
          attempt = {
            id: params[0],
            price_id: params[5],
            environment: 'test',
            plan_id: tier.id,
          }
          return { rows: [attempt] }
        }
        if (sql.startsWith('UPDATE stripe_checkouts SET session_id'))
          attempt = { ...attempt, session_id: params[1] }
        return { rows: [] }
      }),
    }
    const fetcher = vi.fn(async (address: string, options?: RequestInit) => {
      if (address.endsWith('/prices/price_fixture'))
        return Response.json({
          ...price,
          unit_amount: tier.monthlyUsd * 100,
          product: { active: true, metadata: { cottage_pantry_tier: tier.id } },
        })
      if (address.endsWith('/checkout/sessions')) {
        const body = options?.body as URLSearchParams
        expect(body.get('line_items[0][price]')).toBe('price_fixture')
        expect(body.get('line_items[0][quantity]')).toBe('1')
        expect(body.get('subscription_data[trial_period_days]')).toBeNull()
        expect(
          (options?.headers as Record<string, string>)['Idempotency-Key'],
        ).toBe('cottage-checkout-' + attempt?.id)
        return Response.json({
          id: 'cs_fixture',
          mode: 'subscription',
          livemode: false,
          url,
          expires_at: 2000000000,
        })
      }
      if (address.endsWith('/checkout/sessions/cs_fixture'))
        return Response.json({ status: 'open', url })
      throw new Error('Unexpected Stripe fixture request')
    })
    vi.stubGlobal('fetch', fetcher)
    const actor = {
      id: 'owner',
      email: 'fixture@example.invalid',
      privateTest: true,
      platformAdmin: false,
    }
    const input = {
      environment: 'test' as const,
      plan: tier.id,
      confirmed: true,
    }
    await stripeCheckout(c, actor, input, true)
    expect(
      fetcher.mock.calls.some(([address]) =>
        address.endsWith('/checkout/sessions'),
      ),
    ).toBe(false)
    expect(await stripeCheckout(c, actor, input)).toEqual({ url })
    expect(await stripeCheckout(c, actor, input)).toEqual({ url })
    expect(
      fetcher.mock.calls.filter(([address]) =>
        address.endsWith('/checkout/sessions'),
      ),
    ).toHaveLength(1)
    expect(
      c.query.mock.calls.filter(([sql]) =>
        sql.startsWith('INSERT INTO stripe_checkouts'),
      ),
    ).toHaveLength(1)
  },
)
