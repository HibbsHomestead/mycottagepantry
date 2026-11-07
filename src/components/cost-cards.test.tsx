import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { IngredientCostCards } from './ingredient-cost-cards'
import { ProductCostCards } from './product-cost-cards'
import { costMoney } from './cost-cards'
import { demoData } from '@/lib/demo'
import { productCosting, profitability, money } from '@/lib/domain'

it('keeps nonzero unit costs readable down to tiny fractions while formatting normal prices in cents', () => {
  expect(costMoney(6.17)).toBe('$6.17')
  expect(costMoney(0)).toBe('$0.00')
  expect(costMoney(0.011287667)).toBe('$0.0113')
  expect(costMoney(0.0000000000123)).not.toBe('$0.00')
  expect(costMoney(0.0000000000123)).toContain('123')
})

it('preserves the saved cross-category conversion and distinguishes package price, reference cost and inventory quantity', () => {
  const ingredient = {
    id: 'flour',
    name: 'Flour',
    unit: 'g',
    storageUnit: 'g',
    recipeUnit: 'cup',
    cost: 0.003,
    currentCost: 0.004,
    quantity: 500,
    purchaseQuantity: 1,
    purchaseUnit: 'bag',
    packagePrice: 3,
    conversions: [
      { from: 'bag', to: 'g', amountFrom: 1, amountTo: 1000, verified: true },
      { from: 'cup', to: 'g', amountFrom: 1, amountTo: 120, verified: true },
    ],
  }
  const original = JSON.stringify(ingredient)
  render(<IngredientCostCards ingredient={ingredient} />)
  expect(screen.getByText('$3.00')).toBeVisible()
  expect(screen.getByText('$0.003 / g')).toBeVisible()
  expect(screen.getByText('$0.004 / g')).toBeVisible()
  expect(screen.getByText('$0.48 / cup')).toBeVisible()
  expect(screen.getByText(/Saved:.*1 cup = 120 g/)).toBeVisible()
  expect(screen.getByText('500 g')).toBeVisible()
  expect(JSON.stringify(ingredient)).toBe(original)
})

it('shows Conversion needed for unverified weight-to-volume conversions and keeps missing purchase cost distinct from zero', () => {
  const { rerender } = render(
    <IngredientCostCards
      ingredient={{
        id: 'flour',
        name: 'Flour',
        unit: 'g',
        cost: 0.003,
        recipeUnit: 'cup',
        conversions: [
          {
            from: 'cup',
            to: 'g',
            amountFrom: 1,
            amountTo: 120,
            verified: false,
          },
        ],
      }}
    />,
  )
  expect(screen.getByText('Conversion needed')).toBeVisible()
  expect(screen.getAllByText('Not set')).toHaveLength(3)
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  rerender(
    <IngredientCostCards
      ingredient={{
        id: 'flour',
        name: 'Flour',
        unit: 'g',
        cost: 0,
        recipeUnit: 'cup',
        needsCostSetup: true,
      }}
    />,
  )
  expect(screen.getByText('Conversion needed')).toBeVisible()
  expect(screen.getByText('Cost needs setup')).toBeVisible()
})

it.each(['inclusive', 'exclusive'] as const)(
  'shows %s tax, customer price and revenue separately without modifying values',
  (behavior) => {
    const workspace = demoData()
    workspace.settings[0].taxRates = [
      {
        id: 'tax',
        name: 'Sales tax',
        jurisdiction: 'Demo jurisdiction',
        ratePercent: 5.1,
        behavior,
        active: true,
      },
    ]
    const product = { ...workspace.products[0], taxRateIds: ['tax'], price: 10 }
    const original = JSON.stringify({ product, workspace })
    const cost = productCosting(product, workspace).perPackage
    const pricing = profitability(product, cost, workspace.settings[0])
    render(
      <ProductCostCards product={product} cost={cost} workspace={workspace} />,
    )
    const card = (label: string) =>
      screen
        .getByText(label, { exact: true })
        .closest('.cost-card') as HTMLElement
    expect(
      within(card('Customer price')).getByText(money(pricing.customerTotal)),
    ).toBeVisible()
    expect(
      within(card('Revenue excluding tax')).getByText(money(pricing.revenue)),
    ).toBeVisible()
    expect(
      within(card('Tax per package')).getByText(money(pricing.tax)),
    ).toBeVisible()
    expect(
      within(card('Profit per package')).getByText(money(pricing.profit)),
    ).toBeVisible()
    expect(
      within(card('Margin')).getByText(`${pricing.margin.toFixed(2)}%`),
    ).toBeVisible()
    expect(
      screen.getByText('How this is calculated').closest('details'),
    ).not.toHaveAttribute('open')
    expect(JSON.stringify({ product, workspace })).toBe(original)
  },
)
