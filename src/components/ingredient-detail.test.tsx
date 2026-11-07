import { it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IngredientDetail } from './ingredient-detail'
import { demoData } from '@/lib/demo'
function props() {
  return {
    workspace: demoData(),
    canEdit: true,
    save: vi.fn(),
    close: vi.fn(),
    open: vi.fn(),
    onWorkspace: vi.fn(),
  }
}
it('groups ingredient details into Product Details cards in a portal modal and resets when another ingredient opens', async () => {
  const p = props(),
    user = userEvent.setup()
  const { container, rerender } = render(
    <IngredientDetail ingredient={p.workspace.ingredients[0]} {...p} />,
  )
  const modal = screen.getByRole('dialog')
  expect(container.contains(modal)).toBe(false)
  expect(modal).toHaveAttribute('data-presentation', 'modal')
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('navigation', { name: 'Ingredient sections' }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByText('Inventory', { selector: 'summary' }))
  expect(screen.getByRole('region', { name: 'Inventory' })).toBeVisible()
  await user.click(screen.getByText('Purchasing', { selector: 'summary' }))
  expect(
    screen.getByRole('region', { name: 'Purchase & costing' }),
  ).toBeVisible()
  expect(screen.getByRole('region', { name: 'Vendor quotes' })).toBeVisible()
  await user.click(
    screen.getByText('Label & ingredient details', { selector: 'summary' }),
  )
  expect(screen.getByRole('region', { name: 'Identification' })).toBeVisible()
  const content = modal.querySelector('.ingredient-detail-body')!
  content.scrollTop = 400
  rerender(<IngredientDetail ingredient={p.workspace.ingredients[1]} {...p} />)
  expect(content.scrollTop).toBe(0)
  await user.click(
    screen.getAllByRole('button', { name: 'Edit Ingredient' }).at(-1)!,
  )
  expect(screen.getByRole('heading', { name: 'Edit Ingredient' })).toBeVisible()
  expect(screen.getByLabelText('Name')).toHaveValue(
    p.workspace.ingredients[1].name,
  )
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Unsaved' },
  })
  await user.click(
    screen.getByRole('button', { name: 'Close ingredient details' }),
  )
  expect(screen.getByText('Discard unsaved changes?')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Keep editing' }))
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  expect(p.save).not.toHaveBeenCalled()
  expect(p.close).not.toHaveBeenCalled()
})
it('keeps missing purchase data blank, shows friendly inline validation, and saves the same ingredient', async () => {
  const p = props(),
    user = userEvent.setup(),
    ingredient = {
      ...p.workspace.ingredients[0],
      purchaseQuantity: undefined,
      packagePrice: undefined,
      purchaseUnit: undefined,
      barcode: '0012345',
    }
  render(<IngredientDetail ingredient={ingredient} {...p} />)
  expect(
    screen.getAllByText('Purchase package details not set.')[0],
  ).toBeVisible()
  expect(screen.queryByText(/Package quantity must/)).not.toBeInTheDocument()
  await user.click(
    screen.getByText('Label & ingredient details', { selector: 'summary' }),
  )
  expect(screen.getByText('Barcode: 0012345')).toBeVisible()

  await user.click(
    screen.getAllByRole('button', { name: 'Add purchase details' })[0],
  )
  expect(screen.getByLabelText('Purchasing package unit')).toHaveValue('')
  expect(screen.getByLabelText('Purchasing price')).toHaveValue(null)
  expect(
    screen.queryByLabelText('Purchase package quantity'),
  ).not.toBeInTheDocument()
  await user.selectOptions(
    screen.getByLabelText('Purchasing package unit'),
    'bag',
  )
  await user.selectOptions(screen.getByLabelText('Stock shelf unit'), 'lb')
  fireEvent.change(screen.getByLabelText('Purchasing price'), {
    target: { value: '10.95' },
  })
  fireEvent.change(
    screen.getByLabelText('# of stock units in purchasing unit'),
    {
      target: { value: '0' },
    },
  )
  expect(
    screen.getByText(/Stock units per package must be at least/),
  ).toBeVisible()
  await user.click(
    screen.getByRole('checkbox', { name: /I reviewed the saved basis/ }),
  )
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(p.save).not.toHaveBeenCalled()
  fireEvent.change(
    screen.getByLabelText('# of stock units in purchasing unit'),
    {
      target: { value: '25' },
    },
  )
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(p.save).toHaveBeenCalledWith(
    'ingredientUpdate',
    expect.objectContaining({
      id: ingredient.id,
      purchaseSetup: { packageUnit: 'bag', price: '10.95', stockUnits: '25' },
      purchaseSetupConfirmed: true,
      barcode: '0012345',
    }),
  )
  await user.click(screen.getByText('Purchasing', { selector: 'summary' }))
  expect(
    screen.getByRole('region', { name: 'Purchase & costing' }),
  ).toBeVisible()
})
it('keeps saved store comparisons and linked inventory/recipe actions in the same detail workflow', async () => {
  const p = props(),
    user = userEvent.setup(),
    base = p.workspace.ingredients[0]
  const ingredient = {
    ...base,
    storageUnit: 'lb',
    purchaseQuantity: 25,
    purchaseUnit: 'lb',
    packagePrice: 10.95,
    includesTax: false,
    includesShipping: false,
    purchaseOffers: [
      {
        id: 'offer',
        vendorId: p.workspace.vendors[0].id,
        vendor: 'Comparison store',
        purchaseQuantity: 10,
        purchaseUnit: 'lb',
        packagePrice: 4,
        currency: 'USD',
        includesTax: false,
        includesShipping: false,
        priceCheckedAt: '2026-10-30',
        source: 'manual',
        barcode: '000987',
      },
    ],
  }
  render(<IngredientDetail ingredient={ingredient} {...p} />)
  await user.click(screen.getByText('Purchasing', { selector: 'summary' }))
  expect(screen.getByText('Cheaper', { exact: true })).toBeVisible()

  await user.click(screen.getByText('Inventory', { selector: 'summary' }))
  await user.click(screen.getByRole('button', { name: 'Receive stock' }))
  expect(p.open).toHaveBeenLastCalledWith(
    'receive',
    expect.objectContaining({ id: base.id }),
  )
  await user.click(screen.getByRole('button', { name: 'Adjust stock' }))
  expect(p.open).toHaveBeenLastCalledWith(
    'adjust',
    expect.objectContaining({ id: base.id }),
  )
  const recipe = p.workspace.recipes.find((r) =>
    r.lines.some((l: any) => l.ingredientId === base.id),
  )!
  await user.click(screen.getByRole('button', { name: recipe.name }))
  expect(p.open).toHaveBeenLastCalledWith('recipe-detail', recipe)
  await user.click(screen.getByRole('button', { name: 'Edit offer' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByLabelText('Package barcode')).toHaveValue('000987')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(
    screen.getByRole('region', { name: 'Vendor quotes' }),
  ).toBeInTheDocument()
  expect(p.save).not.toHaveBeenCalled()
})
it('opens the same centered detail surface directly in populated edit mode', () => {
  const p = props(),
    ingredient = p.workspace.ingredients[0]
  render(<IngredientDetail ingredient={ingredient} initialEditing {...p} />)
  expect(screen.getByRole('dialog')).toHaveAttribute(
    'data-presentation',
    'detail',
  )
  expect(screen.getByLabelText('Name')).toHaveValue(ingredient.name)
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Close ingredient details' }),
  ).toBeVisible()
})
it.each([false, true])(
  'shows manual purchasing without search controls, setup warnings or automatic shopping requests (canEdit %s)',
  async (canEdit) => {
    const p = props(),
      user = userEvent.setup()
    const fetcher = vi.fn(async (_url: string) =>
      Response.json({ configured: false, status: 'Unavailable' }),
    )
    vi.stubGlobal('fetch', fetcher)
    try {
      render(
        <IngredientDetail
          ingredient={{ ...p.workspace.ingredients[0], purchaseOffers: [] }}
          {...p}
          canEdit={canEdit}
        />,
      )
      const hiddenSearch = () => {
        expect(
          screen.queryByText(
            /Compare store prices|Alternative stores & prices|SerpApi|SERPAPI_API_KEY|No alternative prices recorded|Find prices|Test shopping search/i,
          ),
        ).not.toBeInTheDocument()
      }
      hiddenSearch()
      await user.click(screen.getByText('Purchasing', { selector: 'summary' }))
      hiddenSearch()
      expect(
        screen.getByRole('region', { name: 'Purchase & costing' }),
      ).toBeVisible()
      expect(screen.getByText(/Price reference source:/)).toBeVisible()
      expect(
        screen.queryByRole('button', { name: 'Enter store price manually' }),
      ).toBe(
        canEdit
          ? screen.getByRole('button', { name: 'Enter store price manually' })
          : null,
      )
      if (canEdit) {
        await user.click(
          screen.getAllByRole('button', { name: 'Edit Ingredient' }).at(-1)!,
        )
        hiddenSearch()
        expect(screen.getByLabelText('Purchasing price')).toBeVisible()
        expect(
          screen.getByRole('button', { name: 'Import details' }),
        ).toBeVisible()
      }
      expect(
        fetcher.mock.calls.every(([url]) =>
          String(url).includes('assistant=1'),
        ),
      ).toBe(true)
      expect(p.save).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  },
)

it('adds a measured prep conversion in its dedicated tab without inventing a purchase package', async () => {
  const p = props(),
    user = userEvent.setup()
  const ingredient = {
    ...p.workspace.ingredients[0],
    id: 'prep-frosting',
    name: 'Frosting',
    compoundRecipeId: 'frosting',
    unit: 'g',
    storageUnit: 'g',
    recipeUnit: 'cup',
    purchaseUnit: undefined,
    purchaseQuantity: undefined,
    packageQuantity: undefined,
    packagePrice: undefined,
    conversions: [],
  }
  render(<IngredientDetail ingredient={ingredient} {...p} initialEditing />)
  await user.click(screen.getByRole('button', { name: 'Unit Conversions' }))
  await user.type(screen.getByLabelText('To quantity'), '100')
  await user.click(
    screen.getByRole('checkbox', { name: /I verified these amounts/ }),
  )
  await user.click(
    screen.getByRole('button', {
      name: 'Save ingredient conversion',
    }),
  )
  expect(screen.getByText(/1 US cup = 100 g/)).toBeVisible()
  expect(p.save).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(p.save).toHaveBeenCalledWith(
    'ingredientUpdate',
    expect.objectContaining({
      id: ingredient.id,
      purchaseSetup: { packageUnit: '', price: '', stockUnits: '' },
      conversions: [
        expect.objectContaining({
          from: 'cup',
          to: 'g',
          amountFrom: 1,
          amountTo: '100',
          verified: true,
        }),
      ],
    }),
  )
})
