import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AddItemDialog } from './add-item-dialog'
import { demoData } from '@/lib/demo'
import { itemTypes } from '@/lib/add-item'
import type { Item } from '@/lib/domain'
import { blankLabel } from '@/lib/label-studio'
afterEach(() => vi.unstubAllGlobals())
function start(initialType = '') {
  const save = vi.fn<(table: string, data: Item) => Promise<void>>(
      async () => {},
    ),
    close = vi.fn(),
    onCreated = vi.fn(),
    onExisting = vi.fn()
  const workspace = demoData()
  workspace.label_templates = [
    {
      ...blankLabel(),
      id: 'resale-template',
      name: 'Resale master',
      recordKind: 'template',
    },
  ]
  workspace.products.push({
    id: 'resale-mug',
    name: 'Blue mug',
    variant: 'Small',
    workflow: 'resale',
    quantity: 4,
    cost: 2,
  })
  render(
    <AddItemDialog
      workspace={workspace}
      initialType={initialType}
      onWorkspace={vi.fn()}
      save={save}
      close={close}
      onCreated={onCreated}
      onExisting={onExisting}
    />,
  )
  return { save, close, onCreated, onExisting, user: userEvent.setup() }
}
it('uses a one-yard reference when creating fabric from a receipt without receiving stock early', async () => {
  const save = vi.fn(async () => {})
  const user = userEvent.setup()
  render(
    <AddItemDialog
      workspace={demoData()}
      initialType="material"
      initialName="Receipt cotton"
      receiptLine
      onWorkspace={vi.fn()}
      save={save}
      close={vi.fn()}
    />,
  )
  await user.selectOptions(screen.getByLabelText('Material Subtype'), 'fabric')
  await user.click(screen.getByRole('tab', { name: 'Fabric' }))
  fireEvent.change(screen.getByLabelText('Fabric width'), {
    target: { value: '44' },
  })
  await user.click(
    screen.getByRole('tab', { name: 'Purchase & Stock' }),
  )
  await user.selectOptions(screen.getByLabelText('Purchase unit'), 'yd')
  fireEvent.change(screen.getByLabelText('Cost per yd'), {
    target: { value: '2.99' },
  })
  expect(screen.getByText('Purchase quantity: 1 yd.')).toBeVisible()
  expect(
    screen.queryByLabelText('Amount in each package'),
  ).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Opening count')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Expiry (optional)')).not.toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'Save item' }),
  )
  expect(save).toHaveBeenCalledWith(
    'ingredients',
    expect.objectContaining({
      inventoryPackageSetup: true,
      initialStock: false,
      amountPerPackage: 1,
      purchaseUnit: 'yd',
      packagePrice: '2.99',
    }),
  )
})

