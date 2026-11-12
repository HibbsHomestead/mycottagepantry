import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FinanceDashboard } from './finance-dashboard'
import { demoData } from '@/lib/demo'
afterEach(cleanup)
const props = () => ({
  workspace: demoData(),
  ready: false,
  canWrite: false,
  onAction: vi.fn(),
  onNavigate: vi.fn(),
  onReceipt: vi.fn(),
  onReconcile: vi.fn(),
})
it('shows request failure without claiming no records or rendering preview totals', () => {
  render(
    <FinanceDashboard {...props()} loadError="Connection failed" />,
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Connection failed',
  )
  expect(
    screen.queryByText(/No matching records/),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText('Recent financial records'),
  ).not.toBeInTheDocument()
})
it('shows loading separately from empty financial records', () => {
  render(<FinanceDashboard {...props()} />)
  expect(screen.getByRole('status')).toHaveTextContent(
    'Loading financial records',
  )
  expect(
    screen.queryByText(/No records in this period/),
  ).not.toBeInTheDocument()
})
