/* eslint-disable @typescript-eslint/no-explicit-any -- untyped Square provider JSON */
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activeBillingEnvironment,
  billingConfiguration,
  catalogPlanName,
  catalogVariationName,
  correlateCheckout,
  createHostedSubscriptionCheckout,
  normalizeInvoice,
  subscriptionCoverage,
  syncSandboxPlans,
} from '../../netlify/lib/square-billing'
import {
  enforceSquareBilledWrite,
  squareBilledAccess,
} from '../../netlify/lib/billing-entitlements'
import { verifySquareSignature } from '../../netlify/lib/square-sandbox'
import { squareWebhookUrl } from '../../netlify/lib/square-credentials'
import { planMonthlyCents, billablePlanIds } from './launch-plans'

/** Mock-only suite: no live Square request is made. */
const sandboxEnv: Record<string, string> = {
  CONTEXT: 'deploy-preview',
  REGISTRATION_PRIVATE_TESTS_ENABLED: 'true',
  SQUARE_SANDBOX_ENABLED: 'true',
  SQUARE_SANDBOX_ACCESS_TOKEN: 'test-token',
  SQUARE_SANDBOX_API_VERSION: '2026-01-22',
  SQUARE_SANDBOX_LOCATION_ID: 'LOC1',
  SQUARE_SANDBOX_MERCHANT_ID: 'MERCHANT1',
  SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY: 'sig',
  SQUARE_SANDBOX_WEBHOOK_URL: 'https://example.test/api/square/sandbox/webhook',
}
function withEnv(values: Record<string, string>) {
  vi.stubGlobal('Netlify', { env: { get: (k: string) => values[k] } })
}
afterEach(() => vi.unstubAllGlobals())

describe('approved pricing', () => {
  it('charges the approved monthly USD amounts', () => {
    expect(billablePlanIds.map(planMonthlyCents)).toEqual([
      1000, 2000, 3000, 4000,
    ])
  })
})

describe('configuration gates', () => {
  it('never reports checkout available from partial settings', () => {
    withEnv({ ...sandboxEnv, SQUARE_SANDBOX_LOCATION_ID: '' })
    expect(billingConfiguration('sandbox').missing).toContain(
      'SQUARE_SANDBOX_LOCATION_ID',
    )
    expect(activeBillingEnvironment()).toBe(null)
  })
  it('keeps production checkout off even with every production setting', () => {
    withEnv({
      CONTEXT: 'production',
      SQUARE_PRODUCTION_BILLING_ENABLED: 'true',
      SQUARE_PRODUCTION_ACCESS_TOKEN: 't',
      SQUARE_PRODUCTION_API_VERSION: 'v',
      SQUARE_PRODUCTION_LOCATION_ID: 'L',
      SQUARE_PRODUCTION_MERCHANT_ID: 'M',
      SQUARE_PRODUCTION_WEBHOOK_SIGNATURE_KEY: 'k',
      SQUARE_PRODUCTION_WEBHOOK_URL: 'https://x.test/w',
    })
    expect(billingConfiguration('production').checkoutPermitted).toBe(false)
    expect(activeBillingEnvironment()).toBe(null)
  })
  it('allows Sandbox only in a private test deployment', () => {
    withEnv(sandboxEnv)
    expect(activeBillingEnvironment()).toBe('sandbox')
    withEnv({ ...sandboxEnv, CONTEXT: 'production' })
    expect(activeBillingEnvironment()).toBe(null)
  })
})

describe('deployed webhook URL configuration', () => {
  it('derives the exact Sandbox URL from a trusted preview without requiring a copied setting', () => {
    withEnv({
      ...sandboxEnv,
      DEPLOY_URL: 'https://billing-preview--mycottagepantry.netlify.app',
      SQUARE_SANDBOX_WEBHOOK_URL: '',
    })
    expect(squareWebhookUrl('sandbox')).toBe(
      'https://billing-preview--mycottagepantry.netlify.app/api/square/sandbox/webhook',
    )
    expect(billingConfiguration('sandbox').missing).not.toContain(
      'SQUARE_SANDBOX_WEBHOOK_URL',
    )
  })
  it('rejects untrusted or malformed URL defaults and overrides', () => {
    for (const origin of [
      'https://foreign.test',
      'http://billing-preview--mycottagepantry.netlify.app',
      'https://billing-preview--mycottagepantry.netlify.app/extra',
    ]) {
      withEnv({
        ...sandboxEnv,
        DEPLOY_URL: origin,
        SQUARE_SANDBOX_WEBHOOK_URL: '',
      })
      expect(squareWebhookUrl('sandbox')).toBe('')
      expect(activeBillingEnvironment()).toBe(null)
    }
    for (const url of [
      'https://example.test/wrong',
      'https://example.test/api/square/production/webhook',
      'https://example.test/api/square/sandbox/webhook?changed=1',
    ]) {
      withEnv({ ...sandboxEnv, SQUARE_SANDBOX_WEBHOOK_URL: url })
      expect(squareWebhookUrl('sandbox')).toBe('')
      expect(activeBillingEnvironment()).toBe(null)
    }
  })
  it('provides the implemented Production URL without enabling checkout', () => {
    withEnv({ CONTEXT: 'production' })
    expect(squareWebhookUrl('production')).toBe(
      'https://admin.mycottagepantry.com/api/square/production/webhook',
    )
    expect(activeBillingEnvironment()).toBe(null)
  })
})

