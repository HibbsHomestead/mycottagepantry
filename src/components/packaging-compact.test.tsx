import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { PackagingEditor } from './financial-editors'
import type { Item } from '@/lib/domain'

it('keeps independent secondary details and assignments while editing compact rows', async () => {
  const user = userEvent.setup(),
    changes = vi.fn()
  const items = [
    { id: 'bag', name: 'Window bag', usedAs: 'packaging', unit: 'each' },
    { id: 'seal', name: 'Olive seal', usedAs: 'packaging', unit: 'each' },
  ] as Item[]
  const initial = [
    {
      ingredientId: 'bag',
      quantity: 2,
      unit: 'each',
      required: false,
      notes: 'Keep dry',
    },
    { ingredientId: 'seal', quantity: 1, unit: 'each', required: true },
  ]
  function App() {
    const [lines, setLines] = useState(initial)
    return (
      <PackagingEditor
        product={{ id: 'product', name: 'Bread', packagingLines: lines }}
        ingredients={items}
        onChange={(next) => {
          changes(next)
          setLines(next)
        }}
      />
    )
  }
  const app = render(<App />)
  const rows = () =>
    [...app.container.querySelectorAll('.packaging-editor')] as HTMLElement[]
  expect(rows()).toHaveLength(2)
  expect(rows()[0].querySelector('details')).not.toHaveAttribute('open')
  expect(rows()[1].querySelector('details')).not.toHaveAttribute('open')
  expect(changes).not.toHaveBeenCalled()
  await user.click(within(rows()[0]).getByText('Details'))
  expect(within(rows()[0]).getByLabelText('Required')).not.toBeChecked()
  expect(within(rows()[0]).getByLabelText('Notes')).toHaveValue('Keep dry')
  await user.click(within(rows()[0]).getByLabelText('Required'))
  await user.click(within(rows()[0]).getByText('Details'))
  expect(changes.mock.lastCall![0][0]).toMatchObject({
    ...initial[0],
    required: true,
  })
  expect(rows()[1].querySelector('details')).not.toHaveAttribute('open')
  await user.click(
    within(rows()[1]).getByRole('button', { name: 'Packaging item' }),
  )
  await user.type(screen.getByLabelText('Search packaging items'), 'Window')
  await user.click(
    screen.getByRole('button', { name: 'Window bag' }),
  )
  expect(changes.mock.lastCall![0][1].ingredientId).toBe('bag')
  await user.click(screen.getByRole('button', { name: '+ Add packaging item' }))
  expect(rows()).toHaveLength(3)
  expect(
    within(rows()[2]).getByRole('button', { name: 'Packaging item' }),
  ).toHaveFocus()
  expect(changes.mock.lastCall![0][0].notes).toBe('Keep dry')
  await user.click(
    within(rows()[2]).getByRole('button', { name: 'Remove packaging item' }),
  )
  expect(rows()).toHaveLength(2)
})