it.each(itemTypes)(
  'creates %s without a receipt and keeps Item Type as the first field',
  async (type) => {
    const catalog = ['ingredient', 'packaging', 'supply'].includes(type)
    if (catalog)
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({
            version: 1,
            results: [],
            notice: 'No confirmed product match.',
          }),
        ),
      )
    const { save, user } = start(type)
    expect(
      screen.getByRole('dialog').querySelector('input,select,textarea'),
    ).toBe(screen.getByLabelText('Item Type'))
    if (!catalog) {
      expect(screen.getByLabelText('Product URL')).not.toBeVisible()
      await user.click(screen.getByRole('button', { name: 'URL' }))
    }
    expect(screen.getByLabelText('Product URL')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Paste product text instead' }),
    ).toBeVisible()
    if (!catalog)
      await user.click(screen.getByRole('button', { name: 'Barcode' }))
    fireEvent.change(screen.getByLabelText('Scan or enter barcode'), {
      target: { value: '000000123456' },
    })
    await user.click(
      screen.getByRole('button', {
        name: catalog ? 'Look up barcode' : 'Search this Oven',
      }),
    )
    if (catalog)
      expect(
        await screen.findByText('No confirmed product match.'),
      ).toBeVisible()
    else expect(screen.getByText(/No saved inventory match/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('Item name'), {
      target: { value: 'New item' },
    })
    await user.click(screen.getByRole('button', { name: 'Save item' }))
    expect(save).toHaveBeenCalledWith(
      type === 'resale' ? 'products' : 'ingredients',
      expect.objectContaining({
        usedAs: type,
        initialStock: false,
        name: 'New item',
        barcode: '000000123456',
      }),
    )
  },
)
it('requires a choice in a generic entry and defaults inventory tabs', () => {
  start('Supplies')
  expect(screen.getByLabelText('Item Type')).toHaveValue('supply')
})
it('preserves separate fabric and yarn drafts with no food requirements', async () => {
  const { user, save } = start('material')
  await user.selectOptions(screen.getByLabelText('Material Subtype'), 'fabric')
  fireEvent.change(screen.getByLabelText('Item name'), {
    target: { value: 'Cotton' },
  })
  fireEvent.change(screen.getByLabelText('Fabric width'), {
    target: { value: '44' },
  })
  await user.selectOptions(screen.getByLabelText('Material Subtype'), 'yarn')
  expect(screen.queryByLabelText('Fabric width')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Yarn length'), {
    target: { value: '200' },
  })
  await user.selectOptions(screen.getByLabelText('Material Subtype'), 'fabric')
  expect(screen.getByLabelText('Fabric width')).toHaveValue('44')
  expect(screen.getByLabelText('Stock unit')).toHaveValue('yd')
  await user.selectOptions(screen.getByLabelText('Material Subtype'), 'yarn')
  expect(screen.getByLabelText('Yarn length')).toHaveValue('200')
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  expect(save.mock.calls[0][1]).not.toHaveProperty('fabricWidth')
})
it('selects existing resale variants without creating duplicate products', async () => {
  const { save, user, onCreated, onExisting } = start('resale')
  await user.selectOptions(
    screen.getByLabelText('Resale product / variant'),
    'resale-mug',
  )
  await user.click(screen.getByRole('button', { name: 'Use existing product' }))
  expect(save).not.toHaveBeenCalled()
  expect(onCreated).toHaveBeenCalledWith('resale-mug', 'products')
  expect(onExisting).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'resale-mug' }),
  )
})
it('creates a resale product without template assignment or automatically creating labels', async () => {
  const { save, user } = start('resale')
  fireEvent.change(screen.getByLabelText('Item name'), {
    target: { value: 'Local honey' },
  })
  await user.click(screen.getByRole('tab', { name: 'Images & Labels' }))
  expect(
    screen.getByRole('region', { name: 'Linked labels' }),
  ).toHaveTextContent('No linked labels.')
  expect(screen.queryByLabelText('Label template')).not.toBeInTheDocument()
  expect(save).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  expect(save).toHaveBeenCalledWith(
    'products',
    expect.objectContaining({ initialStock: false, openingCount: '' }),
  )
  const payload = save.mock.calls[0][1]
  expect(payload).not.toHaveProperty('labelDesignId')
  expect(payload).not.toHaveProperty('labelAssignmentEdited')
})
it('shows resale food details only after explicit food classification', async () => {
  const { user } = start('resale')
  expect(
    screen.queryByLabelText('Ingredient statement'),
  ).not.toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Food classification'), 'food')
  await user.click(screen.getByRole('tab', { name: 'Ingredients & allergens' }))
  expect(screen.getByLabelText('Ingredient statement')).toBeVisible()
})
it('warns before discarding a dirty draft and retains it when cancellation is declined', async () => {
  const { user, close } = start('ingredient')
  const confirm = vi.fn(() => false)
  vi.stubGlobal('confirm', confirm)
  fireEvent.change(screen.getByLabelText('Item name'), {
    target: { value: 'Keep edits' },
  })
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(confirm).toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})
it.each(itemTypes)(
  'reviews and applies URL import for %s without overwriting manual name or type',
  async (type) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          products: [
            {
              title: 'Imported title',
              fields: { name: 'Imported title', brand: 'Supplier brand' },
              imageUrl: '',
              sourceUrl: 'https://example.org/item',
              checkedAt: '2026-11-04T00:00:00Z',
              warnings: [],
              conditions: [],
            },
          ],
        }),
      ),
    )
    vi.stubGlobal('innerHeight', 450)
    const { user } = start(type)
    const modal = screen.getByRole('dialog')
    expect(modal).toHaveAttribute('data-presentation', 'detail')
    fireEvent.change(screen.getByLabelText('Item name'), {
      target: { value: 'Manual name' },
    })
    if (!['ingredient', 'packaging', 'supply'].includes(type))
      await user.click(screen.getByRole('button', { name: 'URL' }))
    fireEvent.change(screen.getByLabelText('Product URL'), {
      target: { value: 'https://example.org/item' },
    })
    await user.click(screen.getByRole('button', { name: 'Import details' }))
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Brand' })).toBeVisible(),
    )
    if (
      !(screen.getByRole('checkbox', { name: 'Brand' }) as HTMLInputElement)
        .checked
    )
      await user.click(screen.getByRole('checkbox', { name: 'Brand' }))
    await user.click(
      screen.getByRole('button', { name: 'Apply selected values' }),
    )
    expect(screen.getByLabelText('Brand')).toHaveValue('Supplier brand')
    expect(screen.getByLabelText('Item name')).toHaveValue('Manual name')
    expect(screen.getByLabelText('Item Type')).toHaveValue(type)
    expect(screen.getByRole('dialog')).toBe(modal)
    expect(modal).toHaveAttribute('data-presentation', 'detail')
  },
)

