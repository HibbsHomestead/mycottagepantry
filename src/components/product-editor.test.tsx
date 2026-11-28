import { expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductWorkflowDialog } from './product-workflow-dialog'
import { demoData } from '@/lib/demo'
import type { Item } from '@/lib/domain'

afterEach(() => vi.unstubAllGlobals())
function setup(
  mutate = vi.fn(async () => {}),
  onStockAction = vi.fn(),
  overrides: Partial<Item> = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        categories: [],
        rates: [],
        mappings: {},
        revision: 0,
        products: [],
      }),
    ),
  )
  const w = demoData()
  const stored: Item = {
    id: 'mug-1',
    name: 'Enamel mug',
    workflow: 'resale',
    price: 14,
    threshold: 2,
    quantity: 12,
    cost: 4,
    stockCostKnown: true,
    sku: 'MUG-1',
    creationRequestId: 'create-mug-1',
    inventoryCreation: true,
    ...overrides,
  }
  w.products = [
    ...w.products,
    stored,
    { id: 'jar', name: 'Jar', workflow: 'resale', sku: 'JAR-1', price: 3 },
  ]
  const close = vi.fn()
  render(
    <ProductWorkflowDialog
      kind="trade-product"
      item={stored}
      workspace={w}
      role="Owner"
      mutate={mutate}
      onWorkspace={vi.fn()}
      close={close}
      onDirty={vi.fn()}
      onStockAction={onStockAction}
    />,
  )
  return { mutate, close, onStockAction }
}
const tab = (name: string) =>
  fireEvent.mouseDown(screen.getByRole('tab', { name }))

it('opens an existing product as Edit Product with Save Changes and keeps its ID across tabs', async () => {
  const { mutate, close } = setup()
  expect(screen.getByRole('heading', { name: 'Edit Product' })).toBeVisible()
  expect(screen.getByRole('tab', { name: 'Details' })).toBeVisible()
  tab('Pricing & Stock')
  const price = screen.getByLabelText('Selling price')
  await userEvent.clear(price)
  await userEvent.type(price, '16.5')
  expect(
    screen.getByRole('region', { name: 'Stock on hand' }),
  ).toHaveTextContent('12 items on hand')
  expect(
    screen.getByRole('button', { name: 'Receive Stock' }),
  ).toBeInTheDocument()
  tab('Images & Labels')
  expect(screen.getByRole('region', { name: 'Linked labels' })).toBeVisible()
  expect(
    screen.queryByRole('combobox', { name: 'Label template' }),
  ).not.toBeInTheDocument()
  tab('Details')
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
  const [action, table, payload] = mutate.mock.calls[0] as unknown as [
    string,
    string,
    Item,
  ]
  expect([action, table]).toEqual(['save', 'products'])
  expect(payload.id).toBe('mug-1')
  expect(payload.price).toBe('16.5')
  expect(payload).not.toHaveProperty('inventoryCreation')
  expect(close).toHaveBeenCalled()
})

it('keeps edits and the editor open after a failed save, then retries the same product', async () => {
  const mutate = vi
    .fn()
    .mockRejectedValueOnce(new Error('Network unavailable'))
    .mockResolvedValueOnce(undefined)
  const { close } = setup(mutate)
  const name = screen.getByLabelText('Product name')
  await userEvent.clear(name)
  await userEvent.type(name, 'Blue enamel mug')
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Network unavailable',
  )
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Product name')).toHaveValue('Blue enamel mug')
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(close).toHaveBeenCalled())
  expect(mutate.mock.calls.map((c) => (c[2] as Item).id)).toEqual([
    'mug-1',
    'mug-1',
  ])
})

it('names a genuine SKU conflict with another product and saves nothing', async () => {
  const { mutate, close } = setup()
  tab('Pricing & Stock')
  const sku = screen.getByLabelText('Item code / SKU')
  await userEvent.clear(sku)
  await userEvent.type(sku, 'jar-1')
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /SKU “jar-1” is already used by another product, “Jar”/,
  )
  expect(mutate).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Item code / SKU')).toHaveValue('jar-1')
  // The conflict reopens the tab that holds the field.
  expect(screen.getByRole('tab', { name: /Details/ })).toHaveAttribute(
    'data-state',
    'active',
  )
})