describe('webhook signatures', () => {
  const url = sandboxEnv.SQUARE_SANDBOX_WEBHOOK_URL
  const body = '{"event_id":"e1"}'
  const sign = (b: string, u = url) =>
    createHmac('sha256', 'sig')
      .update(u + b)
      .digest('base64')
  it('accepts the exact URL and raw body only', () => {
    expect(verifySquareSignature(body, sign(body), url, 'sig')).toBe(true)
    expect(verifySquareSignature(body + ' ', sign(body), url, 'sig')).toBe(
      false,
    )
    expect(
      verifySquareSignature(body, sign(body, url + '?x'), url, 'sig'),
    ).toBe(false)
    expect(verifySquareSignature(body, null, url, 'sig')).toBe(false)
    expect(verifySquareSignature(body, sign(body), url, 'other')).toBe(false)
  })
})

describe('Sandbox plans and checkout (mock transport)', () => {
  it('creates missing catalog plans with deterministic idempotency keys', async () => {
    withEnv(sandboxEnv)
    const transport = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/v2/catalog/search'))
        return Response.json({ objects: [] })
      const body = JSON.parse(String(init?.body))
      const object = body.object
      return Response.json({
        catalog_object: {
          ...object,
          id: object.type === 'SUBSCRIPTION_PLAN' ? 'PLAN' : 'VAR',
        },
      })
    }) as unknown as typeof fetch
    const first = await syncSandboxPlans(transport)
    expect(first.problems).toEqual([])
    expect(first.mappings.map((m) => m.amountCents)).toEqual([
      1000, 2000, 3000, 4000,
    ])
    // Creation requests carry deterministic idempotency keys.
    const keys = (transport as any).mock.calls
      .filter((c: any[]) => String(c[0]).endsWith('/v2/catalog/object'))
      .map((c: any[]) => JSON.parse(c[1].body).idempotency_key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys[0]).toMatch(/^cottage-pantry-sandbox-plan-mixing-bowl-v1$/)
  })

  it('makes no catalog writes when matching plans already exist', async () => {
    withEnv(sandboxEnv)
    const objects = billablePlanIds.flatMap((id) => [
      {
        id: 'P-' + id,
        type: 'SUBSCRIPTION_PLAN',
        subscription_plan_data: { name: catalogPlanName(id) },
      },
      {
        id: 'V-' + id,
        type: 'SUBSCRIPTION_PLAN_VARIATION',
        subscription_plan_variation_data: {
          name: catalogVariationName(id),
          subscription_plan_id: 'P-' + id,
          phases: [
            {
              cadence: 'MONTHLY',
              ordinal: 0,
              pricing: {
                type: 'STATIC',
                price_money: { amount: planMonthlyCents(id), currency: 'USD' },
              },
            },
          ],
        },
      },
    ])
    const transport = vi.fn(async () =>
      Response.json({ objects }),
    ) as unknown as typeof fetch
    const result = await syncSandboxPlans(transport)
    expect(result.problems).toEqual([])
    expect(result.mappings.map((m) => m.variationId)).toEqual(
      billablePlanIds.map((id) => 'V-' + id),
    )
    expect((transport as any).mock.calls).toHaveLength(1)
  })
  it('creates hosted checkout with the server price and one idempotency key per attempt', async () => {
    withEnv(sandboxEnv)
    const transport = vi.fn(async () =>
      Response.json({
        payment_link: {
          id: 'link',
          url: 'https://sandbox.square.link/u/abc',
          order_id: 'order',
        },
      }),
    ) as unknown as typeof fetch
    for (const planId of billablePlanIds) {
      await createHostedSubscriptionCheckout(
        'sandbox',
        {
          attemptId: 'attempt-' + planId,
          planId,
          variationId: 'VAR-' + planId,
          redirectUrl: 'https://example.test/oven/billing',
        },
        transport,
      )
    }
    const bodies = (transport as any).mock.calls.map((c: any[]) =>
      JSON.parse(c[1].body),
    )
    expect(bodies.map((b: any) => b.quick_pay.price_money.amount)).toEqual([
      1000, 2000, 3000, 4000,
    ])
    expect(bodies[0]).toMatchObject({
      idempotency_key: 'attempt-mixing-bowl',
      checkout_options: { subscription_plan_id: 'VAR-mixing-bowl' },
      quick_pay: { location_id: 'LOC1', price_money: { currency: 'USD' } },
    })
  })
})

