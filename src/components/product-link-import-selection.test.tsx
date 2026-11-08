import { afterEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductLinkImport } from './product-link-import'

afterEach(() => vi.unstubAllGlobals())

const sourceUrl = 'https://www.samsclub.com/ip/flour/13909715756?clubId=1234'
const pickup = {
  fields: {
    name: 'Bread flour',
    purchaseQuantity: 25,
    purchaseUnit: 'lb',
    packagePrice: 10.98,
    currency: 'USD',
  },
  title: 'Bread flour 25 lb',
  sourceUrl,
  imageUrl: 'https://example.org/flour.jpg',
  checkedAt: '2026-11-08T01:00:00Z',
  warnings: [],
  conditions: ['Sam’s Club · PICKUP · Club 1234'],
}
const shipping = {
  ...pickup,
  fields: { ...pickup.fields, packagePrice: 12.98 },
  conditions: ['Sam’s Club · SHIPPING · Club 1234'],
}
const draft = {
  id: 'existing-flour',
  name: 'My flour',
  purchaseQuantity: 2,
  purchaseUnit: 'kg',
  packagePrice: 20,
  currency: 'USD',
  productSourceUrl: sourceUrl,
  imageAssetId: 'current-photo',
  quantity: 7,
}

async function review(products = [shipping, pickup], packageSetup = false) {
  const apply = vi.fn()
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    void options
    return url.includes('productImage')
      ? Response.json({ asset: { id: 'imported-photo' }, workspace: {} })
      : Response.json({ products })
  })
  vi.stubGlobal('fetch', fetcher)
  const props = {
    existing: true,
    populateDraft: true,
    packageSetup,
    draft: packageSetup
      ? { ...draft, unit: 'lb', purchaseUnit: 'bag', amountPerPackage: 2 }
      : draft,
    apply,
    onWorkspace: vi.fn(),
  }
  const view = render(<ProductLinkImport {...props} />)
  await userEvent.click(screen.getByRole('button', { name: 'Import details' }))
  await screen.findByRole('button', { name: 'Select all' })
  return { apply, fetcher, props, ...view }
}

it('defaults to Pickup, keeps club context and preserves an explicit Shipping selection across renders', async () => {
  const { apply, fetcher, rerender, props } = await review()
  const choice = screen.getByLabelText(
    'Choose the exact product / package / offer',
  )
  expect(choice).toHaveValue('1')
  expect(screen.getByText(/^Selected offer:/)).toHaveTextContent(
    'PICKUP · Club 1234',
  )
  expect(screen.getByLabelText('Imported listed online price')).toHaveValue(
    10.98,
  )
  expect(screen.getByLabelText(/I approve changing/)).not.toBeChecked()
  expect(screen.getByLabelText(/Import product photo/)).not.toBeChecked()
  expect(apply).not.toHaveBeenCalled()
  await userEvent.selectOptions(choice, '0')
  rerender(
    <ProductLinkImport {...props} draft={{ ...draft, notes: 'Manual edit' }} />,
  )
  expect(choice).toHaveValue('0')
  expect(screen.getByText(/^Selected offer:/)).toHaveTextContent(
    'SHIPPING · Club 1234',
  )
  expect(screen.getByLabelText('Imported listed online price')).toHaveValue(
    12.98,
  )
  expect(screen.getByLabelText('Product URL')).toHaveValue(sourceUrl)
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body || '{}'))).toEqual({
    url: sourceUrl,
  })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(apply).not.toHaveBeenCalled()
})

it('Select all checks fields, photo and package approval without applying; Clear selection unchecks all', async () => {
  const { apply, fetcher } = await review()
  const approve = screen.getByLabelText(/I approve changing/)
  const photo = screen.getByLabelText(/Import product photo/)
  await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
  for (const checkbox of screen.getAllByRole('checkbox'))
    expect(checkbox).toBeChecked()
  expect(approve).toBeChecked()
  expect(photo).toBeChecked()
  expect(screen.getByText(/^Package: 25 lb$/)).toBeVisible()
  expect(apply).not.toHaveBeenCalled()
  expect(fetcher).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
  for (const checkbox of screen.getAllByRole('checkbox'))
    expect(checkbox).not.toBeChecked()
  expect(approve).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Apply selected values' }),
  ).toBeDisabled()
  expect(apply).not.toHaveBeenCalled()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('applies the selected Pickup price/package and photo to the draft only after explicit Select all and Apply', async () => {
  const { apply, fetcher } = await review()
  await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply selected values' }),
  )
  expect(apply).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      name: 'Bread flour',
      packagePrice: 10.98,
      purchaseQuantity: 25,
      purchaseUnit: 'lb',
      imageAssetId: 'imported-photo',
      productSourceUrl: sourceUrl,
    }),
  )
  expect(apply.mock.calls[0][0]).not.toHaveProperty('quantity')
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/workspace?productImport=1',
    '/api/workspace?productImage=1',
  ])
})

