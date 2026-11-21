import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResaleCostBreakdown } from './resale-purchase-cost'

it('does not present missing legacy opening costs or acquisition allocations as zero', () => {
  render(
    <ResaleCostBreakdown
      product={{
        id: 'isolated',
        name: 'Legacy stock',
        stockEntry: { quantity: 2, choice: 'existing' },
      }}
      workspace={{ ledger: [] }}
    />,
  )
  expect(screen.getAllByText('Purchase cost not recorded')).toHaveLength(2)
  expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument()
  expect(screen.getAllByText('Not separately recorded')).toHaveLength(2)
  expect(screen.getByText(/Total cost not recorded/)).toBeInTheDocument()
})