const attempt = {
  createdAt: '2026-11-06T10:00:00Z',
  planVariationId: 'VAR',
  locationId: 'LOC1',
  orderId: 'order',
}
const subscription = (extra = {}) => ({
  id: 'sub',
  customer_id: 'cust',
  plan_variation_id: 'VAR',
  location_id: 'LOC1',
  created_at: '2026-11-06T10:01:00Z',
  ...extra,
})
describe('checkout correlation', () => {
  const now = Date.parse('2026-11-06T10:10:00Z')
  it('keeps an abandoned or unpaid checkout pending and grants nothing', () => {
    expect(
      correlateCheckout(
        attempt,
        { id: 'order' },
        [],
        [subscription()],
        new Set(),
        now,
      ).state,
    ).toBe('pending')
  })
  it('reports a failed initial payment', () => {
    expect(
      correlateCheckout(
        attempt,
        { id: 'order' },
        [{ order_id: 'order', status: 'FAILED' }],
        [],
        new Set(),
        now,
      ).state,
    ).toBe('failed')
  })
  it('links exactly one matching unclaimed subscription', () => {
    expect(
      correlateCheckout(
        attempt,
        { id: 'order' },
        [{ order_id: 'order', status: 'COMPLETED', customer_id: 'cust' }],
        [subscription(), subscription({ id: 'other', plan_variation_id: 'X' })],
        new Set(),
        now,
      ),
    ).toEqual({ state: 'linked', subscriptionId: 'sub', customerId: 'cust' })
  })
  it('sends ambiguous or already-claimed matches to review, never by email', () => {
    const paid = [
      { order_id: 'order', status: 'COMPLETED', customer_id: 'cust' },
    ]
    expect(
      correlateCheckout(
        attempt,
        { id: 'order' },
        paid,
        [subscription(), subscription({ id: 'sub2' })],
        new Set(),
        now,
      ).state,
    ).toBe('needs_review')
    expect(
      correlateCheckout(
        attempt,
        { id: 'order' },
        paid,
        [subscription()],
        new Set(['sub']),
        now + 2 * 3600000,
      ).state,
    ).toBe('needs_review')
    expect(
      correlateCheckout(
        attempt,
        { id: 'order' },
        [{ order_id: 'other-order', status: 'COMPLETED', customer_id: 'cust' }],
        [subscription()],
        new Set(),
        now,
      ).state,
    ).toBe('pending')
  })
})

const invoice = (status: string, date: string, cents = 2000, extra = {}) =>
  normalizeInvoice({
    id: 'inv-' + date,
    subscription_id: 'sub',
    status,
    sale_or_service_date: date,
    payment_requests: [
      {
        computed_amount_money: { amount: cents, currency: 'USD' },
        total_completed_amount_money: {
          amount: status === 'PAID' || status === 'REFUNDED' ? cents : 0,
          currency: 'USD',
        },
      },
    ],
    ...extra,
  })
