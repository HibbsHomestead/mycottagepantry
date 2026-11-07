import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductLinkImport } from './product-link-import'
import { walmartVerificationMessage } from '@/lib/product-import-response'
afterEach(() => vi.unstubAllGlobals())
const p = {
  fields: {
    name: 'New flour',
    packagePrice: 10.95,
    subingredients: 'Wheat flour',
  },
  title: 'Bread flour 25 lb',
  imageUrl: 'https://example.org/flour.jpg',
  sourceUrl: 'https://example.org/flour',
  checkedAt: '2026-10-30T12:00:00Z',
  warnings: [],
  conditions: [],
}
async function open(apply = vi.fn()) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ products: [p] })),
  )
  render(
    <ProductLinkImport
      existing
      draft={{ name: 'Saved flour', packagePrice: 20 }}
      apply={apply}
      onWorkspace={vi.fn()}
    />,
  )
  await userEvent.type(
    screen.getByLabelText('Product URL'),
    'https://example.org/flour',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Import details' }))
  await screen.findByText('Bread flour 25 lb')
  await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
  return apply
}
it('applies only selected fields to the draft, keeps missing fields and requires cost-reference approval', async () => {
  const apply = await open()
  expect(apply).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Name' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Package price' }))
  expect(
    screen.getByRole('button', { name: 'Apply selected values' }),
  ).toBeDisabled()
  await userEvent.click(screen.getByLabelText(/I approve changing/))
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply selected values' }),
  )
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'New flour', listedOnlinePrice: 10.95 }),
  )
  expect(apply.mock.calls[0][0]).not.toHaveProperty('subingredients')
  expect(apply.mock.calls[0][0]).not.toHaveProperty('barcode')
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('cancels without altering saved or draft values', async () => {
  const apply = await open()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(apply).not.toHaveBeenCalled()
})
it('keeps text usable and clears reviewed status when photo import fails', async () => {
  const apply = await open()
  await userEvent.click(
    screen.getByRole('checkbox', {
      name: 'Source ingredient statement',
    }),
  )
  await userEvent.click(screen.getByLabelText(/Import product photo/))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'Unavailable' }, { status: 403 })),
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply selected values' }),
  )
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({ subingredients: 'Wheat flour', reviewed: false }),
  )
  expect(apply.mock.calls[0][0]).not.toHaveProperty('imageAssetId')
  expect(await screen.findByRole('alert')).toHaveTextContent(/Photo could not/)
})
it.each([
  [
    401,
    'text/html',
    '<!doctype html><title>Login Redirect</title>',
    'Site access or sign-in is required',
  ],
  [
    200,
    'text/html',
    '<!doctype html><title>Cottage Pantry</title>',
    'API returned a webpage',
  ],
  [502, 'text/plain', 'Upstream unavailable', 'non-JSON response'],
  [200, 'application/json', '', 'invalid or empty JSON'],
])(
  'handles HTTP %s %s without a parsing exception or draft loss',
  async (status, mime, body, message) => {
    const apply = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, { status, headers: { 'Content-Type': mime } }),
      ),
    )
    render(
      <ProductLinkImport
        draft={{ name: 'My saved draft' }}
        apply={apply}
        onWorkspace={vi.fn()}
      />,
    )
    await userEvent.type(
      screen.getByLabelText('Product URL'),
      'https://example.org/product/12345',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Import details' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      /JSON.parse|unexpected character/,
    )
    expect(screen.getByRole('button', { name: 'Import details' })).toBeEnabled()
    expect(apply).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your entries are still in this form. Keep this page open to continue manually.',
    )
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      /draft is preserved/,
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  },
)
it('validates an incomplete link without requesting and preserves long complete product URLs', async () => {
  const fetcher = vi.fn(async (_url: string, _options?: RequestInit) =>
    Response.json({ products: [p] }),
  )
  vi.stubGlobal('fetch', fetcher)
  render(<ProductLinkImport draft={{}} apply={vi.fn()} onWorkspace={vi.fn()} />)
  const input = screen.getByLabelText('Product URL')
  await userEvent.type(input, 'samsclub')
  await userEvent.click(screen.getByRole('button', { name: 'Import details' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /complete product URL/,
  )
  expect(fetcher).not.toHaveBeenCalled()
  const long =
    'https://www.samsclub.com/ip/flour/13909715756?tracking=' + 'x'.repeat(2500)
  await userEvent.clear(input)
  fireEvent.change(input, { target: { value: long } })
  await userEvent.click(screen.getByRole('button', { name: 'Import details' }))
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).url).toBe(long)
})
it('edits a selected suggestion without applying other fields, and makes the unsaved state explicit', async () => {
  const apply = await open()
  await userEvent.click(screen.getByText('Edit name', { selector: 'summary' }))
  await userEvent.clear(screen.getByLabelText('Imported name'))
  await userEvent.type(
    screen.getByLabelText('Imported name'),
    'Corrected flour',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Name' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply selected values' }),
  )
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Corrected flour' }),
  )
  expect(apply.mock.calls[0][0]).not.toHaveProperty('packagePrice')
  expect(screen.getByRole('status')).toHaveTextContent(
    'ingredient not saved yet',
  )
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('shows missing price and image without inventing either', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        products: [{ ...p, imageUrl: '', fields: { name: 'Flour' } }],
      }),
    ),
  )
  const apply = vi.fn()
  render(<ProductLinkImport draft={{}} apply={apply} onWorkspace={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Product URL'), {
    target: { value: p.sourceUrl },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Import details' }))
  expect(
    await screen.findByText(/Price unavailable—enter manually/),
  ).toBeVisible()
  expect(screen.getByText('No source image')).toBeVisible()
  expect(
    screen.queryByRole('checkbox', { name: /Import product photo/ }),
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Name' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply selected values' }),
  )
  expect(apply.mock.calls[0][0]).not.toHaveProperty('packagePrice')
  expect(apply.mock.calls[0][0]).not.toHaveProperty('imageAssetId')
})
it('attaches a copied asset only when photo permission is explicitly selected', async () => {
  const apply = await open()
  await userEvent.click(
    screen.getByRole('checkbox', { name: /Import product photo/ }),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ asset: { id: 'permitted-photo' }, workspace: {} }),
    ),
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply selected values' }),
  )
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({ imageAssetId: 'permitted-photo' }),
  )
  expect(apply.mock.calls[0][0]).not.toHaveProperty('packagePrice')
})

