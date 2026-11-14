// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  dispatchStripeTestReconciliation,
  reconcileStripeTestBatch,
  verifyStripeDispatch,
} from '../../netlify/lib/stripe-reconciliation'
import {
  processStripeEvent,
  reconcileStripeCheckout,
} from '../../netlify/lib/stripe-subscriptions'
import { squareBilledAccess } from '../../netlify/lib/billing-entitlements'
import { stripePriceIssue } from '../../netlify/lib/stripe-provider'
import { launchPricing } from './launch-plans'

vi.mock('../../netlify/lib/stripe-subscriptions', () => ({
  processStripeEvent: vi.fn(),
  reconcileStripeCheckout: vi.fn(),
}))
const root = randomBytes(32).toString('hex')
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('Netlify', {
    env: {
      get: (name: string) =>
        name === 'STRIPE_BILLING_ENCRYPTION_KEY'
          ? root
          : name === 'CONTEXT'
            ? 'production'
            : '',
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

it('authenticates background dispatch with origin and time binding', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 202 }))
  expect((await dispatchStripeTestReconciliation(fetcher)).status).toBe(204)
  const [url, options] = (
    fetcher.mock.calls as unknown as [string, RequestInit][]
  )[0]
  const request = new Request(url, options)
  const { timestamp } = JSON.parse(String(options.body))
  expect(verifyStripeDispatch(request, timestamp)).toBe(true)
  expect(
    verifyStripeDispatch(
      new Request('https://foreign.invalid', options),
      timestamp,
    ),
  ).toBe(false)
  expect(
    verifyStripeDispatch(request, String(Number(timestamp) - 121000)),
  ).toBe(false)
  expect(verifyStripeDispatch(new Request(url), timestamp)).toBe(false)
  expect(options.redirect).toBe('error')
})
it('never dispatches scheduled recovery from previews or without encryption', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('Netlify', { env: { get: () => '' } })
  await dispatchStripeTestReconciliation(fetcher)
  vi.stubGlobal('Netlify', {
    env: {
      get: (name: string) =>
        name === 'STRIPE_BILLING_ENCRYPTION_KEY' ? root : 'deploy-preview',
    },
  })
  await dispatchStripeTestReconciliation(fetcher)
  expect(fetcher).not.toHaveBeenCalled()
})
it('recovers missed events and subscriptions, isolates failures, and selects test records only', async () => {
  const events = [{ id: 'evt_failed' }, { id: 'evt_good' }]
  const attempts = [{ id: 'bad' }, { id: 'good' }]
  const c = {
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT * FROM stripe_provider_settings'))
        return {
          rows: [{ ciphertext: 'encrypted', validated_at: '2026-11-14' }],
        }
      if (sql.startsWith('SELECT * FROM stripe_events')) return { rows: events }
      if (sql.startsWith('SELECT * FROM stripe_checkouts'))
        return { rows: attempts }
      return { rows: [] }
    }),
  }
  vi.mocked(processStripeEvent)
    .mockRejectedValueOnce(new Error('provider unavailable'))
    .mockResolvedValueOnce(undefined)
  vi.mocked(reconcileStripeCheckout)
    .mockRejectedValueOnce(new Error('provider unavailable'))
    .mockResolvedValueOnce(undefined)
  expect(await reconcileStripeTestBatch(c)).toEqual({
    processed: 2,
    failed: 2,
  })
  expect(processStripeEvent).toHaveBeenCalledTimes(2)
  expect(reconcileStripeCheckout).toHaveBeenCalledTimes(2)
  const statements = c.query.mock.calls.map(([sql]) => sql)
  expect(
    statements
      .filter(
        (sql) =>
          sql.startsWith('SELECT * FROM stripe_') &&
          !sql.includes('provider_settings'),
      )
      .every(
        (sql) =>
          sql.includes("environment='test'") &&
          sql.includes('LIMIT 5') &&
          sql.includes('SKIP LOCKED'),
      ),
  ).toBe(true)
  expect(statements).toContain('ROLLBACK TO SAVEPOINT stripe_retry')
  expect(statements).toContain('ROLLBACK TO SAVEPOINT stripe_sweep')
  expect(
    statements.some((sql) => sql.includes('UPDATE workspace_billing')),
  ).toBe(false)
})
it('skips provider calls while test credentials are unconfigured', async () => {
  const c = { release: vi.fn(), query: vi.fn(async () => ({ rows: [] })) }
  expect(await reconcileStripeTestBatch(c)).toEqual({
    processed: 0,
    failed: 0,
  })
  expect(processStripeEvent).not.toHaveBeenCalled()
  expect(reconcileStripeCheckout).not.toHaveBeenCalled()
})
it.each(launchPricing.plans.filter((p) => p.monthlyUsd > 0))(
  'preserves approved monthly USD price for $id',
  (tier) => {
    expect(
      stripePriceIssue(
        {
          livemode: false,
          active: true,
          type: 'recurring',
          currency: 'usd',
          unit_amount: tier.monthlyUsd * 100,
          billing_scheme: 'per_unit',
          recurring: {
            interval: 'month',
            interval_count: 1,
            usage_type: 'licensed',
          },
          product: { active: true, metadata: { cottage_pantry_tier: tier.id } },
        },
        tier.id,
        'test',
      ),
    ).toBeNull()
  },
)
it('expires Stripe paid access at coverage end without Square sandbox grace', () => {
  const through = Date.parse('2026-12-01T00:00:00Z')
  const row = {
    plan_id: 'cottage-kitchen' as const,
    status: 'past_due',
    source: 'stripe_test',
    environment: 'test',
    paid_through: new Date(through).toISOString(),
    entitlement_policy: 'kitchen-two-v1' as const,
  }
  expect(squareBilledAccess(row, through - 1).plan).toBe('cottage-kitchen')
  expect(squareBilledAccess(row, through).plan).toBe('free')
  expect(
    squareBilledAccess({ ...row, status: 'cancelled' }, through - 1).plan,
  ).toBe('cottage-kitchen')
  expect(
    squareBilledAccess({ ...row, status: 'cancelled' }, through).plan,
  ).toBe('free')
})
