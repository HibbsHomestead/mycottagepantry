import type { Item } from '@/lib/domain'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  CategoryTaxSettings,
  ProductCategorySelector,
  ProductCategoryManager,
} from './product-categories'
const category = { id: 'bread', name: 'Bread', classification: 'food' }
const configured = () => ({
  categories: [
    category,
    { id: 'old', name: 'Unclassified', classification: null },
  ],
  mappings: { food: ['state'], non_food: [] },
  rates: [
    {
      id: 'state',
      name: 'State treatment',
      jurisdiction: 'Test',
      ratePercent: 5,
      behavior: 'exclusive',
    },
  ],
  revision: 1,
  products: [{ id: 'p', name: 'Loaf', productCategoryId: 'bread' }],
})
afterEach(() => vi.unstubAllGlobals())
function Harness({
  initial = {
    id: 'p',
    name: 'Unsaved loaf',
    price: 19,
    productCategoryId: 'bread',
    taxSource: 'category',
  } as Item,
}) {
  const [product, setProduct] = useState(initial)
  const [business, setBusiness] = useState({
    id: 'business',
    name: 'Test',
    productCategories: [category],
    taxRates: configured().rates,
    categoryTaxMappings: configured().mappings,
  })
  return (
    <>
      <label>
        Product name
        <input
          value={product.name}
          onChange={(e) => setProduct({ ...product, name: e.target.value })}
        />
      </label>
      <ProductCategorySelector
        product={product}
        business={business}
        canManage
        onChange={(key, value) =>
          setProduct((old: Item) => ({ ...old, [key]: value }))
        }
        onConfig={(patch) => setBusiness((old) => ({ ...old, ...patch }))}
        openTaxSettings={vi.fn()}
      />
      <output aria-label="Draft">{JSON.stringify(product)}</output>
    </>
  )
}
it('keeps the saved selection visible during search and selects a newly created category without discarding other edits', async () => {
  const data = configured()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) => {
      if (options?.method === 'POST') {
        const input = JSON.parse(options.body)
        expect(input.category).toMatchObject({
          name: 'Gift boxes',
          classification: 'non_food',
        })
        return Response.json({
          ...data,
          categories: [
            ...data.categories,
            { id: 'gifts', name: 'Gift boxes', classification: 'non_food' },
          ],
          selectedId: 'gifts',
          revision: 2,
        })
      }
      return Response.json(data)
    }),
  )
  render(<Harness />)
  const combo = screen.getByRole('combobox', { name: 'Product category' })
  await waitFor(() => expect(combo).toBeEnabled())
  expect(combo).toHaveValue('Bread · Food')
  // One searchable field: typing filters without changing the saved choice.
  await userEvent.click(combo)
  await userEvent.type(combo, 'xyz')
  expect(screen.queryByRole('option', { name: 'Bread · Food' })).toBeNull()
  expect(screen.getByLabelText('Draft')).toHaveTextContent(
    '"productCategoryId":"bread"',
  )
  await userEvent.clear(combo)
  await userEvent.type(combo, 'Gift boxes')
  await userEvent.click(
    screen.getByRole('option', { name: 'Add “Gift boxes” as a category' }),
  )
  expect(screen.getByLabelText('Category name')).toHaveValue('Gift boxes')
  await userEvent.clear(screen.getByLabelText('Product name'))
  await userEvent.type(screen.getByLabelText('Product name'), 'Edited loaf')
  await userEvent.selectOptions(
    screen.getByLabelText('Classification', { exact: true }),
    'non_food',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save category' }))
  await waitFor(() =>
    expect(screen.getByLabelText('Draft')).toHaveTextContent(
      '"productCategoryId":"gifts"',
    ),
  )
  expect(combo).toHaveValue('Gift boxes · Non-food')
  expect(screen.getByLabelText('Product name')).toHaveValue('Edited loaf')
  expect(screen.getByLabelText('Draft')).toHaveTextContent('"price":19')
  // Concise line is visible; the detailed explanation stays under Tax details.
  expect(
    screen.getByText('Tax treatment not configured', { selector: 'span' }),
  ).toBeVisible()
})
it('retains the selected ID and draft after retryable loading or save failures, with no false empty list', async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(Response.json(configured()))
    .mockResolvedValueOnce(
      Response.json({ error: 'Duplicate category' }, { status: 400 }),
    )
  vi.stubGlobal('fetch', fetcher)
  render(<Harness />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
  expect(screen.queryByText(/No product categories configured/)).toBeNull()
  await userEvent.click(
    screen.getByRole('button', { name: 'Retry category list' }),
  )
  await waitFor(() =>
    expect(
      screen.getByRole('combobox', { name: 'Product category' }),
    ).toHaveValue('Bread · Food'),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Add category' }))
  await userEvent.type(screen.getByLabelText('Category name'), 'Bread')
  await userEvent.selectOptions(
    screen.getByLabelText('Classification', { exact: true }),
    'food',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save category' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Duplicate category',
  )
  expect(screen.getByLabelText('Category name')).toHaveValue('Bread')
  expect(
    screen.getByRole('combobox', { name: 'Product category' }),
  ).toHaveValue('Bread · Food')
  expect(screen.getByLabelText('Draft')).toHaveTextContent(
    '"productCategoryId":"bread"',
  )
})
it('requires confirmation before a classification edit affects linked products and preserves legacy tax display', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(configured())),
  )
  render(
    <Harness
      initial={{
        id: 'p',
        name: 'Old product',
        productCategoryId: 'bread',
        taxStatus: 'exempt',
      }}
    />,
  )
  await waitFor(() =>
    expect(
      screen.getByRole('combobox', { name: 'Product category' }),
    ).toHaveValue('Bread · Food'),
  )
  // Concise summary in the editing path; full explanation under Tax details.
  expect(screen.getByText(/Saved tax kept: Tax exempt/)).toBeVisible()
  await userEvent.click(screen.getByText('Tax details'))
  expect(
    screen.getByText(/Existing assignment preserved: Tax exempt/),
  ).toBeVisible()
  expect(screen.getByText(/Tax conflict:/)).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: 'Manage categories' }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Edit Bread' }))
  await userEvent.selectOptions(
    screen.getByLabelText('Classification', { exact: true }),
    'non_food',
  )
  expect(screen.getByRole('button', { name: 'Save category' })).toBeDisabled()
  await userEvent.click(
    screen.getByRole('checkbox', {
      name: /Confirm classification change for 1 linked products/,
    }),
  )
  expect(screen.getByRole('button', { name: 'Save category' })).toBeEnabled()
})
it('shows configured treatment dropdowns and confirms mapping changes using the linked product count', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(configured())),
  )
  render(
    <CategoryTaxSettings
      business={{ id: 'business', name: 'Test' }}
      products={[]}
      canManage
      onConfig={vi.fn()}
    />,
  )
  await screen.findByRole('option', { name: /State treatment/ })
  await userEvent.click(
    screen.getByRole('button', { name: 'Remove State treatment' }),
  )
  expect(
    screen.getByRole('button', { name: 'Save category tax mappings' }),
  ).toBeDisabled()
  await userEvent.click(
    screen.getByRole('checkbox', {
      name: /Confirm mapping changes for 1 linked products/,
    }),
  )
  expect(
    screen.getByRole('button', { name: 'Save category tax mappings' }),
  ).toBeEnabled()
  expect(screen.getAllByText('Not configured — not tax exempt.')).toHaveLength(
    2,
  )
})
it('explicitly displays an unavailable saved category instead of replacing it', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(configured())),
  )
  render(
    <Harness
      initial={{
        id: 'p',
        name: 'Legacy product',
        productCategoryId: 'missing',
        taxSource: 'category',
      }}
    />,
  )
  const combo = screen.getByRole('combobox', { name: 'Product category' })
  await waitFor(() => expect(combo).toBeEnabled())
  expect(combo).toHaveValue('Saved category unavailable')
  expect(screen.getByLabelText('Draft')).toHaveTextContent(
    '"productCategoryId":"missing"',
  )
  await userEvent.click(combo)
  expect(
    screen.getByRole('option', { name: 'Saved category unavailable' }),
  ).toHaveAttribute('aria-selected', 'true')
})