it('preserves edits across tabs and opens a hidden invalid field on Save', async () => {
  const { user, save } = start('material')
  await user.selectOptions(screen.getByLabelText('Material Subtype'), 'fabric')
  fireEvent.change(screen.getByLabelText('Item name'), {
    target: { value: 'Cotton remnant' },
  })
  await user.click(screen.getByRole('tab', { name: 'More' }))
  fireEvent.change(screen.getByLabelText('SKU', { exact: true }), {
    target: { value: 'COT-44' },
  })
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('tab', { name: /Fabric/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await waitFor(() =>
    expect(screen.getByLabelText('Fabric width')).toHaveFocus(),
  )
  fireEvent.change(screen.getByLabelText('Fabric width'), {
    target: { value: '44' },
  })
  await user.click(screen.getByRole('tab', { name: 'Details' }))
  expect(screen.getByLabelText('Item name')).toHaveValue('Cotton remnant')
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  expect(save).toHaveBeenCalledWith(
    'ingredients',
    expect.objectContaining({
      name: 'Cotton remnant',
      fabricWidth: '44',
      sku: 'COT-44',
    }),
  )
})
it('keeps package costing and an opening count while navigating away from stock', async () => {
  const { user, save } = start('packaging')
  fireEvent.change(screen.getByLabelText('Item name'), {
    target: { value: 'Window boxes' },
  })
  await user.click(screen.getByRole('tab', { name: 'Purchase & Stock' }))
  await user.selectOptions(screen.getByLabelText('Purchase unit'), 'case')
  fireEvent.change(screen.getByLabelText('Amount in each package'), {
    target: { value: '24' },
  })
  fireEvent.change(screen.getByLabelText('Cost per package'), {
    target: { value: '9.375' },
  })
  await user.click(screen.getByLabelText('Add what I already have on hand'))
  fireEvent.change(screen.getByLabelText('Opening count'), {
    target: { value: '2' },
  })
  await user.selectOptions(screen.getByLabelText('Count unit'), 'case')
  fireEvent.change(screen.getByLabelText('Inventory as of'), {
    target: { value: '2026-11-03' },
  })
  expect(screen.getByText('You’re adding 48 each to stock.')).toBeVisible()
  expect(
    screen.getByText('Suggested opening stock value: $18.75'),
  ).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'More' }))
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  expect(save).toHaveBeenCalledWith(
    'ingredients',
    expect.objectContaining({
      inventoryPackageSetup: true,
      initialStock: true,
      openingCount: '2',
      openingCountUnit: 'case',
      amountPerPackage: '24',
      packagePrice: '9.375',
      receivedDate: '2026-11-03',
      purchaseUnit: 'case',
      unit: 'each',
    }),
  )
})
it('uses resale sellable units with an independent package or stock count', async () => {
  const { save, user } = start('resale')
  fireEvent.change(screen.getByLabelText('Item name'), {
    target: { value: 'Sparkling water 15 pack' },
  })
  await user.click(screen.getByRole('tab', { name: 'Purchase & Stock' }))
  expect(
    screen.queryByLabelText('Add opening stock / record a purchase now.'),
  ).not.toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Sellable unit'), 'bottle')
  expect(screen.getByText(/describes what is inside/)).toBeVisible()
  await user.selectOptions(screen.getByLabelText('Purchase unit'), 'case')
  fireEvent.change(screen.getByLabelText('Amount in each package'), {
    target: { value: '15' },
  })
  fireEvent.change(screen.getByLabelText('Cost per package'), {
    target: { value: '7.5' },
  })
  await user.click(screen.getByLabelText('Add what I already have on hand'))
  fireEvent.change(screen.getByLabelText('Opening count'), {
    target: { value: '1' },
  })
  await user.selectOptions(screen.getByLabelText('Count unit'), 'case')
  expect(screen.getByText('You’re adding 15 each to stock.')).toBeVisible()
  // Count the 15 packaged bottles and 2 loose ones directly in stock units.
  await user.selectOptions(screen.getByLabelText('Count unit'), 'each')
  fireEvent.change(screen.getByLabelText('Opening count'), {
    target: { value: '17' },
  })
  expect(screen.getByText('Suggested opening stock value: $8.50')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'More' }))
  await user.click(screen.getByRole('tab', { name: 'Purchase & Stock' }))
  expect(screen.getByLabelText('Cost per package')).toHaveValue(7.5)
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  expect(save).toHaveBeenCalledWith(
    'products',
    expect.objectContaining({
      inventoryPackageSetup: true,
      initialStock: true,
      sellUnit: 'bottle',
      openingCount: '17',
      openingCountUnit: 'each',
      amountPerPackage: '15',
      purchaseUnit: 'case',
    }),
  )
})
it('explains unknown opening cost instead of saving it as zero', async () => {
  const { save, user } = start('resale')
  fireEvent.change(screen.getByLabelText('Item name'), {
    target: { value: 'Jam' },
  })
  await user.click(screen.getByRole('tab', { name: 'Purchase & Stock' }))
  await user.selectOptions(screen.getByLabelText('Sellable unit'), 'jar')
  await user.click(screen.getByLabelText('Add what I already have on hand'))
  fireEvent.change(screen.getByLabelText('Opening count'), {
    target: { value: '5' },
  })
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Missing cost is not zero',
  )
  await user.click(screen.getByLabelText('Add what I already have on hand'))
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  expect(save).toHaveBeenCalledWith(
    'products',
    expect.objectContaining({ initialStock: false }),
  )
})
it('keeps sealed resale packs as sellable items and retries with the same request', async () => {
  const { save, user } = start('resale')
  save.mockRejectedValueOnce(new Error('Network unavailable'))
  fireEvent.change(screen.getByLabelText('Item name'), {
    target: { value: 'Cola' },
  })
  await user.click(screen.getByRole('tab', { name: 'Purchase & Stock' }))
  await user.selectOptions(
    screen.getByLabelText('Sellable unit'),
    'sealed pack',
  )
  fireEvent.change(
    screen.getByLabelText('What’s inside one sealed pack? (optional)'),
    { target: { value: '15 bottles' } },
  )
  expect(
    screen.queryByLabelText(/Record a new purchase/),
  ).not.toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Purchase unit'), 'case')
  fireEvent.change(screen.getByLabelText('Amount in each package'), {
    target: { value: '4' },
  })
  fireEvent.change(screen.getByLabelText('Cost per package'), {
    target: { value: '20' },
  })
  await user.click(screen.getByLabelText('Add what I already have on hand'))
  fireEvent.change(screen.getByLabelText('Opening count'), {
    target: { value: '2' },
  })
  await user.selectOptions(screen.getByLabelText('Count unit'), 'case')
  expect(screen.getByText('You’re adding 8 each to stock.')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  await screen.findByText('Network unavailable')
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(save.mock.calls[0][1]).toEqual(save.mock.calls[1][1])
  expect(save.mock.calls[1][1]).toMatchObject({
    initialStock: true,
    stockAction: 'opening',
    purchaseUnit: 'case',
    amountPerPackage: '4',
    sellUnit: 'sealed pack',
  })
})

async function ingredientBag() {
  const result = start('ingredient')
  fireEvent.change(screen.getByLabelText('Item name'), {
    target: { value: 'Example flour' },
  })
  await result.user.click(screen.getByRole('tab', { name: 'Purchase & Stock' }))
  await result.user.selectOptions(screen.getByLabelText('Purchase unit'), 'bag')
  fireEvent.change(screen.getByLabelText('Cost per package'), {
    target: { value: '3' },
  })
  await result.user.selectOptions(screen.getByLabelText('Stock unit'), 'lb')
  fireEvent.change(screen.getByLabelText('Amount in each package'), {
    target: { value: '2' },
  })
  return result
}

it('shows an unopened bag as 2 lb and preserves the independent count through tabs and retries', async () => {
  const { user, save, close } = await ingredientBag()
  expect(screen.getByText('1 bag = 2 lb')).toBeVisible()
  expect(screen.getByText('Cost per lb: $1.50')).toBeVisible()
  expect(
    screen.queryByText('Add opening stock / record a purchase now.'),
  ).not.toBeInTheDocument()
  await user.click(screen.getByLabelText('Add what I already have on hand'))
  fireEvent.change(screen.getByLabelText('Opening count'), {
    target: { value: '1' },
  })
  await user.selectOptions(screen.getByLabelText('Count unit'), 'bag')
  expect(screen.getByText('You’re adding 2 lb to stock.')).toBeVisible()
  expect(screen.getByText('Suggested opening stock value: $3.00')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Details' }))
  await user.click(screen.getByRole('tab', { name: 'Purchase & Stock' }))
  expect(screen.getByLabelText('Opening count')).toHaveValue(1)
  expect(screen.getByLabelText('Count unit')).toHaveValue('bag')
  expect(screen.getByLabelText('Stock unit')).toHaveValue('lb')
  save.mockRejectedValueOnce(new Error('Connection interrupted'))
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  expect(close).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  expect(save.mock.calls[1][1]).toEqual(save.mock.calls[0][1])
  expect(save.mock.calls[1][1]).toMatchObject({
    inventoryPackageSetup: true,
    stockAction: 'opening',
    openingCount: '1',
    openingCountUnit: 'bag',
    unit: 'lb',
    purchaseUnit: 'bag',
    packagePrice: '3',
  })
  expect(close).toHaveBeenCalledOnce()
})

it('counts remaining stock in lb without changing package units and makes valuation optional', async () => {
  const { user, save } = await ingredientBag()
  await user.click(screen.getByLabelText('Add what I already have on hand'))
  fireEvent.change(screen.getByLabelText('Opening count'), {
    target: { value: '1' },
  })
  await user.selectOptions(screen.getByLabelText('Count unit'), 'lb')
  expect(screen.getByText('You’re adding 1 lb to stock.')).toBeVisible()
  expect(screen.getByText('Suggested opening stock value: $1.50')).toBeVisible()
  expect(
    screen.queryByLabelText('Opening stock value override'),
  ).not.toBeInTheDocument()
  expect(screen.getByLabelText('Purchase unit')).toHaveValue('bag')
  expect(screen.getByLabelText('Stock unit')).toHaveValue('lb')
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  expect(save.mock.calls[0][1]).toMatchObject({
    openingCountUnit: 'lb',
    openingCount: '1',
    purchaseUnit: 'bag',
    amountPerPackage: '2',
  })
})

it('saves ingredient details and package cost without adding stock, retaining a disabled opening draft', async () => {
  const { user, save } = await ingredientBag()
  await user.click(screen.getByLabelText('Add what I already have on hand'))
  fireEvent.change(screen.getByLabelText('Opening count'), {
    target: { value: '0.5' },
  })
  await user.selectOptions(screen.getByLabelText('Count unit'), 'bag')
  expect(screen.getByText('You’re adding 1 lb to stock.')).toBeVisible()
  await user.click(screen.getByLabelText('Add what I already have on hand'))
  expect(screen.queryByLabelText('Opening count')).not.toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'More' }))
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  expect(save.mock.calls[0][1]).toMatchObject({
    inventoryPackageSetup: true,
    initialStock: false,
    packagePrice: '3',
    amountPerPackage: '2',
  })
})

