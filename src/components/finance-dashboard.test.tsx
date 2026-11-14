import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FinanceDashboard } from './finance-dashboard'
import { demoData } from '@/lib/demo'
import userEvent from '@testing-library/user-event'
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
it('shows receipt exclusions and existing actions, keeps dates until explicitly changed, and refreshes after saved workspace updates', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T12:00:00Z'))
  try {
    const p = props()
    const w = p.workspace
    for (const key of Object.keys(w)) if (key !== 'settings') w[key] = []
    w.receipt_extractions = [
      {
        id: 'historical',
        name: 'Booth fee',
        status: 'posted',
        date: '2026-07-26',
        total: 25,
      },
      {
        id: 'stock',
        name: 'Sugar',
        status: 'posted',
        date: '2026-11-10',
        total: 20.41,
      },
      {
        id: 'draft',
        name: 'Needs category',
        status: 'draft',
        date: '2026-11-10',
        extractionStatus: 'failed',
      },
    ]
    w.expenses = [
      {
        id: 'expense',
        name: 'Booth fee',
        date: '2026-07-26',
        amount: 25,
        receiptId: 'historical',
      },
    ]
    w.finance_transactions = [
      {
        id: 'purchase',
        name: 'Sugar purchase',
        kind: 'receipt',
        receiptId: 'stock',
        date: '2026-11-10',
        status: 'posted',
        lineSnapshots: [{ decision: 'inventory', postedAmount: 20.41 }],
      },
    ]
    const view = render(<FinanceDashboard {...p} ready />)
    expect(screen.getByLabelText('Date range')).toHaveValue('This month')
    expect(screen.getByText(/Receipts awaiting review: 1/)).toBeInTheDocument()
    expect(screen.getByText(/1 posted receipt is outside/)).toBeInTheDocument()
    expect(screen.getByText(/Inventory asset: \$20.41/)).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Review existing receipt' }),
    )
    expect(p.onReceipt).toHaveBeenCalledWith(w.receipt_extractions[2])
    await user.selectOptions(
      screen.getByLabelText('Date range'),
      'Year to date',
    )
    expect(
      screen.getByRole('button', { name: /Recorded expenses.*\$25.00/ }),
    ).toBeInTheDocument()
    const saved = structuredClone(w)
    saved.receipt_extractions[2].status = 'posted'
    saved.expenses.push({
      id: 'new-expense',
      name: 'Reviewed expense',
      date: '2026-11-10',
      amount: 12,
      receiptId: 'draft',
    })
    view.rerender(<FinanceDashboard {...p} workspace={saved} ready />)
    expect(screen.getByLabelText('Date range')).toHaveValue('Year to date')
    expect(
      screen.getByRole('button', { name: /Recorded expenses.*\$37.00/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Receipts awaiting review:/),
    ).not.toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})
it('does not present stale totals as empty records after a refresh failure', () => {
  render(<FinanceDashboard {...props()} ready loadError="Refresh failed" />)
  expect(screen.getByRole('alert')).toHaveTextContent('Refresh failed')
  expect(
    screen.queryByText('No operating expenses recorded in this period.'),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('region', { name: 'Saved receipt inclusion' }),
  ).not.toBeInTheDocument()
})