it('shows the real category list first, searches records and names products affected by classification changes', async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      expect(JSON.parse(String(init.body))).toMatchObject({
        operation: 'saveCategory',
        category: { id: 'bread', name: 'Loaves', classification: 'non_food' },
        confirmAffected: 1,
        expectedRevision: 1,
      })
      const next = configured()
      next.categories[0] = {
        ...category,
        name: 'Loaves',
        classification: 'non_food',
      }
      return Response.json({ ...next, revision: 2 })
    }
    return Response.json(configured())
  })
  vi.stubGlobal('fetch', fetcher)
  render(<ProductCategoryManager canManage onConfig={vi.fn()} />)
  const bread = (await screen.findByRole('heading', { name: 'Bread' })).closest(
    'li',
  )!
  expect(within(bread).getByText('Food')).toBeVisible()
  expect(within(bread).getByText('1')).toBeVisible()
  expect(within(bread).getByText('State treatment · Test · 5%')).toBeVisible()
  expect(
    within(bread).getByRole('button', { name: 'Archive Bread' }),
  ).toBeDisabled()
  const taxSettings = screen
    .getByText('Tax Settings · Food / Non-food mappings')
    .closest('details')!
  expect(taxSettings).not.toHaveAttribute('open')
  await userEvent.type(screen.getByLabelText('Search categories'), 'bread')
  expect(
    screen.queryByRole('heading', { name: 'Unclassified' }),
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Edit Bread' }))
  await userEvent.clear(screen.getByLabelText('Category name'))
  await userEvent.type(screen.getByLabelText('Category name'), 'Loaves')
  await userEvent.selectOptions(
    screen.getByLabelText('Classification', { exact: true }),
    'non_food',
  )
  expect(screen.getByText('Loaf')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Save category' })).toBeDisabled()
  await userEvent.click(
    screen.getByRole('checkbox', { name: /Confirm classification change/ }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save category' }))
  await screen.findByText('Category updated. Product associations preserved.')
  await userEvent.clear(screen.getByLabelText('Search categories'))
  expect(await screen.findByRole('heading', { name: 'Loaves' })).toBeVisible()
  expect(screen.getAllByText('Not configured').length).toBeGreaterThan(0)
})

it('uses honest loading and permission-error states, then offers first-category creation after a successful empty load', async () => {
  let resolve!: (response: Response) => void
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r
        }),
    )
    .mockResolvedValueOnce(
      Response.json({ ...configured(), categories: [], products: [] }),
    )
    .mockImplementationOnce(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({
        operation: 'saveCategory',
        category: { name: 'Bread', classification: 'food' },
      })
      return Response.json({
        ...configured(),
        categories: [category],
        products: [],
        selectedId: 'bread',
        revision: 2,
      })
    })
  vi.stubGlobal('fetch', fetcher)
  render(<ProductCategoryManager canManage onConfig={vi.fn()} />)
  expect(screen.getByRole('status')).toHaveTextContent(
    'Loading product categories',
  )
  expect(screen.queryByText(/0 active categories/)).toBeNull()
  expect(
    screen.queryByRole('button', { name: 'Add Your First Category' }),
  ).toBeNull()
  resolve(Response.json({ error: 'Forbidden' }, { status: 403 }))
  await screen.findByRole('alert')
  expect(screen.queryByText(/0 active categories/)).toBeNull()
  expect(screen.queryByText('No product categories yet')).toBeNull()
  await userEvent.click(
    screen.getByRole('button', { name: 'Retry category list' }),
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Add Your First Category' }),
  )
  expect(screen.getByRole('button', { name: 'Save category' })).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Category name'), 'Bread')
  await userEvent.selectOptions(
    screen.getByLabelText('Classification', { exact: true }),
    'food',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save category' }))
  expect(await screen.findByRole('heading', { name: 'Bread' })).toBeVisible()
})

