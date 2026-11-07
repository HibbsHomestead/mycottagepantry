// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  applicableTaxes,
  baseUnit,
  calculateTax,
  convert,
  costBreakdown,
  productCosting,
  profitability,
  type Item,
  type TaxRate,
  type Workspace,
} from './domain'
import { demoData, rollup } from './demo'
import { reportRows } from './reports'
const flour: Item = {
  id: 'flour',
  name: 'Bread flour',
  unit: 'g',
  quantity: convert(25, 'lb', 'g'),
  cost: 10.95 / convert(25, 'lb', 'g'),
}
const recipe: Item = {
  id: 'bread',
  name: 'Bread',
  yield: 4,
  laborMinutes: 30,
  laborRate: 18,
  overhead: 2,
  wastePercent: 5,
  lines: [{ ingredientId: 'flour', quantity: 20, unit: 'oz' }],
}
const product: Item = {
  id: 'loaf',
  name: 'Loaf',
  recipeId: 'bread',
  unitsPerPackage: 1,
  price: 10,
  targetMargin: 65,
  packagingLines: [
    { ingredientId: 'bag', quantity: 1, unit: 'each' },
    { ingredientId: 'label', quantity: 1, unit: 'each' },
    { ingredientId: 'seal', quantity: 1, unit: 'each' },
  ],
}
const state: Workspace = {
  ingredients: [
    flour,
    ...[
      ['bag', 0.08],
      ['label', 0.04],
      ['seal', 0.02],
    ].map(([id, cost]) => ({
      id: String(id),
      name: String(id),
      cost,
      unit: 'each',
      usedAs: 'packaging',
    })),
  ],
  recipes: [recipe],
  products: [product],
  settings: [{ id: 'business', name: 'Bakery' }],
  sales: [],
  batches: [],
  expenses: [],
  ledger: [],
}
const rate = (
  id: string,
  percent: number,
  behavior: 'inclusive' | 'exclusive',
  extra = {},
): TaxRate => ({
  id,
  name: id,
  jurisdiction: id,
  ratePercent: percent,
  behavior,
  ...extra,
})
describe('unit normalization and exact recipe costs', () => {
  it('prices 25 lb at $10.95 as 400 oz and 20 oz as $0.5475', () => {
    expect(convert(25, 'lb', 'oz')).toBeCloseTo(400, 10)
    expect(10.95 / convert(25, 'lb', 'oz')).toBeCloseTo(0.027375, 10)
    expect(costBreakdown(recipe, [flour]).ingredient).toBeCloseTo(0.5475, 10)
    expect(baseUnit('lb')).toBe('g')
    expect(baseUnit('cup')).toBe('ml')
    expect(baseUnit('dozen')).toBe('each')
  })
  it('rejects guesses and uses a verified density in either direction across compatible units', () => {
    expect(() => convert(1, 'cup', 'g')).toThrow(/verified/)
    expect(() =>
      convert(1, 'cup', 'g', [
        { from: 'cup', to: 'g', amountFrom: 1, amountTo: 120, verified: false },
      ]),
    ).toThrow()
    const c = [
      { from: 'cup', to: 'g', amountFrom: 1, amountTo: 120, verified: true },
    ]
    expect(convert(2, 'cup', 'kg', c)).toBeCloseTo(0.24)
    expect(convert(0.24, 'kg', 'cup', c)).toBeCloseTo(2)
    expect(convert(16, 'tbsp', 'g', c)).toBeCloseTo(120)
  })
  it('requires explicit case/package size and supports a custom count unit', () => {
    expect(() => convert(1, 'case', 'each')).toThrow()
    expect(() => convert(1, 'case', 'package')).toThrow()
    expect(
      convert(2, 'case', 'each', [
        {
          from: 'case',
          to: 'each',
          amountFrom: 1,
          amountTo: 48,
          verified: true,
        },
      ]),
    ).toBe(96)
    const c = [
      {
        from: 'tray12',
        to: 'each',
        amountFrom: 1,
        amountTo: 12,
        verified: true,
        unitDefinition: {
          abbreviation: 'tray12',
          category: 'count',
          factor: 12,
        },
      },
    ]
    expect(convert(2, 'tray12', 'dozen', c)).toBe(2)
  })
  it('honors a saved ingredient-specific volume measurement', () => {
    expect(
      convert(1, 'tbsp', 'ml', [
        { from: 'tbsp', to: 'ml', amountFrom: 1, amountTo: 15, verified: true },
      ]),
    ).toBe(15)
  })
})
describe('batch and product costing', () => {
  it('includes each packaging line, labor, overhead, and waste before dividing by yield', () => {
    const c = productCosting(product, state)
    expect(c.packagingCost).toBeCloseTo(0.56)
    expect(c.labor).toBe(9)
    expect(c.overhead).toBe(2)
    expect(c.waste).toBeCloseTo((0.5475 + 0.56 + 9 + 2) * 0.05)
    expect(c.perPackage).toBeCloseTo(((0.5475 + 0.56 + 9 + 2) * 1.05) / 4)
  })
  it('scales planned quantities but prices packaging and per-unit overhead using actual yield', () => {
    const c = costBreakdown(
      { ...recipe, overheadMode: 'unit' },
      state.ingredients,
      { multiplier: 2, actualYield: 6, product },
    )
    expect(c.plannedYield).toBe(8)
    expect(c.actualYield).toBe(6)
    expect(c.ingredient).toBeCloseTo(1.095)
    expect(c.packagingCost).toBeCloseTo(0.84)
    expect(c.labor).toBe(18)
    expect(c.overhead).toBe(12)
    expect(c.perPackage).toBeCloseTo(c.total / 6)
  })
  it('supports percent overhead, actual waste, and current versus inventory weighted costs', () => {
    const r = {
      ...recipe,
      overheadMode: 'percent',
      overhead: 10,
      wasteMode: 'actual',
      wasteCost: 1.25,
    }
    const c = costBreakdown(r, [{ ...flour, currentCost: flour.cost * 2 }])
    expect(c.ingredient).toBeCloseTo(1.095)
    expect(c.overhead).toBeCloseTo((1.095 + 9) * 0.1)
    expect(c.waste).toBe(1.25)
    expect(
      costBreakdown(r, [{ ...flour, currentCost: flour.cost * 2 }], {
        historical: true,
      }).ingredient,
    ).toBeCloseTo(0.5475)
    expect(() => costBreakdown({ ...recipe, yield: 0 }, [flour])).toThrow()
  })
  it('rolls up compound current costs without rewriting inventory costs and rejects cycles', () => {
    const w = demoData(),
      prep = w.ingredients.find((i) => i.compoundRecipeId === 'filling')!,
      original = prep.cost
    const initial = prep.currentCost
    w.ingredients.find((i) => i.id === 'butter')!.cost *= 2
    rollup(w)
    expect(prep.currentCost).toBeGreaterThan(initial)
    expect(prep.cost).toBe(original)
    w.recipes
      .find((r) => r.id === 'filling')!
      .lines.push({ ingredientId: prep.id, quantity: 1, unit: 'g' })
    expect(() => rollup(w)).toThrow(/cycle/)
  })
})
describe('tax and profitability', () => {
  it('handles the exclusive and inclusive 8.25% examples', () => {
    const exclusive = calculateTax(10, [rate('State', 8.25, 'exclusive')])
    expect(exclusive.revenueExact).toBe(10)
    expect(exclusive.snapshot[0].exactAmount).toBeCloseTo(0.825)
    expect(exclusive.customerTotal).toBe(10.83)
    const inclusive = calculateTax(10, [rate('State', 8.25, 'inclusive')])
    expect(inclusive.revenueExact).toBeCloseTo(9.2378752887)
    expect(inclusive.snapshot[0].exactAmount).toBeCloseTo(0.7621247113)
    expect(inclusive.customerTotal).toBe(10)
  })
  it('backs out multiple inclusive rates together and adds exclusive rates', () => {
    const c = calculateTax(110, [
      rate('State', 6, 'inclusive'),
      rate('City', 4, 'inclusive'),
      rate('District', 2, 'exclusive'),
    ])
    expect(c.revenueExact).toBeCloseTo(100)
    expect(c.tax).toBe(12)
    expect(c.customerTotal).toBe(112)
    expect(c.snapshot.map((r) => r.amount)).toEqual([4, 2, 6]) // deterministic ID order on tied priorities
  })
  it('solves mixed compounding taxes in explicit calculation order', () => {
    const c = calculateTax(110, [
      rate('A', 10, 'inclusive', { order: 1 }),
      rate('B', 5, 'exclusive', { order: 2, compound: true }),
    ])
    expect(c.revenueExact).toBeCloseTo(100)
    expect(c.snapshot[1].taxableBase).toBeCloseTo(110)
    expect(c.customerTotal).toBe(115.5)
    const allIncluded = calculateTax(115.5, [
      rate('A', 10, 'inclusive', { order: 1 }),
      rate('B', 5, 'inclusive', { order: 2, compound: true }),
    ])
    expect(allIncluded.revenueExact).toBeCloseTo(100)
    expect(allIncluded.customerTotal).toBe(115.5)
  })
  it('keeps cents reconciled for small prices and multiple inclusive rates', () => {
    for (let cents = 1; cents < 1000; cents++) {
      const c = calculateTax(cents / 100, [
        rate('A', 8.25, 'inclusive'),
        rate('B', 3.125, 'inclusive'),
      ])
      expect(c.customerTotal).toBe(cents / 100)
      expect(Math.round((c.revenue + c.tax) * 100)).toBe(cents)
    }
  })
  it('selects effective, category, exempt, zero-rated, and override rates', () => {
    const business = {
      id: 'b',
      name: 'b',
      taxRates: [
        rate('default', 5, 'exclusive'),
        rate('category', 2, 'exclusive', {
          appliesTo: 'product_category',
          category: 'Bread',
        }),
        rate('expired', 3, 'exclusive', { end: '2026-01-01' }),
      ],
    }
    expect(
      applicableTaxes(
        { ...product, category: 'Bread' },
        business,
        '2026-10-28',
      ),
    ).toHaveLength(2)
    expect(
      applicableTaxes({ ...product, taxStatus: 'exempt' }, business),
    ).toEqual([])
    expect(
      applicableTaxes({ ...product, taxStatus: 'zero_rated' }, business),
    ).toEqual([])
    expect(
      applicableTaxes(
        { ...product, taxRateIds: [], priceTaxMode: 'includes' },
        business,
      ),
    ).toEqual([])
    expect(
      applicableTaxes(
        { ...product, taxRateIds: ['default'], priceTaxMode: 'includes' },
        business,
      )[0].behavior,
    ).toBe('inclusive')
  })
  it('calculates profit and suggestions on pre-tax revenue only', () => {
    const p = { ...product, price: 11, targetMargin: 50 },
      business = { id: 'b', name: 'b', taxRates: [rate('A', 10, 'inclusive')] }
    const result = profitability(p, 4, business)
    expect(result.revenueExact).toBeCloseTo(10)
    expect(result.profit).toBeCloseTo(6)
    expect(result.margin).toBeCloseTo(60)
    expect(result.suggested).toBeCloseTo(8.8)
  })
  it('reports tax by historical jurisdiction, including refund adjustments', () => {
    const snapshot = calculateTax(100, [rate('A', 10, 'exclusive')]).snapshot
    const w = {
      ...state,
      sales: [
        {
          id: 's',
          name: 'Sale',
          amount: 100,
          tax: 10,
          date: '2026-10-28',
          taxSnapshot: snapshot,
        },
        {
          id: 'r',
          name: 'Refund',
          amount: -100,
          tax: -10,
          refundOf: 's',
          date: '2026-10-29',
          taxSnapshot: snapshot.map((r) => ({
            ...r,
            amount: -r.amount,
            taxableBase: -r.taxableBase,
          })),
        },
      ],
    }
    expect(reportRows('Sales tax by jurisdiction', w)[0].tax).toBe(0)
    expect(reportRows('Refund tax adjustments', w)[0].tax).toBe(-10)
  })
})

it('never allocates negative pennies or tax to a zero-rate jurisdiction', () => {
  for (let cents = 1; cents < 500; cents++) {
    const c = calculateTax(cents / 100, [
      rate('A', 5, 'inclusive'),
      rate('B', 0.01, 'inclusive'),
      rate('Zero', 0, 'inclusive'),
    ])
    expect(c.snapshot.every((r) => r.amount >= 0)).toBe(true)
    expect(c.snapshot.find((r) => r.id === 'Zero')!.amount).toBe(0)
    expect(c.customerTotal).toBe(cents / 100)
  }
})