it('keeps checkboxes individually editable after Select all and preserves unchecked draft values', async () => {
  const { apply, fetcher } = await review()
  await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
  await userEvent.click(screen.getByLabelText(/I approve changing/))
  expect(
    screen.getByRole('button', { name: 'Apply selected values' }),
  ).toBeDisabled()
  for (const name of [
    'Package price',
    'Purchase package quantity',
    'Purchase unit',
  ])
    await userEvent.click(screen.getByRole('checkbox', { name }))
  await userEvent.click(screen.getByLabelText(/Import product photo/))
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply selected values' }),
  )
  const patch = apply.mock.calls[0][0]
  expect(patch).toMatchObject({ name: 'Bread flour', currency: 'USD' })
  for (const key of [
    'packagePrice',
    'purchaseQuantity',
    'purchaseUnit',
    'imageAssetId',
    'quantity',
  ])
    expect(patch).not.toHaveProperty(key)
  expect({ ...draft, ...patch }).toMatchObject({
    purchaseQuantity: 2,
    purchaseUnit: 'kg',
    packagePrice: 20,
    imageAssetId: 'current-photo',
    quantity: 7,
  })
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it.each(['', 'not-an-image-url', 'javascript:alert(1)'])(
  'does not select photo import when there is no usable extracted photo: %s',
  async (imageUrl) => {
    const { apply, fetcher } = await review([{ ...pickup, imageUrl }])
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(
      screen.queryByLabelText(/Import product photo/),
    ).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Apply selected values' }),
    )
    expect(apply.mock.calls[0][0]).not.toHaveProperty('imageAssetId')
    expect(fetcher).toHaveBeenCalledTimes(1)
  },
)

it('includes mapped package approval in Select all for the package setup form', async () => {
  const { apply } = await review([pickup], true)
  expect(screen.getByLabelText(/I approve changing/)).not.toBeChecked()
  expect(screen.getByText(/Source package: 25 lb/)).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
  expect(screen.getByLabelText(/I approve changing/)).toBeChecked()
  await userEvent.click(screen.getByLabelText(/Import product photo/))
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply selected values' }),
  )
  expect(apply.mock.calls[0][0]).toMatchObject({
    amountPerPackage: 25,
    purchaseUnit: 'bag',
    packagePrice: 10.98,
  })
})

it('clears photo and package approval when the user changes offers', async () => {
  await review()
  await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
  await userEvent.selectOptions(
    screen.getByLabelText('Choose the exact product / package / offer'),
    '0',
  )
  expect(screen.getByLabelText(/I approve changing/)).not.toBeChecked()
  expect(screen.getByLabelText(/Import product photo/)).not.toBeChecked()
})

it('keeps an ambiguous Pickup choice visible and applies only the chosen offer’s package and price', async () => {
  const alternative = {
    ...pickup,
    title: 'Bread flour 10 lb',
    fields: { ...pickup.fields, purchaseQuantity: 10, packagePrice: 5.98 },
    conditions: ['Sam’s Club · PICKUP · Club 5678'],
  }
  const apply = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ products: [shipping, pickup, alternative] }),
    ),
  )
  render(
    <ProductLinkImport
      existing
      populateDraft
      draft={draft}
      apply={apply}
      onWorkspace={vi.fn()}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Import details' }))
  const choice = await screen.findByLabelText(
    'Choose the exact product / package / offer',
  )
  expect(choice).toHaveValue('-1')
  expect(
    screen.getByText(/Multiple products, packages or Pickup offers/),
  ).toBeVisible()
  expect(apply).not.toHaveBeenCalled()
  await userEvent.selectOptions(choice, '2')
  await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
  await userEvent.click(screen.getByLabelText(/Import product photo/))
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply selected values' }),
  )
  expect(apply.mock.calls[0][0]).toMatchObject({
    purchaseQuantity: 10,
    purchaseUnit: 'lb',
    packagePrice: 5.98,
  })
})

it('clearly reports unavailable Pickup while preserving the alternative’s fulfillment label', async () => {
  await review([shipping])
  expect(
    screen.getByText(/Pickup is unavailable in the imported offers/),
  ).toBeVisible()
  expect(screen.getByText(/^Selected offer:/)).toHaveTextContent('SHIPPING')
  expect(
    screen.getByLabelText('Choose the exact product / package / offer'),
  ).toHaveValue('0')
  expect(screen.getByLabelText('Imported listed online price')).toHaveValue(
    12.98,
  )
})