it('requires archive confirmation, permits restoring archived records, and keeps legacy values visible for review', async () => {
  const data = {
    ...configured(),
    products: [{ id: 'legacy', name: 'Legacy loaf', category: ' Breads ' }],
  }
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const input = JSON.parse(String(init.body))
      expect(input).toMatchObject({
        operation: 'setCategoryActive',
        categoryId: 'bread',
        confirm: true,
      })
      return Response.json({
        ...data,
        categories: [{ ...category, active: input.active }],
        revision: input.active ? 3 : 2,
      })
    }
    return Response.json(data)
  })
  vi.stubGlobal('fetch', fetcher)
  render(<ProductCategoryManager canManage onConfig={vi.fn()} />)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Archive Bread' }),
  )
  expect(fetcher).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('button', { name: 'Confirm archive' }))
  expect(
    await screen.findByRole('button', { name: 'Restore Bread' }),
  ).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: 'Restore Bread' }))
  await userEvent.click(screen.getByRole('button', { name: 'Confirm restore' }))
  expect(
    await screen.findByRole('button', { name: 'Archive Bread' }),
  ).toBeEnabled()
  await userEvent.click(
    screen.getByText(/1 products have legacy category text/),
  )
  expect(screen.getByText(/Breads : 1 products/)).toBeVisible()
})

