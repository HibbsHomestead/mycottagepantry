import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { WorkspaceDashboard } from './workspace-dashboard'
import { demoData } from '@/lib/demo'
it('opens existing quick actions and shows source definitions without posting records', async () => {
  const user = userEvent.setup(),
    open = vi.fn(),
    go = vi.fn()
  render(
    <WorkspaceDashboard workspace={demoData()} open={open} go={go} canWrite />,
  )
  await user.click(screen.getByRole('button', { name: 'Add Item' }))
  expect(open).toHaveBeenCalledWith('ingredient')
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
