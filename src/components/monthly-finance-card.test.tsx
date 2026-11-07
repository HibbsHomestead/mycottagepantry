import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { MonthlyFinanceCard } from './monthly-finance-card'
const base = {
  month: new Date(2026, 9, 28),
  revenue: 1000,
  cogs: 400,
  costs: 200,
  ready: true,
  incomplete: false,
  onFinances: vi.fn(),
}
it('keeps real amounts and period, makes estimated profit primary, and scales real segments', () => {
  render(<MonthlyFinanceCard {...base} />)
  expect(
    screen.getByRole('heading', { name: 'Your month in the making' }),
  ).toBeInTheDocument()
  expect(screen.getByText(/OCTOBER 2026 · MONTH TO DATE/)).toBeInTheDocument()
  expect(screen.getByText('$1,000.00')).toBeInTheDocument()
  const figure = screen.getByRole('img')
  expect(figure).toHaveAccessibleName(
    /Cost of goods sold: \$400.00 \(40.0% of sales\)/,
  )
  expect(figure.querySelector('.cogs')).toHaveStyle({ width: '40%' })
  expect(figure.querySelector('.expenses')).toHaveStyle({ width: '20%' })
  expect(figure.querySelector('.profit')).toHaveStyle({ width: '40%' })
})
it('shows a restrained loss and numeric breakdown without a positive-only chart', () => {
  const { container } = render(<MonthlyFinanceCard {...base} revenue={200} />)
  expect(screen.getByText('-$400.00')).toBeInTheDocument()
  expect(container.querySelector('.monthly-profit')).toHaveClass('loss')
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByText(/Estimated loss after/)).toBeInTheDocument()
})
it('uses neutral zero and never divides by zero', () => {
  const { container } = render(
    <MonthlyFinanceCard {...base} revenue={0} cogs={0} costs={0} />,
  )
  expect(container.querySelector('.monthly-profit')).toHaveClass('neutral')
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})
it.each([
  { ready: false, incomplete: false },
  { ready: true, incomplete: true },
  { ready: true, incomplete: false, revenue: NaN },
])(
  'does not confirm zero or draw charts with loading/missing data: %j',
  (patch) => {
    render(<MonthlyFinanceCard {...base} {...patch} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(4)
  },
)
it('retains long currency values and the finances destination action', async () => {
  const go = vi.fn()
  render(
    <MonthlyFinanceCard {...base} revenue={123456789.99} onFinances={go} />,
  )
  expect(screen.getByText('$123,456,789.99')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'View finances' }))
  expect(go).toHaveBeenCalledOnce()
})
