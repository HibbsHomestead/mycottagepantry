import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceDashboard } from './workspace-dashboard'
import { demoData } from '@/lib/demo'

afterEach(() => vi.unstubAllGlobals())
it('opens existing quick actions and shows source definitions without posting records', async () => {
  const user = userEvent.setup(),
    open = vi.fn(),
    go = vi.fn()
  render(
    <WorkspaceDashboard workspace={demoData()} open={open} go={go} canWrite />,
  )
  await user.click(screen.getByRole('button', { name: 'Add Item' }))
  expect(open).toHaveBeenCalledWith('ingredient')
  await user.click(screen.getByRole('button', { name: 'Add product' }))
  expect(open).toHaveBeenCalledWith('product')
  await user.click(screen.getByRole('button', { name: 'Start production' }))
  expect(open).toHaveBeenCalledWith('batch')
  await user.click(screen.getByRole('button', { name: 'Receive stock' }))
  expect(open).toHaveBeenCalledWith('receive-picker')
  await user.click(screen.getByRole('button', { name: 'Open Label Studio' }))
  expect(go).toHaveBeenCalledWith('Labels')
  expect(screen.getAllByText('How it’s counted')).toHaveLength(4)
})
it('shows empty history and preserves read-only access without mutation actions', () => {
  const w = demoData()
  w.ingredients = []
  w.sales = []
  w.expenses = []
  w.batches = []
  w.ledger = []
  render(<WorkspaceDashboard workspace={w} open={vi.fn()} go={vi.fn()} />)
  expect(
    screen.queryByRole('button', { name: 'Add Item' }),
  ).not.toBeInTheDocument()
  expect(screen.getByText(/No sales recorded this month/)).toBeInTheDocument()
  expect(
    screen.getByText(/No inventory movements recorded yet/),
  ).toBeInTheDocument()
  expect(
    screen.queryByLabelText('Sales by recorded date'),
  ).not.toBeInTheDocument()
})

it('names icon actions and supports keyboard activation and focus tooltips', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const user = userEvent.setup(),
    open = vi.fn()
  render(
    <WorkspaceDashboard
      workspace={demoData()}
      open={open}
      go={vi.fn()}
      canWrite
    />,
  )
  await user.tab() // Opening inventory link
  for (const name of [
    'Add Item',
    'Add product',
    'Receive stock',
    'Start production',
    'Open Label Studio',
  ]) {
    await user.tab()
    const button = screen.getByRole('button', { name })
    expect(button).toHaveFocus()
    expect(button.textContent).toBe('')
    expect(await screen.findByRole('tooltip')).toHaveTextContent(name)
    await user.keyboard('{Escape}')
  }
  screen.getByRole('button', { name: 'Add Item' }).focus()
  await user.keyboard('{Enter}')
  expect(open).toHaveBeenCalledWith('ingredient')
  screen.getByRole('button', { name: 'Add product' }).focus()
  await user.keyboard(' ')
  expect(open).toHaveBeenCalledWith('product')
})