it.skipIf(!process.env.TEST_LIVE_RETAILER && !process.env.TEST_RETAILER_HTML)(
  'shows and applies the retrieved Sam’s package price with provenance',
  async () => {
    const { fetchProductDetails } =
      await import('../../netlify/lib/product-import')
    const url =
      'https://www.samsclub.com/ip/Member-s-Mark-Bread-Pizza-Flour-25-lbs/13909715756'
    const { productDetails } = await import('../../netlify/lib/product-import')
    const products = process.env.TEST_RETAILER_HTML
      ? productDetails(
          (await import('node:fs')).readFileSync(
            process.env.TEST_RETAILER_HTML,
            'utf8',
          ),
          url,
        )
      : await fetchProductDetails(url)
    expect(products[0].fields.packagePrice).toBeGreaterThan(0)
    const apply = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ products })),
    )
    render(
      <ProductLinkImport
        draft={{ packagePrice: 20 }}
        apply={apply}
        onWorkspace={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('Product URL'), {
      target: { value: products[0].sourceUrl },
    })
    await userEvent.click(
      screen.getByRole('button', { name: 'Import details' }),
    )
    if (products.length > 1)
      await userEvent.selectOptions(
        screen.getByLabelText('Choose the exact product / package / offer'),
        '0',
      )
    expect(screen.getByLabelText('Imported listed online price')).toHaveValue(
      products[0].fields.packagePrice,
    )
    for (const name of [
      'Package price',
      'Purchase package quantity',
      'Purchase unit',
      'Currency',
    ])
      await userEvent.click(screen.getByRole('checkbox', { name }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Apply selected values' }),
    )
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        listedOnlinePrice: products[0].fields.packagePrice,
        currency: 'USD',
        purchaseQuantity: 25,
        purchaseUnit: 'lb',
        purchasePriceConfirmed: false,
        productSourceUrl: products[0].sourceUrl,
        productCheckedAt: products[0].checkedAt,
      }),
    )
  },
  20000,
)

