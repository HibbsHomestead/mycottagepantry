import { expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PantryInventory } from './pantry-inventory'
const ingredients = [
  {
    id: 'a',
    name: 'Small bag',
    category: 'Flour',
    usedAs: 'ingredient',
    unit: 'oz',
    quantity: 12,
    cost: 0.1,
    threshold: 1,
    barcode: '00123',
  },
  {
    id: 'b',
    name: 'Large bag',
    category: 'Flour',
    usedAs: 'ingredient',
    unit: 'lb',
    quantity: 2,
    cost: 1,
    threshold: 1,
    purchaseOffers: [{ barcode: '00456' }],
  },
]
it.each(['cards', 'table'] as const)(
  'renders missing shelf conversions in %s with saved nonzero quantities, costs and value',
  async (savedView) => {
    const user = userEvent.setup(),
      open = vi.fn()
    const item = {
      id: 'can',
      name: 'Canned ingredient',
      usedAs: 'ingredient',
      unit: 'each',
      storageUnit: 'can',
      quantity: 7,
      cost: 1.25,
      currentCost: 1.5,
      threshold: 2,
      conversions: [],
    }
    const snapshot = structuredClone(item)
    render(
      <PantryInventory
        ingredients={[item]}
        filter="Ingredients"
        setFilter={vi.fn()}
        search=""
        setSearch={vi.fn()}
        open={open}
        savedView={savedView}
      />,
    )
    const row =
      savedView === 'cards'
        ? screen.getByRole('article', { name: item.name })
        : screen.getAllByRole('row')[1]
    expect(row).toHaveTextContent(
      'A verified unit conversion from can to each is required.',
    )
    expect(row).toHaveTextContent('Showing saved quantities and costs in each.')
    expect(row).toHaveTextContent('7 each')
    expect(row).toHaveTextContent('$1.5')
    expect(row).toHaveTextContent('$8.75')
    expect(row).toHaveTextContent('2 each')
    await user.click(within(row).getByText(item.name, { exact: true }))
    expect(open).toHaveBeenCalledWith('ingredient-detail', item)
    expect(item).toEqual(snapshot)
  },
)
it.each(['cards', 'table'] as const)(
  'uses measured package contents in %s when a shelf conversion is verified',
  (savedView) => {
    render(
      <PantryInventory
        ingredients={[
          {
            id: 'can',
            name: 'Verified canned ingredient',
            usedAs: 'ingredient',
            unit: 'each',
            storageUnit: 'can',
            quantity: 6,
            cost: 1.25,
            currentCost: 1.5,
            threshold: 3,
            conversions: [
              {
                from: 'can',
                to: 'each',
                amountFrom: 1,
                amountTo: 3,
                verified: true,
              },
            ],
          },
        ]}
        filter="Ingredients"
        setFilter={vi.fn()}
        search=""
        setSearch={vi.fn()}
        open={vi.fn()}
        savedView={savedView}
      />,
    )
    const row =
      savedView === 'cards'
        ? screen.getByRole('article', { name: 'Verified canned ingredient' })
        : screen.getAllByRole('row')[1]
    expect(row).toHaveTextContent('2 can')
    expect(row).toHaveTextContent('$4.5')
    expect(row).toHaveTextContent('$7.50')
    expect(row).toHaveTextContent('1 can')
    expect(row).not.toHaveTextContent('verified unit conversion')
  },
)
it('searches default and package barcodes and retains filters', () => {
  const { rerender } = render(
    <PantryInventory
      ingredients={ingredients}
      filter="Ingredients"
      setFilter={vi.fn()}
      search="00456"
      setSearch={vi.fn()}
      open={vi.fn()}
    />,
  )
  expect(screen.getByText('Large bag')).toBeInTheDocument()
  expect(screen.queryByText('Small bag')).not.toBeInTheDocument()
  rerender(
    <PantryInventory
      ingredients={ingredients}
      filter="Ingredients"
      setFilter={vi.fn()}
      search="00123"
      setSearch={vi.fn()}
      open={vi.fn()}
    />,
  )
  expect(screen.getByText('Small bag')).toBeInTheDocument()
  expect(screen.queryByText('Large bag')).not.toBeInTheDocument()
})
it('sorts the filtered table by normalized quantities with accessible indicators', async () => {
  const user = userEvent.setup(),
    onSort = vi.fn()
  render(
    <PantryInventory
      savedView="table"
      ingredients={ingredients}
      filter="Ingredients"
      setFilter={vi.fn()}
      search="bag"
      setSearch={vi.fn()}
      open={vi.fn()}
      onSort={onSort}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'On hand' }))
  expect(onSort).toHaveBeenLastCalledWith({
    key: 'quantity',
    direction: 'asc',
  })
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Small bag')
  expect(screen.getByRole('columnheader', { name: 'On hand' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Sort by' }),
    'value',
  )
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Small bag')
  await user.click(
    screen.getByRole('button', { name: 'Reverse sort direction' }),
  )
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Large bag')
})
it('defaults to photo-first cards and preserves filtering and normalized sorting across views', async () => {
  const user = userEvent.setup(),
    open = vi.fn(),
    onView = vi.fn()
  const { container } = render(
    <PantryInventory
      ingredients={ingredients.map((i) => ({
        ...i,
        imageAssetId: i.id === 'a' ? 'photo' : undefined,
      }))}
      assets={[
        { id: 'photo', name: 'Bag photo', fileUrl: '/private/photo.png' },
      ]}
      filter="Ingredients"
      setFilter={vi.fn()}
      search="bag"
      setSearch={vi.fn()}
      open={open}
      onView={onView}
    />,
  )
  expect(screen.getByRole('button', { name: 'Cards' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByAltText('Photo of Small bag')).toHaveAttribute(
    'src',
    '/private/photo.png',
  )
  expect(
    screen.getByLabelText('ingredient icon for Large bag'),
  ).toBeInTheDocument()
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Sort by' }),
    'quantity',
  )
  expect(container.querySelectorAll('.pantry-card')[0]).toHaveAccessibleName(
    'Small bag',
  )
  await user.click(
    screen.getAllByRole('button', { name: 'Edit Ingredient' })[0],
  )
  expect(open).toHaveBeenLastCalledWith(
    'ingredient-edit',
    expect.objectContaining({ id: 'a' }),
  )
  open.mockClear()
  await user.click(
    screen.getByRole('button', { name: 'Actions for Small bag' }),
  )
  expect(open).not.toHaveBeenCalled()
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'Table' }))
  expect(onView).toHaveBeenLastCalledWith('table')
  expect(screen.getByRole('textbox', { name: 'Search pantry' })).toHaveValue(
    'bag',
  )
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Small bag')
  expect(screen.getByAltText('Photo of Small bag')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Cards' }))
  expect(container.querySelectorAll('.pantry-card')[0]).toHaveAccessibleName(
    'Small bag',
  )
})