it('keeps ingredient lookups together and allows manual entry with neither lookup filled', async () => {
  const { user, save } = start('ingredient')
  expect(
    screen.queryByRole('group', { name: 'Entry method' }),
  ).not.toBeInTheDocument()
  expect(screen.getByLabelText('Product URL')).toBeVisible()
  expect(screen.getByLabelText('Scan or enter barcode')).toBeVisible()
  expect(screen.getByLabelText('Item name')).toBeVisible()
  fireEvent.change(screen.getByLabelText('Item name'), {
    target: { value: 'Manual flour' },
  })
  await user.click(screen.getByRole('button', { name: 'Save item' }))
  expect(save).toHaveBeenCalledWith(
    'ingredients',
    expect.objectContaining({
      name: 'Manual flour',
      barcode: '',
      initialStock: false,
    }),
  )
})

it('keeps manual editing and barcode lookup available during and after a failed URL lookup', async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.includes('catalog')
        ? Promise.resolve(
            Response.json({
              version: 1,
              results: [],
              notice: 'No product match.',
            }),
          )
        : new Promise<Response>((resolve) => {
            finish = resolve
          }),
    ),
  )
  const { user, save, close } = start('ingredient')
  const modal = screen.getByRole('dialog')
  fireEvent.change(screen.getByLabelText('Product URL'), {
    target: { value: 'https://example.org/unavailable' },
  })
  await user.click(screen.getByRole('button', { name: 'Import details' }))
  expect(screen.getByText('Reading product details…')).toBeVisible()
  expect(screen.getByLabelText('Item name')).toBeEnabled()
  fireEvent.change(screen.getByLabelText('Item name'), {
    target: { value: 'Keep this draft' },
  })
  fireEvent.change(screen.getByLabelText('Scan or enter barcode'), {
    target: { value: '000000123456' },
  })
  await user.click(screen.getByRole('button', { name: 'Look up barcode' }))
  finish(Response.json({ error: 'Lookup unavailable' }, { status: 503 }))
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Lookup unavailable'),
  )
  expect(screen.getByLabelText('Item name')).toHaveValue('Keep this draft')
  expect(screen.getByLabelText('Item name')).toBeEnabled()
  expect(screen.getByLabelText('Product URL')).toBeVisible()
  expect(screen.getByLabelText('Scan or enter barcode')).toHaveValue(
    '000000123456',
  )
  expect(screen.getByRole('dialog')).toBe(modal)
  expect(save).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})
