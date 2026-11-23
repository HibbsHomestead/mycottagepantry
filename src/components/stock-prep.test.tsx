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
  fireEvent.click(screen.getByRole('button', { name: 'Prep / portion stock' }))
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

it('shows calculated feedback, highlights implicated fields, and keeps the draft after failure', () => {
  const save = vi.fn(async () => {})
  render(
    <StockPrepPanel
      ingredient={ingredient}
      workspace={workspace}
      canEdit
      save={save}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Prep / portion stock' }))
  const dialog = within(screen.getByRole('dialog'))
  const review = dialog.getByRole('button', { name: 'Review prep' })
  fireEvent.click(review)
  expect(dialog.getByRole('alert')).toHaveTextContent('Source quantity')
  for (const [label, value] of [
    ['Quantity used (each)', '4'],
    ['Number of portions', '2'],
    ['Measured amount per portion (optional)', '4'],
    ['Preparation method', 'Frozen'],
    ['Destination storage location', 'Freezer'],
  ])
    fireEvent.change(dialog.getByLabelText(label), { target: { value } })
  fireEvent.click(review)
  expect(dialog.getByRole('alert')).toHaveTextContent(
    'Source: 4 each. 2 portions × 4 each = 8 each. Measured loss: 0 each. Difference: 4 each over the source after loss.',
  )
  for (const label of [
    /Quantity used/,
    /Number of portions/,
    /Measured amount/,
    /Portion unit/,
  ])
    expect(dialog.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true')
  expect(dialog.getByLabelText('Number of portions')).toHaveValue(2)
  fireEvent.change(dialog.getByLabelText('Portion unit'), {
    target: { value: 'cup' },
  })
  fireEvent.click(review)
  expect(dialog.getByRole('alert')).toHaveTextContent(
    'Choose a matching unit (each)',
  )
  expect(save).not.toHaveBeenCalled()
})

it('lets non-food stock allocate equal portions without food-only fields or a handling note', () => {
  const save = vi.fn(async () => {})
  render(
    <StockPrepPanel
      ingredient={{
        ...ingredient,
        name: 'Ribbon',
        usedAs: 'material',
        unit: 'yd',
      }}
      workspace={workspace}
      canEdit
      save={save}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Prep / portion stock' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.queryByLabelText(/Best-before/)).not.toBeInTheDocument()
  expect(
    dialog.getByLabelText('Preparation / handling (optional)'),
  ).not.toBeRequired()
  for (const [label, value] of [
    ['Quantity used (yd)', '4'],
    ['Number of portions', '2'],
    ['Destination storage location', 'Craft shelf'],
  ])
    fireEvent.change(dialog.getByLabelText(label), { target: { value } })
  fireEvent.click(dialog.getByRole('button', { name: 'Review prep' }))
  expect(
    dialog.getByText('2 × 2 yd allocated per portion · Craft shelf'),
  ).toBeVisible()
  expect(save).not.toHaveBeenCalled()
})

it('keeps the reviewed details and original values after a rejected save', async () => {
  const save = vi.fn(async () => {
    throw new Error('Stock changed since review.')
  })
  render(
    <StockPrepPanel
      ingredient={ingredient}
      workspace={workspace}
      canEdit
      save={save}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Prep / portion stock' }))
  const dialog = within(screen.getByRole('dialog'))
  for (const [label, value] of [
    ['Quantity used (each)', '4'],
    ['Number of portions', '2'],
    ['Preparation method', 'Frozen'],
    ['Destination storage location', 'Freezer'],
    ['Best-before (optional)', '2099-12-31'],
    ['Descriptive note (optional)', 'Fixture reference'],
  ])
    fireEvent.change(dialog.getByLabelText(label), { target: { value } })
  fireEvent.click(dialog.getByRole('button', { name: 'Review prep' }))
  fireEvent.click(dialog.getByRole('button', { name: 'Confirm prep' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent(
    'Stock changed since review.',
  )
  expect(dialog.getByText('Fixture reference')).toBeVisible()
  fireEvent.click(dialog.getByRole('button', { name: 'Edit details' }))
  expect(dialog.getByLabelText('Best-before (optional)')).toHaveValue(
    '2099-12-31',
  )
  expect(dialog.getByLabelText('Quantity used (each)')).toHaveValue(4)
  expect(save).toHaveBeenCalledTimes(1)
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
