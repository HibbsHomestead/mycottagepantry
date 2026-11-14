import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Item } from '@/lib/domain'
import { demoData } from '@/lib/demo'
import { PantryInventory } from './pantry-inventory'
import { IngredientDetail } from './ingredient-detail'

const ready: Item = {
  id: 'ready',
  name: 'Ready flour',
  unit: 'g',
  usedAs: 'ingredient',
  quantity: 0,
  cost: 0.01,
  threshold: 2,
  purchaseQuantity: 1,
  purchaseUnit: 'kg',
  packagePrice: 10,
  conversions: [],
}
const imported: Item = {
  ...ready,
  id: 'imported',
  name: 'Imported sugar',
  importNeedsReview: true,
}
const missing: Item = {
  ...ready,
  id: 'missing',
  name: 'Incomplete oil',
  usedAs: 'supply',
  purchaseQuantity: null,
  purchaseUnit: '',
  packagePrice: null,
  currentCost: null,
  needsCostSetup: true,
}

it.each(['cards', 'table'] as const)(
  'counts items once, searches and updates %s results after saves and remounts',
  async (savedView) => {
    const user = userEvent.setup(),
      open = vi.fn()
    let saved = [ready, imported, missing]
    function Inventory() {
      const [items, setItems] = useState(saved),
        [filter, setFilter] = useState('All items'),
        [search, setSearch] = useState('')
      return (
        <>
          <PantryInventory
            ingredients={items}
            filter={filter}
            setFilter={setFilter}
            search={search}
            setSearch={setSearch}
            open={open}
            savedView={savedView}
            typeFilter="All items"
          />
          <button
            onClick={() => {
              saved = [
                ready,
                {
                  ...imported,
                  importNeedsReview: false,
                  importReviewedAt: '2026-11-14',
                },
                { ...ready, id: missing.id, name: missing.name },
              ]
              setItems(saved)
            }}
          >
            Apply saved fixes
          </button>
        </>
      )
    }
    const { unmount } = render(<Inventory />)
    await user.click(screen.getByRole('button', { name: 'Needs review (2)' }))
    expect(
      screen.queryByText('Ready flour', { exact: true }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Imported sugar', { exact: true })).toBeVisible()
    expect(screen.getByText('Incomplete oil', { exact: true })).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'Add cost information' }),
    )
    expect(open).toHaveBeenCalledWith(
      'ingredient-detail',
      expect.objectContaining({ id: missing.id, reviewSetup: 'cost' }),
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Search pantry' }),
      'sugar',
    )
    expect(
      screen.queryByText('Incomplete oil', { exact: true }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Needs review (2)' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await user.clear(screen.getByRole('textbox', { name: 'Search pantry' }))
    await user.click(screen.getByRole('button', { name: 'Apply saved fixes' }))
    expect(
      screen.getByRole('button', { name: 'Needs review (0)' }),
    ).toBeVisible()
    expect(screen.getByText('No items need review.')).toBeVisible()
    unmount()
    render(<Inventory />)
    await user.click(screen.getByRole('button', { name: 'Needs review (0)' }))
    expect(screen.getByText('No items need review.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /^Low stock/ }))
    expect(screen.getByText('Ready flour', { exact: true })).toBeVisible()
  },
)

it('opens the existing conversion editor directly from a review reason', () => {
  const workspace = demoData(),
    ingredient = { ...ready, recipeUnit: 'cup' }
  render(
    <IngredientDetail
      ingredient={ingredient}
      workspace={workspace}
      canEdit
      initialReviewSection="conversion"
      save={vi.fn()}
      open={vi.fn()}
      close={vi.fn()}
      onWorkspace={vi.fn()}
    />,
  )
  expect(
    screen.getByRole('heading', { name: 'Unit Conversions' }),
  ).toBeVisible()
  expect(screen.getByLabelText('From unit')).toBeVisible()
  expect(screen.getByLabelText('From unit')).toHaveFocus()
  expect(screen.getByLabelText('To unit')).toBeVisible()
})

it('marks only imported data reviewed and leaves missing setup visible; failed saves remain retryable', async () => {
  const workspace = demoData(),
    ingredient: Item = { ...missing, importNeedsReview: true, reviewed: false },
    user = userEvent.setup()
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error('Could not save review.'))
    .mockResolvedValueOnce(undefined)
  const props = {
    workspace,
    canEdit: true,
    save,
    open: vi.fn(),
    close: vi.fn(),
    onWorkspace: vi.fn(),
  }
  const { rerender } = render(
    <IngredientDetail ingredient={ingredient} {...props} />,
  )
  await user.click(screen.getByRole('button', { name: 'Mark reviewed' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save review.')
  expect(screen.getByRole('button', { name: 'Mark reviewed' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Mark reviewed' }))
  expect(save).toHaveBeenLastCalledWith('inventoryMarkReviewed', {
    id: ingredient.id,
    expectedUpdatedAt: undefined,
    confirmed: true,
  })
  rerender(
    <IngredientDetail
      ingredient={{
        ...ingredient,
        importNeedsReview: false,
        importReviewedAt: '2026-11-14',
      }}
      {...props}
    />,
  )
  const notice = screen.getByRole('region', { name: 'Item setup review' })
  expect(
    within(notice).getByRole('button', { name: 'Add purchase details' }),
  ).toBeVisible()
  expect(
    within(notice).getByRole('button', { name: 'Add cost information' }),
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Mark reviewed' }),
  ).not.toBeInTheDocument()
  expect(ingredient.quantity).toBe(0)
  expect(ingredient.reviewed).toBe(false)
})

it('shows reasons to readers without allowing review confirmation', () => {
  render(
    <IngredientDetail
      ingredient={imported}
      workspace={demoData()}
      canEdit={false}
      save={vi.fn()}
      open={vi.fn()}
      close={vi.fn()}
      onWorkspace={vi.fn()}
    />,
  )
  expect(screen.getByText('Review imported data')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Mark reviewed' }),
  ).not.toBeInTheDocument()
})
