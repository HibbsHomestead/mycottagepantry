// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({
  context: 'production',
  request: vi.fn(),
  validate: vi.fn(),
  hostedKey: '',
  signing: '',
}))
vi.mock('../../netlify/lib/runtime-environment', () => ({
  deploymentRuntime: () => ({ context: f.context }),
  serverEnvironment: () => f.hostedKey,
}))
vi.mock('../../netlify/lib/stripe-provider', () => ({
  openStripe: () => ({ key: 'fixture', signing: f.signing }),
  sealStripe: () => 'encrypted',
  stripeEndpoint: (e: string) =>
    `https://mycottagepantry.com/api/stripe/${e}/webhook`,
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
  f.hostedKey = ''
  f.signing = ''
})

it.each([true, false])(
  'never authorizes live purchases after hosted setup (charges enabled: %s)',
  async (chargesEnabled) => {
    f.hostedKey = 'fixture'
    f.request.mockImplementation(async (_key: string, path: string) => {
      if (path === '/account')
        return {
          id: 'acct_fixture',
          charges_enabled: chargesEnabled,
          details_submitted: true,
        }
      if (path.startsWith('/prices?'))
        return { data: [{ id: 'price_fixture' }] }
      if (path === '/billing_portal/configurations')
        return { id: 'bpc_fixture', valid: true }
      if (path === '/webhook_endpoints')
        return { id: 'we_fixture', secret: 'whsec_fixture' }
      if (path.startsWith('/products/')) return {}
      throw new Error('Unexpected resource')
    })
    f.validate.mockResolvedValue({ product: { id: 'prod_fixture' } })
    const c = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await setupStripeBilling(
      c,
      {
        ciphertext: 'encrypted',
        validated_at: new Date(),
        account_id: 'acct_fixture',
        configuration: { hostedLaunchReady: true },
      },
      'live',
    )
    expect(c.query.mock.calls[0][1][2].hostedLaunchReady).toBeUndefined()
    expect(c.query.mock.calls[0][1][2].liveCheckoutApprovedAt).toBeUndefined()
    expect(c.query.mock.calls[0][1][2].hostedSetupComplete).toBe(true)
  },
)
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
  const c = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  }
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

it.each([
  {
    url: 'https://mycottagepantry.com/api/stripe/live/webhook',
    livemode: true,
    status: 'enabled',
  },
  {
    url: 'https://mycottagepantry.com/api/stripe/live/webhook',
    livemode: false,
    status: 'enabled',
  },
  {
    url: 'https://mycottagepantry.com/api/stripe/test/webhook',
    livemode: true,
    status: 'enabled',
  },
  {
    url: 'https://mycottagepantry.com/api/stripe/test/webhook',
    livemode: false,
    status: 'disabled',
  },
])(
  'rejects a manual webhook secret without a matching enabled destination: %j',
  async (destination) => {
    f.signing = 'whsec_fixture'
    f.request.mockImplementation(async (_key: string, path: string) => {
      if (path === '/account') return { id: 'acct_fixture' }
      if (path.startsWith('/webhook_endpoints?')) return { data: [destination] }
      throw new Error('Unexpected resource write')
    })
    const c = { query: vi.fn() }
    await expect(
      setupStripeBilling(
        c,
        {
          ciphertext: 'encrypted',
          validated_at: new Date(),
          account_id: 'acct_fixture',
        },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_REQUIRED' })
    expect(c.query).not.toHaveBeenCalled()
    expect(f.request.mock.calls.every((call) => !call[2])).toBe(true)
  },
)

it('finds a manual destination on a later page, retains its secret and explains manual delivery verification', async () => {
  f.signing = 'whsec_fixture'
  f.request.mockImplementation(async (_key: string, path: string) => {
    if (path === '/account') return { id: 'acct_fixture' }
    if (path === '/webhook_endpoints?limit=100')
      return {
        data: [
          {
            id: 'we_other',
            url: 'https://example.invalid',
            livemode: false,
            status: 'enabled',
          },
        ],
        has_more: true,
      }
    if (path === '/webhook_endpoints?limit=100&starting_after=we_other')
      return {
        data: [
          {
            id: 'we_manual',
            url: 'https://mycottagepantry.com/api/stripe/test/webhook',
            livemode: false,
            status: 'enabled',
            enabled_events: ['invoice.paid'],
          },
        ],
        has_more: false,
      }
    if (path.startsWith('/prices?')) return { data: [{ id: 'price_fixture' }] }
    if (path === '/billing_portal/configurations')
      return { id: 'bpc_fixture', valid: true }
    throw new Error('Unexpected resource')
  })
  f.validate.mockResolvedValue({ product: { id: 'prod_fixture' } })
  const c = { query: vi.fn().mockResolvedValue({ rows: [] }) }
  await setupStripeBilling(
    c,
    {
      ciphertext: 'encrypted',
      validated_at: new Date(),
      account_id: 'acct_fixture',
    },
    'test',
  )
  expect(c.query.mock.calls[0][1][2]).toMatchObject({
    webhookEndpoint: 'we_manual',
    webhookDeliveryCheck: 'manual',
  })
  expect(
    f.request.mock.calls.some(([, path]) => path === '/webhook_endpoints'),
  ).toBe(false)
  expect(JSON.stringify(c.query.mock.calls)).not.toContain(f.signing)
})

it('reports missing subscription events before creating resources for a manual destination', async () => {
  f.signing = 'whsec_fixture'
  f.request.mockImplementation(async (_key: string, path: string) => {
    if (path === '/account') return { id: 'acct_fixture' }
    if (path === '/webhook_endpoints/we_manual')
      return {
        id: 'we_manual',
        url: 'https://mycottagepantry.com/api/stripe/test/webhook',
        livemode: false,
        status: 'enabled',
        enabled_events: ['product.updated'],
      }
    throw new Error('Unexpected resource')
  })
  const c = { query: vi.fn() }
  await expect(
    setupStripeBilling(
      c,
      {
        ciphertext: 'encrypted',
        validated_at: new Date(),
        account_id: 'acct_fixture',
        configuration: { webhookEndpoint: 'we_manual' },
      },
      'test',
    ),
  ).rejects.toMatchObject({ code: 'WEBHOOK_EVENTS_REQUIRED' })
  expect(c.query).not.toHaveBeenCalled()
})