it('shows categories without management controls to a read-only team member', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(configured())),
  )
  render(<ProductCategoryManager canManage={false} onConfig={vi.fn()} />)
  await screen.findByRole('heading', { name: 'Bread' })
  expect(screen.queryByRole('button', { name: 'Add Category' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Edit Bread' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Archive Bread' })).toBeNull()
})

it('keeps category creation independent of malformed tax settings without replacing saved tax values', async () => {
  const onConfig = vi.fn()
  const data = configured()
  const invalidTax = {
    ...data,
    rates: [{ ...data.rates[0], ratePercent: 'unreadable' }],
  }
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const input = JSON.parse(String(init.body))
      expect(input).toEqual({
        operation: 'saveCategory',
        category: { name: 'Gift boxes', classification: 'non_food' },
        expectedRevision: 1,
      })
      return Response.json({
        ...invalidTax,
        categories: [
          ...data.categories,
          { id: 'gifts', name: 'Gift boxes', classification: 'non_food' },
        ],
        selectedId: 'gifts',
        revision: 2,
      })
    }
    return Response.json(invalidTax)
  })
  vi.stubGlobal('fetch', fetcher)
  render(<ProductCategoryManager canManage onConfig={onConfig} />)
  expect(await screen.findByRole('heading', { name: 'Bread' })).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'fields: rates.0.ratePercent',
  )
  expect(screen.getByRole('alert')).toHaveTextContent('no tax rate is assumed')
  await userEvent.click(
    screen.getByText('Tax Settings · Food / Non-food mappings'),
  )
  expect(screen.getByLabelText('Food configured tax treatment')).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Save category tax mappings' }),
  ).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Add Category' }))
  await userEvent.type(screen.getByLabelText('Category name'), 'Gift boxes')
  await userEvent.selectOptions(
    screen.getByLabelText('Classification'),
    'non_food',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save category' }))
  expect(
    await screen.findByRole('heading', { name: 'Gift boxes' }),
  ).toBeVisible()
  for (const [patch] of onConfig.mock.calls) {
    expect(patch).not.toHaveProperty('taxRates')
    expect(patch).not.toHaveProperty('categoryTaxMappings')
  }
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('retains the loaded list, category form and tax draft through a failed retry, then clears the error on recovery', async () => {
  const data = configured()
  let finishRetry!: (response: Response) => void
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(data))
    .mockResolvedValueOnce(
      Response.json(
        {
          error: 'Category settings changed.',
          code: 'WORKSPACE_REQUEST_FAILED',
        },
        { status: 400 },
      ),
    )
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishRetry = resolve
        }),
    )
    .mockResolvedValueOnce(Response.json(data))
  vi.stubGlobal('fetch', fetcher)
  render(<ProductCategoryManager canManage onConfig={vi.fn()} />)
  await screen.findByRole('heading', { name: 'Bread' })
  await userEvent.click(
    screen.getByText('Tax Settings · Food / Non-food mappings'),
  )
  const tax = screen.getByRole('region', {
    name: 'Category-based tax settings',
  })
  await userEvent.selectOptions(
    within(tax).getByLabelText('Non-food configured tax treatment'),
    'state',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Add Category' }))
  await userEvent.type(
    screen.getByLabelText('Category name'),
    'Unsaved gift boxes',
  )
  await userEvent.selectOptions(
    screen.getByLabelText('Classification'),
    'non_food',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save category' }))
  expect(screen.getAllByRole('alert')[0]).toHaveTextContent('HTTP 400')
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Retry category list' })[0],
  )
  expect(screen.getByLabelText('Category name')).toHaveValue(
    'Unsaved gift boxes',
  )
  expect(
    within(tax).getByRole('heading', { name: 'Non-food' }).parentElement,
  ).toHaveTextContent('State treatment')
  await act(async () =>
    finishRetry(
      Response.json(
        { error: 'Service temporarily unavailable.' },
        { status: 503 },
      ),
    ),
  )
  expect(screen.getAllByRole('alert')[0]).toHaveTextContent('HTTP 503')
  expect(screen.getByRole('heading', { name: 'Bread' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Add Category' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save category' })).toBeDisabled()
  expect(screen.queryByText('No product categories yet')).toBeNull()
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Retry category list' })[0],
  )
  await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0))
  expect(screen.getByRole('button', { name: 'Add Category' })).toBeEnabled()
  expect(screen.getByLabelText('Category name')).toHaveValue(
    'Unsaved gift boxes',
  )
  expect(screen.getByLabelText('Classification')).toHaveValue('non_food')
  expect(
    within(tax).getByRole('heading', { name: 'Non-food' }).parentElement,
  ).toHaveTextContent('State treatment')
  expect(fetcher).toHaveBeenCalledTimes(4)
})