it('applies available package metadata without overwriting the current price or claiming a unit conversion', async () => {
  const apply = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        products: [
          {
            ...p,
            fields: { brand: 'Wesson', packageSize: '128 fl oz', packCount: 2 },
            title: 'Product details',
            imageUrl: '',
          },
        ],
      }),
    ),
  )
  render(
    <ProductLinkImport
      draft={{ name: 'My oil', packagePrice: 17 }}
      apply={apply}
      onWorkspace={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText('Product URL'), {
    target: { value: p.sourceUrl },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Import details' }))
  expect(
    await screen.findByText('Product name unavailable—enter manually.'),
  ).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
  for (const label of ['Brand', 'Pack count'])
    await userEvent.click(screen.getByRole('checkbox', { name: label }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply selected values' }),
  )
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({
      brand: 'Wesson',
      productSourcePackageSize: '128 fl oz',
      packCount: 2,
      productSourceUrl: p.sourceUrl,
      productCheckedAt: p.checkedAt,
    }),
  )
  for (const field of [
    'name',
    'packagePrice',
    'purchaseQuantity',
    'purchaseUnit',
  ])
    expect(apply.mock.calls[0][0]).not.toHaveProperty(field)
})

it('keeps edited parent form values and the account page intact after a retailer challenge', async () => {
  const onWorkspace = vi.fn()
  const fetcher = vi.fn(async (_url: string, _options?: RequestInit) =>
    Response.json(
      {
        error: walmartVerificationMessage,
        code: 'PRODUCT_HUMAN_VERIFICATION',
      },
      { status: 400 },
    ),
  )
  vi.stubGlobal('fetch', fetcher)
  function Form() {
    const [draft, setDraft] = useState({
      name: '',
      packagePrice: '',
      notes: 'Existing notes',
    })
    return (
      <>
        <label>
          Current ingredient name
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          Current package price
          <input
            value={draft.packagePrice}
            onChange={(e) =>
              setDraft({ ...draft, packagePrice: e.target.value })
            }
          />
        </label>
        <ProductLinkImport
          draft={draft}
          apply={(patch) => setDraft({ ...draft, ...patch })}
          onWorkspace={onWorkspace}
        />
      </>
    )
  }
  render(<Form />)
  const before = window.location.href
  await userEvent.type(
    screen.getByLabelText('Current ingredient name'),
    'My oil draft',
  )
  await userEvent.type(screen.getByLabelText('Current package price'), '14.75')
  fireEvent.change(screen.getByLabelText('Product URL'), {
    target: { value: 'https://www.walmart.com/ip/oil/10291484' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Import details' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your entries are still in this form. Keep this page open to continue manually.',
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    walmartVerificationMessage,
  )
  expect(
    screen.queryByRole('link', { name: 'Open Walmart Product Page' }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByText(
      'Walmart imports are currently experiencing issues. We’re working on a fix.',
    ).tagName,
  ).toBe('STRONG')
  expect(screen.getByRole('button', { name: 'Import details' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Import details' }))
  fireEvent.change(screen.getByLabelText('Product URL'), {
    target: { value: 'https://shop.example/another-product' },
  })
  expect(screen.getByRole('button', { name: 'Import details' })).toBeEnabled()
  fireEvent.change(screen.getByLabelText('Product URL'), {
    target: { value: 'https://www.walmart.com/ip/oil/10291484' },
  })
  expect(screen.getByRole('button', { name: 'Import details' })).toBeDisabled()
  expect(screen.getByLabelText('Product text / notes')).toHaveValue(
    'Existing notes',
  )
  await userEvent.type(
    screen.getByLabelText('Product text / notes'),
    ' Oil package text',
  )
  expect(screen.getByLabelText('Product text / notes')).toHaveValue(
    'Existing notes Oil package text',
  )
  expect(screen.queryByText('Review extracted values')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Current ingredient name')).toHaveValue(
    'My oil draft',
  )
  expect(screen.getByLabelText('Current package price')).toHaveValue('14.75')
  expect(window.location.href).toBe(before)
  expect(onWorkspace).not.toHaveBeenCalled()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0]).toEqual(
    expect.arrayContaining(['/api/workspace?productImport=1']),
  )
})

it.each([true, false])(
  'uses the existing screenshot upload without changing product fields (success: %s)',
  async (success) => {
    const apply = vi.fn(),
      onWorkspace = vi.fn()
    const asset = {
      id: 'screenshot',
      name: 'Screenshot',
      fileUrl: '/api/workspace?asset=screenshot',
    }
    const workspace = { graphic_assets: [asset] }
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('upload')) {
        expect(options?.body).toBeInstanceOf(FormData)
        return success
          ? Response.json({ asset, workspace })
          : Response.json(
              { error: 'Screenshot upload unavailable.' },
              { status: 400 },
            )
      }
      return Response.json(
        {
          error: walmartVerificationMessage,
          code: 'PRODUCT_HUMAN_VERIFICATION',
        },
        { status: 400 },
      )
    })
    vi.stubGlobal('fetch', fetcher)
    render(
      <ProductLinkImport
        draft={{
          name: 'My oil',
          imageAssetId: 'original-photo',
          notes: 'My notes',
        }}
        apply={apply}
        onWorkspace={onWorkspace}
      />,
    )
    fireEvent.change(screen.getByLabelText('Product URL'), {
      target: { value: 'https://www.walmart.com/ip/oil/10291484' },
    })
    await userEvent.click(
      screen.getByRole('button', { name: 'Import details' }),
    )
    await screen.findByRole('alert')
    await userEvent.upload(
      screen.getByLabelText('Upload product screenshot'),
      new File(['test screenshot'], 'product.png', { type: 'image/png' }),
    )
    if (success) {
      expect(
        await screen.findByAltText('Photo of Product screenshot'),
      ).toHaveAttribute('src', asset.fileUrl)
      expect(onWorkspace).toHaveBeenCalledWith(workspace)
      expect(
        screen.getByRole('link', { name: 'View uploaded screenshot' }),
      ).toHaveAttribute('href', asset.fileUrl)
    } else {
      expect(
        await screen.findByText('Screenshot upload unavailable.'),
      ).toBeInTheDocument()
      expect(onWorkspace).not.toHaveBeenCalled()
    }
    expect(screen.getByLabelText('Product text / notes')).toHaveValue(
      'My notes',
    )
    expect(screen.getByLabelText('Product URL')).toHaveValue(
      'https://www.walmart.com/ip/oil/10291484',
    )
    expect(
      screen.getByRole('button', { name: 'Import details' }),
    ).toBeDisabled()
    expect(apply).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1][0]).toBe('/api/workspace?upload=1')
  },
)

