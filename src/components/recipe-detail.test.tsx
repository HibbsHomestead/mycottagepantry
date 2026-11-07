import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { RecipeDetail } from './recipe-detail'
import { bestCrumbleSource } from '../test/fixtures/best-crumble'
import { parseRecipeText, recipeMethod } from '@/lib/recipe-import'
const r = {
  id: 'r',
  name: 'Bread',
  yield: 4,
  yieldUnit: 'loaves',
  lines: [{ ingredientId: 'f', quantity: 1200, unit: 'g' }],
  instructions: '1. Mix.\n2. Bake.',
}
const w = {
  recipes: [r, { ...r, id: 'other', name: 'Other bread' }],
  ingredients: [{ id: 'f', name: 'Flour', unit: 'g', cost: 11.28 / 1200 }],
  products: [
    { id: 'p', name: 'Existing loaf', sku: 'B001', price: 8, unpacked: true },
  ],
  graphic_assets: [],
}
function props() {
  return {
    recipe: r,
    workspace: structuredClone(w),
    ready: true,
    canEdit: true,
    open: vi.fn(),
    close: vi.fn(),
    save: vi.fn(async () => {}),
  }
}
it('keeps real amounts, singular units, ingredients and instructions while collapsing details', () => {
  render(<RecipeDetail {...props()} />)
  expect(
    screen.getAllByText('$11.28').some((el) => el.closest('.recipe-summary')),
  ).toBe(true)
  expect(screen.getAllByText('Cost per loaf')[0]).toBeVisible()
  expect(screen.getByText('1,200 g')).toBeVisible()
  expect(screen.getByText('1. Mix. 2. Bake.')).toBeVisible()
  expect(
    screen.getByText('Cost breakdown').closest('details'),
  ).not.toHaveAttribute('open')
})
it('requires review and a mapping before linking; cancel creates nothing', async () => {
  const p = props(),
    user = userEvent.setup()
  render(<RecipeDetail {...p} />)
  await user.click(screen.getByRole('button', { name: 'Add product' }))
  await user.click(
    screen.getByRole('menuitem', { name: 'Link existing product' }),
  )
  await user.type(
    screen.getByLabelText('Search products by name or SKU'),
    'B001',
  )
  await user.click(screen.getByRole('button', { name: /Existing loaf/ }))
  expect(screen.getByRole('button', { name: 'Confirm link' })).toBeDisabled()
  await user.type(screen.getByLabelText(/Product selling unit/), 'loaf')
  await user.type(screen.getByLabelText(/Recipe output quantity/), '1')
  await user.click(screen.getByLabelText(/I verified this output/))
  await user.click(screen.getByRole('button', { name: 'Confirm link' }))
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      productId: 'p',
      recipeId: 'r',
      outputQuantity: '1',
      mappingConfirmed: true,
    }),
  )
  expect(p.open).not.toHaveBeenCalled()
})
it('shows conflicts before replacement and permits cancelling without saving', async () => {
  const p = props()
  ;(p.workspace.products[0] as any).recipeId = 'other'
  const user = userEvent.setup()
  render(<RecipeDetail {...p} />)
  await user.click(screen.getByRole('button', { name: 'Add product' }))
  await user.click(
    screen.getByRole('menuitem', { name: 'Link existing product' }),
  )
  await user.click(screen.getByRole('button', { name: /Existing loaf/ }))
  expect(screen.getByLabelText(/Replace Other bread/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(p.save).not.toHaveBeenCalled()
  expect(screen.getByText('No products linked yet.')).toBeVisible()
})
it('keeps incomplete cost warnings visible outside the disclosure', () => {
  const p = props()
  ;(p.workspace.ingredients[0] as any).needsCostSetup = true
  render(<RecipeDetail {...p} />)
  expect(screen.getByRole('alert')).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('Cost incomplete')
})
it('keeps new-product creation as an unsaved secondary flow', async () => {
  const p = props()
  render(<RecipeDetail {...p} />)
  await userEvent.click(screen.getByRole('button', { name: 'Add product' }))
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Create new product' }),
  )
  expect(p.open).toHaveBeenCalledWith(
    'product',
    expect.objectContaining({ id: '', recipeId: 'r' }),
  )
  expect(p.save).not.toHaveBeenCalled()
})
it('requires unlink confirmation and prevents duplicate submissions', async () => {
  const p = props()
  Object.assign(p.workspace.products[0], {
    recipeId: 'r',
    unitsPerPackage: 1,
    sellingUnit: 'loaf',
  })
  let resolve!: () => void
  p.save = vi.fn(
    () =>
      new Promise<void>((r) => {
        resolve = r
      }),
  )
  render(<RecipeDetail {...p} />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Options for Existing loaf' }),
  )
  await userEvent.click(screen.getByRole('menuitem', { name: 'Unlink' }))
  expect(p.save).not.toHaveBeenCalled()
  expect(screen.getByText(/Neither record is deleted/)).toBeVisible()
  await userEvent.dblClick(
    screen.getByRole('button', { name: 'Confirm unlink' }),
  )
  expect(p.save).toHaveBeenCalledTimes(1)
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: 'unlink',
      productId: 'p',
      recipeId: 'r',
    }),
  )
  resolve()
})

