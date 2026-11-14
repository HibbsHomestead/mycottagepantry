// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({
  context: 'production',
  request: vi.fn(),
  validate: vi.fn(),
}))
vi.mock('../../netlify/lib/runtime-environment', () => ({
  deploymentRuntime: () => ({ context: f.context }),
}))
vi.mock('../../netlify/lib/stripe-provider', () => ({
  openStripe: () => ({ key: 'fixture', signing: '' }),
  sealStripe: () => 'encrypted',
  stripeEndpoint: () => 'https://mycottagepantry.com/api/stripe/live/webhook',
  stripeRequest: f.request,
  validatedPrice: f.validate,
  stripeEventsRequired: ['invoice.paid'],
  stripePortalMatchesPolicy: (p: { valid: boolean }) => p.valid,
  stripeTierPurchasable: (id: string) => id !== 'cottage-mercantile',
}))
import { setupStripeBilling } from '../../netlify/lib/stripe-setup'
afterEach(() => {
  vi.clearAllMocks()
  f.context = 'production'
})
it('blocks live resource writes on previews and refuses changed accounts', async () => {
  const c = { query: vi.fn(), release: vi.fn() }
  const row = {
    ciphertext: 'encrypted',
    validated_at: new Date(),
    account_id: 'acct_fixture',
  }
  f.context = 'deploy-preview'
  await expect(setupStripeBilling(c, row, 'live')).rejects.toMatchObject({
    code: 'DEPLOYMENT_REQUIRED',
  })
  expect(f.request).not.toHaveBeenCalled()
  f.context = 'production'
  f.request.mockResolvedValueOnce({ id: 'acct_other' })
  await expect(setupStripeBilling(c, row, 'live')).rejects.toMatchObject({
    code: 'ACCOUNT_CHANGED',
  })
  expect(c.query).not.toHaveBeenCalled()
})
it('reuses prices, stores webhook secret encrypted, and leaves activation and signed-delivery evidence to their real handlers', async () => {
  const c = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
  f.request.mockImplementation(async (_key: string, path: string) => {
    if (path === '/account') return { id: 'acct_fixture' }
    if (path.startsWith('/prices?')) return { data: [{ id: 'price_fixture' }] }
    if (path === '/billing_portal/configurations')
      return { id: 'bpc_fixture', valid: true }
    if (path === '/webhook_endpoints')
      return { id: 'we_fixture', secret: 'whsec_fixture' }
    if (path.startsWith('/products/')) return {}
    throw new Error('Unexpected resource')
  })
  f.validate.mockResolvedValue({ product: { id: 'prod_fixture' } })
  await setupStripeBilling(
    c,
    {
      ciphertext: 'encrypted',
      validated_at: new Date(),
      account_id: 'acct_fixture',
    },
    'live',
  )
  expect(
    f.request.mock.calls.filter(
      ([, p]) => p === '/products' || p === '/prices',
    ),
  ).toHaveLength(0)
  expect(c.query).toHaveBeenCalledTimes(1)
  const [sql, params] = c.query.mock.calls[0]
  expect(sql).not.toMatch(/checkout_enabled|webhook_verified_at/)
  expect(params[1]).toBe('encrypted')
  expect(JSON.stringify(params)).not.toContain('whsec_fixture')
  expect(params[2].mappings['cottage-mercantile'].purchase).toBe(false)
  expect(
    f.request.mock.calls.some(([, p]) =>
      /customer|subscription|checkout/.test(p),
    ),
  ).toBe(false)
})