it('keeps an existing extraction review intact when a subsequent Walmart import is blocked', async () => {
  const apply = await open()
  await userEvent.click(screen.getByText('Edit name', { selector: 'summary' }))
  await userEvent.clear(screen.getByLabelText('Imported name'))
  await userEvent.type(
    screen.getByLabelText('Imported name'),
    'Reviewed flour name',
  )
  await userEvent.click(screen.getByRole('checkbox', { name: /^Name$/ }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        {
          error: walmartVerificationMessage,
          code: 'PRODUCT_HUMAN_VERIFICATION',
        },
        { status: 400 },
      ),
    ),
  )
  fireEvent.change(screen.getByLabelText('Product URL'), {
    target: { value: 'https://www.walmart.com/ip/oil/10291484' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Import details' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    walmartVerificationMessage,
  )
  expect(screen.getByLabelText('Imported name')).toHaveValue(
    'Reviewed flour name',
  )
  expect(screen.getByRole('checkbox', { name: /^Name$/ })).toBeChecked()
  expect(apply).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledTimes(1)
})

const samsProduct = {
  ...p,
  sourceUrl:
    'https://www.samsclub.com/ip/flour/13909715756?tracking=long-source',
  fields: {
    name: 'Flour',
    vendor: 'Samsclub.com',
    brand: 'Member’s Mark',
    packageSize: '10 lbs',
    purchaseQuantity: 10,
    purchaseUnit: 'lb',
    subingredients: 'Flour (wheat, malted barley flour), salt.',
    sourceContains: 'Contains wheat.',
    sourceMayContain: 'May contain soy.',
    notes: 'A product description. '.repeat(40),
    retailerSku: '000123',
    barcode: '001234567890',
  },
}
async function vendorReview(vendors: any[], draft: any = {}) {
  const fetcher = vi.fn(async (url: string) =>
    Response.json(
      url.includes('productVendors')
        ? { vendors }
        : { products: [samsProduct] },
    ),
  )
  vi.stubGlobal('fetch', fetcher)
  const apply = vi.fn()
  const onVendorsChange = vi.fn()
  render(
    <ProductLinkImport
      draft={draft}
      apply={apply}
      onWorkspace={vi.fn()}
      onVendorsChange={onVendorsChange}
    />,
  )
  fireEvent.change(screen.getByLabelText('Product URL'), {
    target: { value: samsProduct.sourceUrl },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Import details' }))
  await screen.findByLabelText('Existing vendor')
  await userEvent.click(
    screen.getByText('Choose vendor', { selector: 'summary' }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
  return { apply, fetcher, onVendorsChange }
}
it('suggests and applies a stable existing vendor ID, keeping brand separate and one package representation', async () => {
  const { apply, fetcher, onVendorsChange } = await vendorReview([
    {
      id: 'sams',
      name: 'Sam’s Club',
      notes: 'Preserve existing notes',
      contact: 'Purchasing desk',
    },
    { id: 'brand', name: 'Member’s Mark' },
  ])
  expect(screen.getByLabelText('Existing vendor')).toHaveValue('sams')
  expect(onVendorsChange).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'sams',
        notes: 'Preserve existing notes',
        contact: 'Purchasing desk',
      }),
    ]),
  )
  expect(
    screen.queryByText('Source package size (confirm unit)'),
  ).not.toBeInTheDocument()
  for (const name of [
    'Vendor',
    'Brand',
    'Purchase package quantity',
    'Purchase unit',
    'Source ingredient statement',
    'Source Contains statement',
    'Source May contain statement',
  ])
    await userEvent.click(screen.getByRole('checkbox', { name }))
  expect(screen.getByText('7 fields selected.')).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply selected values' }),
  )
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({
      vendorId: 'sams',
      vendor: 'Sam’s Club',
      brand: 'Member’s Mark',
      purchaseQuantity: 10,
      purchaseUnit: 'lb',
      subingredients: samsProduct.fields.subingredients,
      sourceContains: 'Contains wheat.',
      sourceMayContain: 'May contain soy.',
      reviewed: false,
    }),
  )
  expect(apply.mock.calls[0][0]).not.toHaveProperty('packageSize')
  expect(
    fetcher.mock.calls.every(
      ([url]) =>
        url.includes('productImport') || url.includes('productVendors'),
    ),
  ).toBe(true)
  expect(fetcher.mock.calls).toHaveLength(2)
})
it('requires a choice for multiple matches and supports searching other existing vendors', async () => {
  const { apply } = await vendorReview([
    { id: 'a', name: 'Sam’s Club' },
    { id: 'b', name: "Sam's Club" },
    { id: 'mill', name: 'Local Mill' },
  ])
  expect(screen.getByText(/Multiple vendors match/)).toBeVisible()
  expect(screen.getByRole('checkbox', { name: 'Vendor' })).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Search oven vendors'), 'Mill')
  await userEvent.selectOptions(
    screen.getByLabelText('Existing vendor'),
    'mill',
  )
  expect(screen.getByRole('checkbox', { name: 'Vendor' })).toBeChecked()
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply selected values' }),
  )
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({ vendorId: 'mill', vendor: 'Local Mill' }),
  )
})