it('keeps product actions in accessible menus and opens products by name', async () => {
  const p = props(),
    user = userEvent.setup()
  Object.assign(p.workspace.products[0], {
    recipeId: 'r',
    unitsPerPackage: 1,
  })
  render(<RecipeDetail {...p} />)
  expect(screen.getByText('1 loaf per sellable package')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Product options' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Open product' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Existing loaf' }))
  expect(p.open).toHaveBeenCalledWith('product-detail', p.workspace.products[0])
  const options = screen.getByRole('button', {
    name: 'Options for Existing loaf',
  })
  options.focus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('menuitem', { name: 'Manage link' })).toHaveFocus()
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: 'Unlink' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(options).toHaveFocus()
  const add = screen.getByRole('button', { name: 'Add product' })
  add.focus()
  await user.keyboard('{Enter}')
  expect(
    screen.getByRole('menuitem', { name: 'Link existing product' }),
  ).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.getByLabelText('Search products by name or SKU')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(p.close).toHaveBeenCalledTimes(1)
  expect(p.save).not.toHaveBeenCalled()
})
it.each([
  [1, 'cookies', '1 cookie'],
  [2, 'loaves', '2 loaves'],
  [1, 'kg', '1 kg'],
])(
  'formats %s %s in the mapping without altering saved values',
  (quantity, unit, expected) => {
    const p = props()
    p.recipe = { ...r, yieldUnit: unit }
    Object.assign(p.workspace.products[0], {
      recipeId: 'r',
      unitsPerPackage: quantity,
    })
    render(<RecipeDetail {...p} />)
    expect(screen.getByText(`${expected} per sellable package`)).toBeVisible()
    expect(p.workspace.products[0]).toMatchObject({ unitsPerPackage: quantity })
  },
)
it('displays the saved crumble method in order, keeps its heading and optional addition, and links its separate source URL', () => {
  const draft = parseRecipeText(bestCrumbleSource)
  const recipe = {
    ...r,
    name: draft.title,
    instructions: recipeMethod(draft),
    optionalAdditions: draft.optionalAdditions,
    sourceUrl: draft.sourceUrl,
  }
  const view = props()
  render(<RecipeDetail {...view} recipe={recipe} />)
  expect(
    screen.getByRole('heading', { name: 'Crumble topping:' }),
  ).toBeVisible()
  const method = screen
    .getByRole('heading', { name: 'Method' })
    .closest('section')!
  expect(
    within(method)
      .getAllByText(
        /Melt butter|In a medium bowl|Slowly pour|Evenly spread|Bake in the oven/,
      )
      .map((element) => element.textContent),
  ).toEqual(draft.instructions)
  const optional = screen.getByRole('region', { name: 'Optional additions' })
  expect(optional).toHaveTextContent('pecans, walnuts and/or oats')
  expect(optional).toHaveTextContent(
    'Excluded from required ingredient costing',
  )
  expect(
    screen.getByRole('link', { name: 'Open original recipe URL' }),
  ).toHaveAttribute('href', draft.sourceUrl)
})
