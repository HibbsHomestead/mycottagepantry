// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { reconcileStripeCheckout } from '../../netlify/lib/stripe-subscriptions'
import { sealStripe } from '../../netlify/lib/stripe-provider'
const key = 'sk_test_' + randomBytes(20).toString('hex'),
  root = randomBytes(32).toString('hex')
const attempt = {
  id: 'attempt_fixture',
  business_id: 'business_fixture',
  environment: 'test',
  session_id: 'cs_fixture',
  price_id: 'price_fixture',
  plan_id: 'cottage-kitchen',
  identity_id: 'owner',
}
const now = Math.floor(Date.now() / 1000)
beforeEach(() => vi.stubGlobal('Netlify', { env: { get: () => root } }))
afterEach(() => vi.unstubAllGlobals())
function fixture(
  options: {
    paid?: boolean
    customer?: string
    fail?: boolean
    status?: string
    existing?: Record<string, unknown>
  } = {},
) {
  const writes: { sql: string; params: unknown[] }[] = []
  const c = {
    release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('SELECT * FROM stripe_provider_settings'))
        return {
          rows: [
            { ciphertext: sealStripe({ key, signing: 'fixture' }, 'test') },
          ],
        }
      if (sql.startsWith('SELECT * FROM workspace_billing'))
        return { rows: options.existing ? [options.existing] : [] }
      if (sql.startsWith('INSERT') || sql.startsWith('UPDATE'))
        writes.push({ sql, params })
      return { rows: [] }
    }),
  }
  const fetcher = vi.fn(async (url: string, transportOptions?: RequestInit) => {
    if (transportOptions?.method && transportOptions.method !== 'GET')
      throw new Error('Reconciliation must only read provider state')
    if (options.fail) return new Response('{}', { status: 503 })
    let value: unknown
    if (url.endsWith('/checkout/sessions/cs_fixture'))
      value = {
        id: 'cs_fixture',
        livemode: false,
        mode: 'subscription',
        status: 'complete',
        subscription: 'sub_fixture',
        customer: 'cus_fixture',
        client_reference_id: attempt.id,
        metadata: { attempt_id: attempt.id },
      }
    else if (url.endsWith('/subscriptions/sub_fixture'))
      value = {
        id: 'sub_fixture',
        livemode: false,
        metadata: { attempt_id: attempt.id },
        customer: options.customer || 'cus_fixture',
        status: options.status || 'active',
        items: {
          data: [
            {
              price: { id: 'price_fixture' },
              quantity: 1,
              current_period_end: now + 86400,
            },
          ],
        },
      }
    else if (url.includes('/invoices?'))
      value = {
        data: options.paid
          ? [
              {
                id: 'in_fixture',
                status: 'paid',
                amount_paid: 3000,
                currency: 'usd',
                customer: 'cus_fixture',
              },
            ]
          : [
              {
                id: 'in_fixture',
                status: 'open',
                amount_paid: 0,
                currency: 'usd',
                customer: 'cus_fixture',
              },
            ],
      }
    else if (url.endsWith('/invoices/in_fixture/lines?limit=100'))
      value = {
        data: [
          {
            amount: 3000,
            pricing: { price_details: { price: 'price_fixture' } },
            period: { start: now - 100, end: now + 86400 },
          },
        ],
        has_more: false,
      }
    else throw new Error('Unexpected request in fixture')
    return Response.json(value)
  })
  vi.stubGlobal('fetch', fetcher)
  return { c, writes, fetcher }
}
it('uses current invoice line pricing and paid status before granting a paid period', async () => {
  const { c, writes } = fixture({ paid: true })
  await reconcileStripeCheckout(c, attempt)
  const billing = writes.find((w) =>
    w.sql.startsWith('INSERT INTO workspace_billing'),
  )!
  expect(billing.params[3]).toBe('paid_active')
  expect(billing.params[2]).toBe('stripe_test')
  expect(billing.params[11]).toBe(now + 86400)
})
it('does not turn subscription creation or an open invoice into paid access', async () => {
  const { c, writes } = fixture()
  await reconcileStripeCheckout(c, attempt)
  const billing = writes.find((w) =>
    w.sql.startsWith('INSERT INTO workspace_billing'),
  )!
  expect(billing.params[3]).toBe('payment_processing')
  expect(billing.params[11]).toBe(0)
})
it('rejects a forged/cross-business provider relationship before access writes', async () => {
  const { c, writes } = fixture({ paid: true, customer: 'cus_foreign' })
  await expect(reconcileStripeCheckout(c, attempt)).rejects.toThrow(
    'relationship needs review',
  )
  expect(writes).toHaveLength(0)
})
it('retains paid coverage on temporary provider failure without writing an empty state', async () => {
  const { c, writes } = fixture({
    fail: true,
    existing: {
      status: 'paid_active',
      subscription_id: 'sub_fixture',
      paid_through: new Date((now + 86400) * 1000).toISOString(),
    },
  })
  await expect(reconcileStripeCheckout(c, attempt)).rejects.toThrow(
    'Stripe rejected',
  )
  expect(writes).toHaveLength(0)
})
it('re-fetches current state on repeated/out-of-order processing and preserves later verified coverage', async () => {
  const { c, writes, fetcher } = fixture({
    paid: true,
    existing: {
      status: 'paid_active',
      subscription_id: 'sub_fixture',
      paid_from: new Date((now - 100) * 1000).toISOString(),
      paid_through: new Date((now + 172800) * 1000).toISOString(),
    },
  })
  await reconcileStripeCheckout(c, attempt)
  await reconcileStripeCheckout(c, attempt)
  expect(
    writes
      .filter((w) => w.sql.startsWith('INSERT INTO workspace_billing'))
      .every((w) => w.params[11] === now + 172800),
  ).toBe(true)
  expect(
    fetcher.mock.calls.filter(([url]) =>
      url.endsWith('/subscriptions/sub_fixture'),
    ),
  ).toHaveLength(2)
  expect(
    fetcher.mock.calls.every(
      ([, options]) =>
        !options || (options as { method?: string }).method === 'GET',
    ),
  ).toBe(true)
})
it('preserves security suspension while recording authoritative billing', async () => {
  const { c, writes } = fixture({
    paid: true,
    existing: { status: 'security_suspended', subscription_id: 'sub_fixture' },
  })
  await reconcileStripeCheckout(c, attempt)
  expect(
    writes.find((w) => w.sql.startsWith('INSERT INTO workspace_billing'))!
      .params[3],
  ).toBe('security_suspended')
  expect(
    writes.find((w) => w.sql.startsWith('UPDATE stripe_checkouts'))!.params[4],
  ).toBe(false)
})