it('reuses the same vendor on repeated imports and Apply without requesting vendor creation', async () => {
  const { apply, fetcher } = await vendorReview([
    { id: 'sams', name: 'Sam’s Club' },
  ])
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) {
      await userEvent.click(
        screen.getByRole('button', { name: 'Import details' }),
      )
      await screen.findByLabelText('Existing vendor')
      await userEvent.click(
        screen.getByRole('button', { name: 'Clear selection' }),
      )
    }
    await userEvent.click(screen.getByRole('checkbox', { name: 'Vendor' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Apply selected values' }),
    )
  }
  expect(apply.mock.calls.map(([patch]) => patch.vendorId)).toEqual([
    'sams',
    'sams',
  ])
  expect(
    fetcher.mock.calls.filter(([url]) => url.includes('productVendors')),
  ).toHaveLength(2)
  expect(
    fetcher.mock.calls.filter(
      ([url]) =>
        !url.includes('productVendors') && !url.includes('productImport'),
    ),
  ).toHaveLength(0)
})
it('does not treat vendor-list failure as no match, and allows retry', async () => {
  let failed = true
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('productVendors')
        ? failed
          ? Response.json({ error: 'Service unavailable' }, { status: 503 })
          : Response.json({ vendors: [{ id: 'sams', name: 'Sam’s Club' }] })
        : Response.json({ products: [samsProduct] }),
    ),
  )
  render(<ProductLinkImport draft={{}} apply={vi.fn()} onWorkspace={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Product URL'), {
    target: { value: samsProduct.sourceUrl },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Import details' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not load oven vendors',
  )
  expect(screen.queryByText(/No matching vendor/)).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Add new vendor' }),
  ).not.toBeInTheDocument()
  failed = false
  await userEvent.click(
    screen.getByRole('button', { name: 'Retry vendor list' }),
  )
  expect(await screen.findByLabelText('Existing vendor')).toHaveValue('sams')
})
it('offers new vendor creation only as an explicit confirmed action', async () => {
  const { fetcher } = await vendorReview([])
  expect(screen.getByText(/No matching vendor/)).toBeVisible()
  expect(fetcher.mock.calls).toHaveLength(2)
  await userEvent.click(screen.getByRole('button', { name: 'Add new vendor' }))
  expect(fetcher.mock.calls).toHaveLength(2)
  fetcher.mockImplementation(async () =>
    Response.json({
      vendors: [{ id: 'new', name: 'Sam’s Club' }],
      vendor: { id: 'new' },
    }),
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm add vendor' }),
  )
  expect(await screen.findByLabelText('Existing vendor')).toHaveValue('new')
})
it('preserves collapsed edits, separates identifiers and requires explicit replacement of reviewed wording', async () => {
  const { apply } = await vendorReview([{ id: 'sams', name: 'Sam’s Club' }], {
    reviewed: true,
    subingredients: 'My manually reviewed wording.',
  })
  const details = screen.getByText('Source details').closest('details')!
  expect(details).not.toHaveAttribute('open')
  expect(screen.queryByText(samsProduct.sourceUrl)).not.toBeInTheDocument()
  expect(
    screen.getByLabelText('Imported retailer sku (not barcode)'),
  ).toHaveValue('000123')
  expect(screen.getByLabelText('Imported barcode')).toHaveValue('001234567890')
  await userEvent.click(screen.getByText('Expand/Edit description'))
  fireEvent.change(screen.getByLabelText('Imported description / notes'), {
    target: { value: 'Corrected notes' },
  })
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Description / notes' }),
  )
  await userEvent.click(screen.getByText('Expand/Edit description'))
  await userEvent.click(screen.getByText('Expand/Edit description'))
  expect(screen.getByLabelText('Imported description / notes')).toHaveValue(
    'Corrected notes',
  )
  expect(
    screen.getByRole('checkbox', { name: 'Description / notes' }),
  ).toBeChecked()
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Source ingredient statement' }),
  )
  expect(
    screen.getByRole('button', { name: 'Apply selected values' }),
  ).toBeDisabled()
  await userEvent.click(
    screen.getByLabelText(/Replace existing reviewed ingredient/),
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply selected values' }),
  )
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({
      subingredients: samsProduct.fields.subingredients,
      reviewed: false,
      notes: 'Corrected notes',
    }),
  )
})

