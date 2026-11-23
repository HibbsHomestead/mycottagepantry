import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PrepStockSourceSelect, StockPrepPanel } from './stock-prep'

const ingredient = {
  id: 'bananas',
  name: 'Test bananas',
  unit: 'each',
  quantity: 18,
  cost: 0.5,
}
const workspace = { settings: [{ id: 'shop', name: 'Fixture' }], lots: [] }
afterEach(cleanup)

it('renders a count prep, previews without saving, and posts only from confirmation', async () => {
  const save = vi.fn(async () => {})
  render(
    <StockPrepPanel
      ingredient={ingredient}
      workspace={workspace}
      canEdit
      save={save}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Prep / Portion Stock' }))
  const dialog = within(screen.getByRole('dialog'))
  for (const [label, value] of [
    ['Quantity used (each)', '12'],
    ['Number of portions', '3'],
    ['Measured amount per portion (optional)', '4'],
    ['Preparation method', 'Portioned and frozen'],
    ['Destination storage location', 'Freezer'],
    ['Descriptive note (optional)', '4 bananas, approximately 2 cups'],
  ])
    fireEvent.change(dialog.getByLabelText(label), { target: { value } })
  fireEvent.click(dialog.getByRole('button', { name: 'Review prep' }))
  expect(dialog.getByText('3 × 4 each · Freezer')).toBeVisible()
  expect(dialog.getByText('$6.00')).toBeVisible()
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(dialog.getByRole('button', { name: 'Confirm prep' }))
  expect(await screen.findByRole('status')).toHaveTextContent(
    '3 portions in Freezer',
  )
  expect(save).toHaveBeenCalledWith(
    'stockPrepPost',
    expect.objectContaining({ id: 'bananas', review: expect.any(String) }),
  )
})

it('renders a freezer balance in recipe use and requires an explicit selection', () => {
  const change = vi.fn()
  render(
    <PrepStockSourceSelect
      ingredient={ingredient}
      lots={[
        {
          id: 'prep-test',
          name: 'Frozen',
          kind: 'ingredient_prep',
          ingredientId: ingredient.id,
          location: 'Freezer',
          date: '2026-01-01',
          quantity: 10,
          unit: 'each',
          unitCost: 0.5,
          balances: [2, 4, 4],
        },
      ]}
      change={change}
    />,
  )
  const select = screen.getByRole('combobox', {
    name: 'Stock source · Test bananas',
  })
  expect(select).toHaveValue('')
  expect(
    screen.getByRole('option', { name: /Freezer.*10 each remaining/ }),
  ).toBeInTheDocument()
  fireEvent.change(select, { target: { value: 'prep-test' } })
  expect(change).toHaveBeenCalledWith('prep-test')
})