describe('paid coverage', () => {
  const base = {
    planId: 'bakers-bench' as const,
    subscription: { status: 'ACTIVE' },
    graceDays: 7,
  }
  const at = (d: string) => Date.parse(d + 'T12:00:00Z')
  it('does not treat an ACTIVE subscription with an unpaid invoice as paid', () => {
    const c = subscriptionCoverage(
      { ...base, invoices: [invoice('UNPAID', '2026-11-06')] },
      at('2026-11-07'),
    )
    expect(c.state).toBe('payment_processing')
    expect(c.accessPlan).toBe(null)
  })
  it('grants the paid month from a settled invoice and advances on renewal', () => {
    const first = invoice('PAID', '2026-11-06')
    expect(
      subscriptionCoverage({ ...base, invoices: [first] }, at('2026-11-20')),
    ).toMatchObject({
      state: 'paid_active',
      paidThrough: '2026-12-06',
      accessPlan: 'bakers-bench',
    })
    const renewed = subscriptionCoverage(
      { ...base, invoices: [first, invoice('PAID', '2026-12-06')] },
      at('2026-12-10'),
    )
    expect(renewed.paidThrough).toBe('2027-01-06')
  })
  it('applies grace after a failed renewal, then falls back to Free scope', () => {
    const invoices = [
      invoice('PAID', '2026-11-06'),
      invoice('FAILED', '2026-12-06'),
    ]
    expect(
      subscriptionCoverage({ ...base, invoices }, at('2026-12-08')).state,
    ).toBe('past_due')
    const lapsed = subscriptionCoverage({ ...base, invoices }, at('2026-12-20'))
    expect(lapsed.state).toBe('expired')
    expect(lapsed.accessPlan).toBe(null)
  })
  it('rejects underpaid, refunded and disputed coverage', () => {
    expect(
      subscriptionCoverage(
        { ...base, invoices: [invoice('PAID', '2026-11-06', 1000)] },
        at('2026-11-07'),
      ).accessPlan,
    ).toBe(null)
    expect(
      subscriptionCoverage(
        { ...base, invoices: [invoice('REFUNDED', '2026-11-06')] },
        at('2026-11-07'),
      ).state,
    ).toBe('payment_failed')
    expect(
      subscriptionCoverage(
        { ...base, invoices: [invoice('PAID', '2026-11-06')], disputed: true },
        at('2026-11-07'),
      ).state,
    ).toBe('needs_review')
  })
  it('keeps cancelled subscriptions paid through the period end only', () => {
    const invoices = [invoice('PAID', '2026-11-06')]
    const sub = { status: 'ACTIVE', canceled_date: '2026-12-06' }
    expect(
      subscriptionCoverage(
        { ...base, subscription: sub, invoices },
        at('2026-11-30'),
      ).state,
    ).toBe('cancelled')
    expect(
      subscriptionCoverage(
        { ...base, subscription: sub, invoices },
        at('2026-12-07'),
      ).accessPlan,
    ).toBe(null)
  })
  it('is order-independent: the same invoices in any order give the same result', () => {
    const a = [invoice('PAID', '2026-12-06'), invoice('PAID', '2026-11-06')]
    const now = at('2026-12-10')
    expect(subscriptionCoverage({ ...base, invoices: a }, now)).toEqual(
      subscriptionCoverage({ ...base, invoices: [...a].reverse() }, now),
    )
  })
})

describe('server-side entitlements for Square-billed ovens', () => {
  const now = Date.parse('2026-11-20T00:00:00Z')
  const row = (plan: string, status = 'paid_active') => ({
    plan_id: plan as any,
    status,
    source: 'square_sandbox',
    environment: 'sandbox',
    paid_through: '2026-12-06T00:00:00Z',
  })
  const client = (stored?: any) => ({
    query: vi.fn(async () => ({ rows: stored ? [{ data: stored }] : [] })),
  })
  const resaleSave = {
    action: 'save',
    table: 'products',
    data: { id: 'p1', workflow: 'resale', name: 'Mug', price: 1 },
  }
  it('denies a resale write on a lower plan through the direct API', async () => {
    await expect(
      enforceSquareBilledWrite({
        client: client(),
        org: 'oven-a',
        row: row('mixing-bowl'),
        method: 'POST',
        url: new URL('https://x.test/api/workspace'),
        body: resaleSave,
        now,
      }),
    ).rejects.toThrow(/not included in this oven’s current plan/)
  })
  it('allows it on Cottage Mercantile while paid', async () => {
    await expect(
      enforceSquareBilledWrite({
        client: client(),
        org: 'oven-a',
        row: row('cottage-mercantile'),
        method: 'POST',
        url: new URL('https://x.test/api/workspace'),
        body: resaleSave,
        now,
      }),
    ).resolves.toMatchObject({ plan: 'cottage-mercantile' })
  })
  it('classifies from the stored record so a forged body cannot bypass the gate', async () => {
    const c = client({ id: 'p1', workflow: 'resale' })
    await expect(
      enforceSquareBilledWrite({
        client: c,
        org: 'oven-a',
        row: row('mixing-bowl'),
        method: 'POST',
        url: new URL('https://x.test/api/workspace'),
        body: { ...resaleSave, data: { id: 'p1', name: 'Mug' } },
        now,
      }),
    ).rejects.toThrow()
    // Lookups are always scoped to the requesting oven.
    expect((c.query as any).mock.calls[0][1]).toEqual(['oven-a', 'p1'])
  })
  it('keeps refunds and reversals available after a lapse', async () => {
    const lapsed = row('cottage-mercantile', 'expired')
    expect(squareBilledAccess(lapsed, now).plan).toBe('free')
    await expect(
      enforceSquareBilledWrite({
        client: client(),
        org: 'oven-a',
        row: lapsed,
        method: 'POST',
        url: new URL('https://x.test/api/workspace'),
        body: { action: 'refund', table: 'sales', data: { id: 's' } },
        now,
      }),
    ).resolves.toBeTruthy()
  })
  it('does not give paid access for an unpaid pending checkout', () => {
    expect(
      squareBilledAccess(
        { ...row('cottage-kitchen', 'payment_processing'), paid_through: null },
        now,
      ).plan,
    ).toBe('free')
  })
})