it('offers Paste product text after an oversized-page failure and keeps the existing draft while notes are edited', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        {
          error:
            'Product page exceeds the 4 MiB safety limit. Paste its product text instead.',
        },
        { status: 400 },
      ),
    ),
  )
  function Harness() {
    const [draft, setDraft] = useState({
      name: 'Manual bags',
      purchaseQuantity: 100,
      purchaseUnit: 'each',
      packagePrice: 12,
      notes: '',
    })
    return (
      <>
        <ProductLinkImport
          draft={draft}
          apply={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          onWorkspace={vi.fn()}
        />
        <output aria-label="Preserved draft">{JSON.stringify(draft)}</output>
      </>
    )
  }
  render(<Harness />)
  await userEvent.type(
    screen.getByLabelText('Product URL'),
    'https://www.amazon.com/dp/B0FK3XFMQQ',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Import details' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your entries are preserved',
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Paste product text instead' }),
  )
  await userEvent.type(
    screen.getByLabelText('Product text / notes'),
    '100 bags from package',
  )
  expect(screen.getByLabelText('Preserved draft')).toHaveTextContent(
    '"name":"Manual bags","purchaseQuantity":100,"purchaseUnit":"each","packagePrice":12',
  )
  expect(screen.getByLabelText('Preserved draft')).toHaveTextContent(
    '100 bags from package',
  )
})
it.each([
  { usedAs: 'material', materialType: 'fabric' },
  { usedAs: 'material', materialType: 'yarn' },
  { usedAs: 'packaging' },
  { usedAs: 'supply' },
  { workflow: 'resale', variant: 'Blue' },
  { workflow: 'handmade' },
])(
  'shares review controls for non-food inventory %j without food requirements or stock changes',
  async (type) => {
    const apply = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          products: [
            {
              ...p,
              fields: {
                ...p.fields,
                brand: 'Source brand',
                retailerSku: 'SOURCE-ID',
              },
            },
          ],
        }),
      ),
    )
    render(
      <ProductLinkImport
        draft={{
          name: 'Manual item',
          ...type,
          productSourceUrl: 'https://example.org/saved',
          price: 14,
          quantity: 9,
        }}
        apply={apply}
        onWorkspace={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Product URL')).toHaveValue(
      'https://example.org/saved',
    )
    expect(
      screen.getByText(/Use Share → Copy link on the Amazon product page/),
    ).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'Import details' }),
    )
    await screen.findByText('Bread flour 25 lb')
    expect(
      screen.queryByText(/Check ingredient and allergen/),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: 'Source ingredient statement' }),
    ).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Clear selection' }),
    )
    await userEvent.click(screen.getByRole('checkbox', { name: 'Brand' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Apply selected values' }),
    )
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: 'Source brand',
        productSourceUrl: 'https://example.org/flour',
      }),
    )
    const patch = apply.mock.calls[0][0]
    for (const key of [
      'name',
      'quantity',
      'price',
      'packagePrice',
      'sku',
      'barcode',
      'usedAs',
      'workflow',
    ])
      expect(patch).not.toHaveProperty(key)
  },
)

