import { afterEach, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductLinkImport } from './product-link-import'
afterEach(() => vi.unstubAllGlobals())
const product = {
  title: 'Cookie bags, 100 count',
  sourceUrl: 'https://test.invalid/bags',
  imageUrl: '',
  checkedAt: '2026-11-22T00:00:00Z',
  warnings: [],
  conditions: [],
  fields: {
    name: 'Cookie bags',
    brand: 'Test brand',
    packagePrice: 12.5,
    currency: 'USD',
    purchaseUnit: 'package',
    amountPerPackage: 100,
    unit: 'each',
    packageRelationship: '1 package = 100 bags',
  },
}
async function open(packageSetup = true, fields = product.fields) {
  const apply = vi.fn(),
    fetcher = vi.fn(async () =>
      Response.json({ products: [{ ...product, fields }] }),
    )
  vi.stubGlobal('fetch', fetcher)
  const draft = {
    id: 'isolated',
    name: 'Manual item',
    unit: 'each',
    purchaseUnit: 'package',
    currency: 'USD',
    quantity: 0,
  }
  render(
    <ProductLinkImport
      draft={draft}
      apply={apply}
      onWorkspace={vi.fn()}
      packageSetup={packageSetup}
      existing={!packageSetup}
    />,
  )
  fireEvent.change(screen.getByLabelText('Product URL'), {
    target: { value: product.sourceUrl },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Import details' }))
  await screen.findByRole('dialog', { name: 'Review imported information' })
  return { apply, fetcher, draft }
}
it.each([true, false])(
  'accepts explicit package contents into the actual %s package controls without persistence or stock changes',
  async (packageSetup) => {
    const { apply, fetcher } = await open(packageSetup)
    expect(apply).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByText(/12.5 ÷ 100 = 0.125/)).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'Accept & use information' }),
    )
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0][0]).toMatchObject({
      amountPerPackage: 100,
      purchaseUnit: 'package',
      unit: 'each',
      packagePrice: 12.5,
    })
    expect(apply.mock.calls[0][0]).not.toHaveProperty('quantity')
    if (!packageSetup)
      expect(apply.mock.calls[0][0]).toMatchObject({
        purchaseQuantity: 1,
        purchaseSetup: { packageUnit: 'package', price: 12.5, stockUnits: 100 },
      })
    expect(fetcher).toHaveBeenCalledTimes(1)
  },
)
it('preserves non-empty fields unless selected, keeps reviewed corrections, and protects review edits on Escape', async () => {
  const { apply } = await open()
  expect(screen.getByRole('checkbox', { name: 'Name' })).not.toBeChecked()
  await userEvent.click(
    screen.getByText('Edit stock quantity in one purchase unit'),
  )
  fireEvent.change(
    screen.getByLabelText('Imported stock quantity in one purchase unit'),
    { target: { value: '120' } },
  )
  await userEvent.keyboard('{Escape}')
  expect(
    screen.getByText('Discard corrections made in this review?'),
  ).toBeVisible()
  expect(apply).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Keep reviewing' }))
  await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Name' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Accept & use information' }),
  )
  expect(apply.mock.calls[0][0]).toMatchObject({ amountPerPackage: '120' })
  expect(apply.mock.calls[0][0]).not.toHaveProperty('name')
})
it('cancel and close discard the pending extraction without applying anything', async () => {
  const { apply } = await open()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(apply).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Product URL')).toHaveValue(product.sourceUrl)
})
it('normalizes an explicitly reviewed price covering multiple purchase units separately from package contents', async () => {
  const { apply } = await open(true, {
    ...product.fields,
    packagePrice: 25,
    priceBasisQuantity: 2,
  } as typeof product.fields)
  await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Accept & use information' }),
  )
  expect(apply.mock.calls[0][0]).toMatchObject({
    packagePrice: 12.5,
    amountPerPackage: 100,
  })
})
