import { it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StorePriceSearch } from './store-price-search'
const ingredient = {
  id: 'flour',
  name: 'Bread flour',
  brand: 'Test Mills',
  barcode: '0012345',
  unit: 'lb',
  storageUnit: 'lb',
  purchaseQuantity: 25,
  purchaseUnit: 'lb',
  packagePrice: 10.95,
  includesTax: false,
  includesShipping: false,
}
afterEach(() => vi.unstubAllGlobals())
it('shows missing setup honestly and does not automatically initiate a paid lookup', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ configured: false, cache: null }),
  )
  vi.stubGlobal('fetch', fetcher)
  render(
    <StorePriceSearch ingredient={ingredient} canEdit onWorkspace={vi.fn()} />,
  )
  await screen.findByText(/Price comparison isn’t configured./)
  await userEvent.click(
    screen.getByRole('button', { name: 'Compare store prices' }),
  )
  expect(screen.getByRole('button', { name: 'Find prices' })).toBeDisabled()
  expect(screen.getByLabelText('Product search')).toHaveValue('Test Mills Bread flour 25 lb 0012345')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('runs only explicit searches and shows real-response fields with conditional and unknown-size warnings', async () => {
  const user = userEvent.setup(),
    checkedAt = new Date().toISOString(),
    offer = {
      id: 'offer',
      title: 'Test Mills Bread flour',
      retailer: 'Fixture store',
      url: 'https://retailer.example/flour',
      direct: true,
      price: 4,
      currency: 'USD',
      packageQuantity: null,
      purchaseUnit: null,
      rank: 3,
      match: 'Likely match — check details',
      checkedAt,
      conditions: ['Members only'],
      conditional: true,
      shipping: null,
      deliveredTotal: null,
    }
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    Response.json(
      options?.method === 'POST'
        ? {
            configured: true,
            cached: false,
            cache: {
              checkedAt,
              offers: [offer],
              request: { query: 'Corrected query', zip: '90210' },
            },
          }
        : { configured: true, cache: null },
    ),
  )
  vi.stubGlobal('fetch', fetcher)
  render(
    <StorePriceSearch ingredient={ingredient} canEdit onWorkspace={vi.fn()} />,
  )
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  await user.click(screen.getByRole('button', { name: 'Compare store prices' }))
  await user.clear(screen.getByLabelText('Product search'))
  await user.type(screen.getByLabelText('Product search'), 'Corrected query')
  await user.type(screen.getByLabelText('ZIP code (optional)'), '90210')
  expect(fetcher).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Find prices' }))
  await screen.findByText('Fixture store')
  expect(screen.getByText(/Package size needs checking/)).toBeInTheDocument()
  expect(screen.getByText('Members only')).toBeInTheDocument()
  expect(screen.getByText('Stock: Not provided')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View at store' })).toHaveAttribute(
    'href',
    offer.url,
  )
  expect(screen.getByRole('button', { name: 'Save offer' })).toBeDisabled()
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toMatchObject({
    query: 'Corrected query',
    zip: '90210',
    operation: 'search',
  })
  expect(ingredient.name).toBe('Bread flour')
})
it('handles a non-JSON response without exposing parser errors', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response('<html>Login required</html>', {
        status: 401,
        headers: { 'content-type': 'text/html' },
      }),
  )
  render(
    <StorePriceSearch ingredient={ingredient} canEdit onWorkspace={vi.fn()} />,
  )
  await screen.findByRole('alert')
  expect(screen.getByRole('alert')).not.toHaveTextContent('JSON.parse')
  expect(ingredient.name).toBe('Bread flour')
})
it('requires offer review before any save request', async () => {
  const checkedAt = new Date().toISOString(),
    offer = {
      id: 'real-result',
      title: 'Test Mills Bread flour 25 lb',
      retailer: 'Fixture store',
      url: 'https://store.example/flour',
      direct: true,
      price: 10,
      currency: 'USD',
      packageQuantity: 25,
      purchaseUnit: 'lb',
      multipack: 1,
      rank: 1,
      match: 'Brand/product/package match',
      checkedAt,
      conditions: [],
      conditional: false,
      shipping: null,
      deliveredTotal: null,
    }
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    Response.json(
      options?.method === 'POST'
        ? { saved: true }
        : {
            configured: true,
            cache: {
              offers: [offer],
              request: { query: 'Bread flour', preference: 'both' },
              checkedAt,
            },
          },
    ),
  )
  vi.stubGlobal('fetch', fetcher)
  render(
    <StorePriceSearch ingredient={ingredient} canEdit onWorkspace={vi.fn()} />,
  )
  await screen.findByText('Fixture store')
  await userEvent.click(
    screen.getByRole('button', { name: 'Save offer' }),
  )
  expect(
    screen.getByRole('region', { name: 'Review store offer' }),
  ).toBeVisible()
  expect(fetcher).toHaveBeenCalledTimes(1)
  await userEvent.click(
    screen.getByRole('button', { name: 'Cancel' }),
  )
  expect(fetcher).toHaveBeenCalledTimes(1)
})