it.each([
  [
    401,
    { error: 'Log in on this site.', code: 'SIGN_IN_REQUIRED' },
    'SIGN_IN_REQUIRED',
  ],
  [
    403,
    { error: 'Verify your account email.', code: 'EMAIL_UNVERIFIED' },
    'EMAIL_UNVERIFIED',
  ],
  [200, { ...configured(), categories: null }, 'fields: categories'],
])(
  'distinguishes HTTP %s and response-shape failures without clearing the product draft',
  async (status, response, detail) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(response, { status }))
        .mockResolvedValueOnce(Response.json(configured())),
    )
    render(<Harness />)
    expect(await screen.findByRole('alert')).toHaveTextContent(detail)
    expect(screen.getByRole('alert')).toHaveTextContent(`HTTP ${status}`)
    expect(screen.getByRole('button', { name: 'Add category' })).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('Product name'))
    await userEvent.type(screen.getByLabelText('Product name'), 'Still unsaved')
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry category list' }),
    )
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByLabelText('Product name')).toHaveValue('Still unsaved')
    expect(screen.getByLabelText('Draft')).toHaveTextContent(
      '"productCategoryId":"bread"',
    )
    expect(screen.getByRole('button', { name: 'Add category' })).toBeEnabled()
  },
)

it('recovers tax controls after a tax-only retry without assuming or saving a replacement rate', async () => {
  const onConfig = vi.fn()
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ...configured(), rates: null }))
    .mockResolvedValueOnce(Response.json(configured()))
  vi.stubGlobal('fetch', fetcher)
  render(
    <CategoryTaxSettings
      business={{ id: 'business', name: 'Test' }}
      products={[]}
      canManage
      onConfig={onConfig}
    />,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('fields: rates')
  const select = screen.getByLabelText('Food configured tax treatment')
  expect(select).toBeDisabled()
  expect(screen.queryByText(/No tax treatments configured/)).toBeNull()
  expect(onConfig.mock.calls[0][0]).not.toHaveProperty('taxRates')
  expect(onConfig.mock.calls[0][0]).not.toHaveProperty('categoryTaxMappings')
  await userEvent.click(
    screen.getByRole('button', { name: 'Retry category list' }),
  )
  await waitFor(() => expect(select).toBeEnabled())
  expect(screen.queryByRole('alert')).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Remove State treatment' }),
  ).toBeEnabled()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(onConfig.mock.calls[1][0]).toMatchObject({
    taxRates: configured().rates,
    categoryTaxMappings: configured().mappings,
  })
})

it.each([
  [
    () =>
      new Response('<html>Sign in</html>', {
        status: 401,
        headers: { 'Content-Type': 'text/html' },
      }),
    'Site access or sign-in is required',
    'HTTP 401',
  ],
  [
    () =>
      new Response('<html>Not found</html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      }),
    'non-JSON response',
    'HTTP 404',
  ],
  [
    () =>
      new Response('{invalid', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    'invalid JSON',
    'HTTP 200',
  ],
])(
  'keeps the draft available after a transport/format failure (%s)',
  async (response, detail, status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(Response.json(configured())),
    )
    render(<Harness />)
    expect(await screen.findByRole('alert')).toHaveTextContent(detail)
    expect(screen.getByRole('alert')).toHaveTextContent(status)
    expect(screen.getByLabelText('Product name')).toBeEnabled()
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry category list' }),
    )
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByLabelText('Draft')).toHaveTextContent(
      '"productCategoryId":"bread"',
    )
  },
)
