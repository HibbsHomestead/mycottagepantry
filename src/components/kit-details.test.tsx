import { render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { demoData } from '@/lib/demo'
import { money, productCosting, profitability, type Item } from '@/lib/domain'
import { kitEstimate } from '@/lib/kit-estimate'
import { KitCostCards } from './kit-cost-cards'
import { KitIncludedProducts } from './kit-included-products'

function fixture() {
  const workspace = demoData()
  const kit: Item = {
    id: 'kit',
    name: "Gather 'Round",
    workflow: 'kit',
    price: 42,
    assemblyMinutes: 12,
    assemblyRate: 18,
    kitComponents: [
      { productId: workspace.products[0].id, quantity: 2, basis: 'package' },
    ],
    packagingLines: [{ ingredientId: 'bags', quantity: 1, unit: 'each' }],
  }
  return { workspace, kit }
}
const card = (label: string) =>
  within(
    screen
      .getByText(label, { exact: true })
      .closest('.cost-card') as HTMLElement,
  )
it.each(['inclusive', 'exclusive'] as const)(
  'uses authoritative kit costs and %s tax without adding component costs twice',
  (behavior) => {
    const { workspace, kit } = fixture()
    workspace.settings[0].taxRates = [
      {
        id: 'tax',
        name: 'Test tax',
        jurisdiction: 'Test only',
        ratePercent: 5.1,
        behavior,
        active: true,
      },
    ]
    kit.taxRateIds = ['tax']
    const before = JSON.stringify({ workspace, kit })
    const cost = productCosting(kit, workspace)
    const pricing = profitability(kit, cost.perPackage, workspace.settings[0])
    render(
      <KitCostCards
        product={kit}
        workspace={workspace}
        edit={vi.fn()}
        configure={vi.fn()}
      />,
    )
    expect(
      card('Included products').getByText(
        money(productCosting(workspace.products[0], workspace).perPackage * 2),
      ),
    ).toBeVisible()
    expect(
      card('Total cost per kit').getByText(money(cost.perPackage)),
    ).toBeVisible()
    expect(
      card('Profit per kit').getByText(money(pricing.profit)),
    ).toBeVisible()
    expect(
      card('Revenue excluding tax').getByText(money(pricing.revenue)),
    ).toBeVisible()
    expect(
      card('Customer price').getByText(money(pricing.customerTotal)),
    ).toBeVisible()
    expect(card('Tax per kit').getByText(money(pricing.tax))).toBeVisible()
    expect(
      card('Suggested selling price').getByText(money(pricing.suggested)),
    ).toBeVisible()
    expect(JSON.stringify({ workspace, kit })).toBe(before)
  },
)

it.each(['missing', 'inactive', 'classification', 'mapping'])(
  'retains costs but preserves category validation for %s',
  (scenario) => {
    const { workspace, kit } = fixture()
    kit.taxSource = 'category'
    if (scenario !== 'missing') {
      kit.productCategoryId = 'category'
      workspace.settings[0].productCategories = [
        {
          id: 'category',
          name: 'Holiday kits',
          active: scenario !== 'inactive',
          classification: scenario === 'classification' ? null : 'food',
        },
      ]
      workspace.settings[0].categoryTaxMappings = {}
    }
    const estimate = kitEstimate(kit, workspace)
    expect(estimate.cost?.perPackage).toBe(
      productCosting(kit, workspace).perPackage,
    )
    expect(estimate.tax).toBeUndefined()
    expect(estimate.pricing).toBeUndefined()
    expect(estimate.pricingError).toBeTruthy()
    expect(estimate.explanation).toContain(kit.name)
    expect(estimate.configuration).toBe(
      scenario === 'classification'
        ? 'Categories'
        : scenario === 'mapping'
          ? 'Taxes'
          : 'kit',
    )
    render(
      <KitCostCards
        product={kit}
        workspace={workspace}
        edit={vi.fn()}
        configure={vi.fn()}
      />,
    )
    expect(
      card('Total cost per kit').queryByText('Unavailable'),
    ).not.toBeInTheDocument()
    expect(card('Tax per kit').getByText('Unavailable')).toBeVisible()
    expect(card('Profit per kit').getByText('Unavailable')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Estimate incomplete:')
  },
)

it('keeps tax/revenue available when component cost is missing, and never displays incomplete cost as zero', () => {
  const { workspace, kit } = fixture()
  workspace.products[0].needsCostSetup = true
  render(
    <KitCostCards
      product={kit}
      workspace={workspace}
      edit={vi.fn()}
      configure={vi.fn()}
    />,
  )
  expect(card('Total cost per kit').getByText('Unavailable')).toBeVisible()
  expect(card('Included products').getByText('Unavailable')).toBeVisible()
  expect(card('Profit per kit').getByText('Unavailable')).toBeVisible()
  expect(card('Revenue excluding tax').getByText('$42.00')).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent(
    workspace.products[0].name,
  )
})

it.each(['', null, undefined, -1, 'invalid'])(
  'does not treat missing/invalid price %s as free',
  (price) => {
    const { workspace, kit } = fixture()
    kit.price = price
    const estimate = kitEstimate(kit, workspace)
    expect(estimate.cost).toBeDefined()
    expect(estimate.tax).toBeUndefined()
    expect(estimate.pricing).toBeUndefined()
  },
)

it('retains independent tax results when a target margin is invalid', () => {
  const { workspace, kit } = fixture()
  kit.targetMargin = 100
  const estimate = kitEstimate(kit, workspace)
  expect(estimate.cost).toBeDefined()
  expect(estimate.tax?.revenue).toBe(42)
  expect(estimate.pricing).toBeUndefined()
  expect(estimate.pricingError).toContain('Target margin')
})

it('distinguishes whole selling packages from their contents and exposes unavailable or archived references', () => {
  const { workspace, kit } = fixture()
  Object.assign(workspace.products[0], {
    unitsPerPackage: 9,
    sellingUnit: 'tray',
    contentUnit: 'rolls',
    archived: true,
  })
  kit.kitComponents.push({
    productId: 'missing',
    quantity: 3,
    basis: 'content',
  })
  render(
    <KitIncludedProducts
      product={kit}
      workspace={workspace}
      openProduct={vi.fn()}
    />,
  )
  expect(screen.getByText('2 whole selling packages')).toBeVisible()
  expect(screen.getByText('9 rolls per package')).toBeVisible()
  expect(screen.getByText('Selling unit: tray')).toBeVisible()
  expect(screen.getByText('Archived product')).toBeVisible()
  expect(screen.getByText('Unavailable product · missing')).toBeVisible()
  expect(screen.getByText(/Unsupported quantity basis/)).toBeVisible()
})
