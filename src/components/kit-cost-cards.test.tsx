import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { demoData } from '@/lib/demo'
import { money, productCosting, profitability, type Item } from '@/lib/domain'
import { KitCostCards } from './kit-cost-cards'
afterEach(cleanup)
function fixture() {
  const workspace = demoData()
  const product: Item = {
    id: 'kit',
    name: 'Review kit',
    workflow: 'kit',
    price: 45,
    assemblyMinutes: 12,
    assemblyRate: 18,
    kitComponents: [
      { productId: workspace.products[0].id, quantity: 2, basis: 'package' },
    ],
    packagingLines: [],
  }
  return { workspace, product }
}
it('retains authoritative cost and selling price when category pricing is incomplete', () => {
  const { product, workspace } = fixture()
  product.taxSource = 'category'
  const cost = productCosting(product, workspace)
  render(
    <KitCostCards
      product={product}
      workspace={workspace}
      edit={() => {}}
      configure={() => {}}
    />,
  )
  expect(screen.getByRole('status').textContent).toContain(
    'Product category not configured.',
    <KitCostCards product={product} workspace={workspace} edit={() => {}} />,
  )
  expect(screen.getByRole('status').textContent).toContain(
    'Review kit: Product category not configured.',
  )
  expect(screen.getByText(money(cost.total))).toBeTruthy()
  expect(screen.getByText('$45.00')).toBeTruthy()
  expect(screen.getAllByText('Unavailable')).toHaveLength(6)
  expect(screen.getByRole('button', { name: 'Edit kit' })).toBeTruthy()
  expect(
    screen.getByRole('button', { name: 'Edit kit configuration' }),
  ).toBeTruthy()
})
it('uses the existing costing and pricing results without mutating the workspace', () => {
  const { product, workspace } = fixture()
  const before = JSON.stringify(workspace)
  const cost = productCosting(product, workspace)
  const price = profitability(product, cost.perPackage, workspace.settings[0])
  render(
    <KitCostCards
      product={product}
      workspace={workspace}
      edit={() => {}}
      configure={() => {}}
    />,
    <KitCostCards product={product} workspace={workspace} edit={() => {}} />,
  )
  expect(screen.getByText(money(price.profit))).toBeTruthy()
  expect(screen.getByText(`${price.margin.toFixed(2)}%`)).toBeTruthy()
  expect(screen.getByText(money(price.suggested))).toBeTruthy()
  expect(JSON.stringify(workspace)).toBe(before)
})
it('never renders missing component costs as zero', () => {
  const { product, workspace } = fixture()
  workspace.products[0].needsCostSetup = true
  render(
    <KitCostCards
      product={product}
      workspace={workspace}
      edit={() => {}}
      configure={() => {}}
    />,
    <KitCostCards product={product} workspace={workspace} edit={() => {}} />,
  )
  expect(screen.getByRole('status').textContent).toContain('cost is incomplete')
  expect(screen.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(7)
})
