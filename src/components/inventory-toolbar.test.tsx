import { useState } from 'react'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { demoData } from '@/lib/demo'
import { InventoryTools } from './inventory-tools'
import { PantryInventory } from './pantry-inventory'
import { TooltipProvider } from './ui/tooltip'

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterAll(() => vi.unstubAllGlobals())

function fixture(role = 'Owner', savedView: 'cards' | 'table' = 'cards') {
  const workspace = demoData()
  workspace.ingredients = [
    {
      id: 'a',
      name: 'Olive oil',
      usedAs: 'ingredient',
      unit: 'ml',
      quantity: 3,
      threshold: 1,
      cost: 0.1,
      storageLocation: 'Shelf 1',
    },
    {
      id: 'b',
      name: 'Sunflower oil',
      usedAs: 'ingredient',
      unit: 'ml',
      quantity: 4,
      threshold: 1,
      cost: 0.1,
    },
    {
      id: 'c',
      name: 'Sugar',
      usedAs: 'ingredient',
      unit: 'g',
      quantity: 5,
      threshold: 1,
      cost: 0.1,
    },
  ]
  const mutate = vi.fn(),
    open = vi.fn(),
    refresh = vi.fn()
  function Inventory() {
    const [search, setSearch] = useState('oil')
    const [filter, setFilter] = useState('Ingredients')
    return (
      <TooltipProvider>
        <InventoryTools
          workspace={workspace}
          role={role}
          open={open}
          mutate={mutate}
          refresh={refresh}
        >
          {({ actions, labelSelection }) => (
            <PantryInventory
              ingredients={workspace.ingredients}
              typeFilter="Ingredients"
              filter={filter}
              setFilter={setFilter}
              search={search}
              setSearch={setSearch}
              open={open}
              savedView={savedView}
              actions={actions}
              labelSelection={labelSelection}
            />
          )}
        </InventoryTools>
      </TooltipProvider>
    )
  }
  render(<Inventory />)
  return { workspace, mutate, open }
}

it.each(['cards', 'table'] as const)(
  'selects the filtered %s results, preserves selection across views and uses the existing print options without stock writes',
  async (view) => {
    const user = userEvent.setup()
    const { workspace, mutate } = fixture('Owner', view)
    const before = structuredClone(workspace.ingredients)
    const shelf = () =>
      screen.getByRole('button', { name: /^Print shelf\/bin labels/ })
    expect(shelf()).toBeEnabled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(shelf())
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(
      screen.getByRole('button', { name: 'Print selected labels' }),
    ).toBeDisabled()
    await user.click(
      screen.getByRole('button', { name: 'Select all filtered items' }),
    )
    expect(shelf()).toHaveAccessibleName('Print shelf/bin labels (2)')
    await user.click(
      screen.getByRole('button', {
        name: view === 'cards' ? 'Table' : 'Cards',
      }),
    )
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(
      screen.getByRole('checkbox', {
        name: 'Select Olive oil for shelf/bin labels',
      }),
    ).toBeChecked()
    await user.clear(screen.getByRole('textbox', { name: 'Search pantry' }))
    expect(
      screen.getByRole('checkbox', {
        name: 'Select Sugar for shelf/bin labels',
      }),
    ).not.toBeChecked()
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Select Sunflower oil for shelf/bin labels',
      }),
    )
    expect(shelf()).toHaveAccessibleName('Print shelf/bin labels (1)')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Clear selection' }),
    ).not.toBeInTheDocument()
    await user.click(shelf())
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByLabelText('Copies per label (PDF)'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByLabelText('Media width (mm)'),
    ).toBeInTheDocument()
    expect(dialog.querySelectorAll('.shelf-label-preview > svg')).toHaveLength(
      1,
    )
    expect(dialog.querySelector('.shelf-label-preview')).toHaveTextContent(
      'Olive oil',
    )
    expect(dialog.querySelector('.shelf-label-preview')).not.toHaveTextContent(
      'Sunflower oil',
    )
    await user.keyboard('{Escape}')
    expect(
      screen.getByRole('checkbox', {
        name: 'Select Olive oil for shelf/bin labels',
      }),
    ).toBeChecked()
    expect(mutate).not.toHaveBeenCalled()
    expect(workspace.ingredients).toEqual(before)
  },
)

it('clears selection and re-enters selection mode through the enabled zero-count control', async () => {
  const user = userEvent.setup()
  fixture()
  await user.click(
    screen.getByRole('button', { name: 'Print shelf/bin labels (0)' }),
  )
  await user.click(
    screen.getByRole('button', { name: 'Select all filtered items' }),
  )
  await user.click(screen.getByRole('button', { name: 'Clear selection' }))
  expect(
    screen.getByRole('button', { name: 'Print selected labels' }),
  ).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Done' }))
  await user.click(
    screen.getByRole('button', { name: 'Print shelf/bin labels (0)' }),
  )
  expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('retains action permissions for read-only roles', async () => {
  const user = userEvent.setup()
  fixture('Read-only Accountant')
  expect(
    screen.queryByRole('button', { name: 'Scan to receive' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Rapid barcode counts' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Inventory count sessions' }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Scan barcode' })).toBeEnabled()
  await user.click(
    screen.getByRole('button', { name: 'Print shelf/bin labels (0)' }),
  )
  expect(
    screen.getByRole('button', { name: 'Select all filtered items' }),
  ).toBeEnabled()
})