it('uses the product tabs with a cost summary beside the form', async () => {
  const { mutate } = setup()
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
    'Details',
    'Ingredients & allergens',
    'Images & Labels',
    'Pricing & Stock',
  ])
  expect(
    screen.getByRole('complementary', { name: 'Cost and margin' }),
  ).toHaveTextContent('Selling price$14.00')
  // The title photo opens the Images & Labels tab.
  await userEvent.click(
    screen.getByRole('button', { name: 'Open Images & Labels' }),
  )
  expect(screen.getByRole('tab', { name: 'Images & Labels' })).toHaveAttribute(
    'data-state',
    'active',
  )
  expect(screen.getByRole('region', { name: 'Product photo' })).toBeVisible()
  expect(screen.getByLabelText('Upload photo')).toBeInTheDocument()
  expect(
    screen.getByRole('region', { name: 'Label artwork' }),
  ).toHaveTextContent('never replaces the card photo')
  // Resale products do not get handmade label text fields.
  expect(screen.queryByLabelText('Label main name')).toBeNull()
  // Edits made on one tab survive switching tabs and are saved together.
  tab('Details')
  const name = screen.getByLabelText('Product name')
  await userEvent.clear(name)
  await userEvent.type(name, 'Speckled mug')
  tab('Pricing & Stock')
  const price = screen.getByLabelText('Selling price')
  await userEvent.clear(price)
  await userEvent.type(price, '18')
  tab('Images & Labels')
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
  const payload = (mutate.mock.calls[0] as unknown as Item[])[2]
  expect(payload).toMatchObject({
    id: 'mug-1',
    name: 'Speckled mug',
    price: '18',
  })
})

it('flags and opens the tab holding an invalid field', async () => {
  const { mutate } = setup()
  tab('Images & Labels')
  const name = screen.getByLabelText('Product name')
  await userEvent.clear(name)
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Check the highlighted fields',
  )
  expect(screen.getByRole('tab', { name: /Details/ })).toHaveAttribute(
    'data-state',
    'active',
  )
  expect(screen.getByLabelText('has errors')).toBeInTheDocument()
  expect(mutate).not.toHaveBeenCalled()
})

it('shows rounded stock while opening and saving preserve stored precision', async () => {
  const mutate = vi.fn(async () => {})
  setup(mutate, vi.fn(), { quantity: 12.345678, threshold: 1.234567 })
  tab('Pricing & Stock')
  expect(
    screen.getByRole('region', { name: 'Stock on hand' }),
  ).toHaveTextContent('12.35 items on hand')
  expect(screen.getByLabelText('Reorder when stock reaches')).toHaveValue(
    1.234567,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(mutate).toHaveBeenCalledOnce())
  const payload = (mutate.mock.calls[0] as unknown as [string, string, Item])[2]
  expect(payload.quantity).toBe(12.345678)
  expect(Number(payload.threshold)).toBe(1.234567)
})

it('saves explicit purchase estimates without receiving or changing recorded stock', async () => {
  const mutate = vi.fn(async () => {})
  setup(mutate)
  tab('Pricing & Stock')
  fireEvent.change(
    screen.getByLabelText('Default purchase price per pack/case'),
    { target: { value: '48' } },
  )
  fireEvent.change(
    screen.getByLabelText('Purchase pack contains this many sellable items'),
    { target: { value: '12' } },
  )
  expect(screen.getByText('Average inventory cost')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
  const [action, tableName, data] = mutate.mock.calls[0] as unknown as [
    string,
    string,
    Item,
  ]
  expect(action).toBe('save')
  expect(tableName).toBe('products')
  expect(data.purchaseDefaults).toMatchObject({
    packPrice: '48',
    itemsPerPack: '12',
  })
  expect(data.quantity).toBe(12)
  expect(data.cost).toBe(4)
})