it('honors Retry-After, performs only two explicit retries and preserves the complete manual draft and URL', async () => {
  vi.useFakeTimers()
  try {
    const url =
      'https://www.amazon.com/dp/B0BQMJJBNP?ref_=ppx_hzsearch_conn_dt_b_fed_asin_title_8&th=1'
    const draft = {
      id: 'stable-id',
      name: 'Manual name',
      productSourceUrl: url,
      imageAssetId: 'uploaded-photo',
      labelImageAssetId: 'custom-art',
      packagePrice: 31,
      purchaseQuantity: 2,
      quantity: 7,
    }
    const before = structuredClone(draft),
      apply = vi.fn()
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          error: 'Upstream unavailable',
          diagnostics: {
            requestedAt: '2026-11-07T19:21:59Z',
            requestedUrl: url,
            source: 'retailer',
            requestId: 'request-ref',
            hops: [
              {
                url: 'https://www.amazon.com/dp/B0BQMJJBNP?th=1',
                at: '2026-11-07T19:21:59Z',
                status: 503,
                headers: { 'content-type': 'text/html', 'retry-after': '60' },
                bodySummary: 'Error document; not parsed.',
              },
            ],
          },
        },
        { status: 400, headers: { 'Retry-After': '60' } },
      ),
    )
    vi.stubGlobal('fetch', fetcher)
    render(
      <ProductLinkImport
        draft={draft}
        apply={apply}
        populateDraft
        onWorkspace={vi.fn()}
      />,
    )
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Import details' })),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Amazon product details couldn’t be retrieved. Your entries are preserved. Retry or continue manually.',
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
    await act(async () => vi.advanceTimersByTime(59000))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
    await act(async () => vi.advanceTimersByTime(1000))
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Retry' })),
    )
    await act(async () => vi.advanceTimersByTime(60000))
    expect(fetcher).toHaveBeenCalledTimes(2)
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Retry' })),
    )
    await act(async () => vi.advanceTimersByTime(120000))
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(
      fetcher.mock.calls.every(
        (call) =>
          JSON.parse(String((call as unknown as [string, RequestInit])[1].body))
            .url === url,
      ),
    ).toBe(true)
    expect(apply).not.toHaveBeenCalled()
    expect(draft).toEqual(before)
    expect(screen.getByLabelText('Product URL')).toHaveValue(url)
  } finally {
    vi.useRealTimers()
  }
})

it('requires explicit review after a successful retry without filling even blank manual fields', async () => {
  const apply = vi.fn(),
    fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: 'Temporary error' },
          { status: 503, headers: { 'Retry-After': '0' } },
        ),
      )
      .mockResolvedValueOnce(Response.json({ products: [p] }))
  vi.stubGlobal('fetch', fetcher)
  render(
    <ProductLinkImport
      draft={{
        id: 'kept',
        name: '',
        imageAssetId: 'kept-photo',
        productSourceUrl: 'https://example.org/flour',
      }}
      apply={apply}
      populateDraft
      onWorkspace={vi.fn()}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Import details' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await screen.findByText('Bread flour 25 lb')
  expect(apply).not.toHaveBeenCalled()
  expect(fetcher).toHaveBeenCalledTimes(2)
})
