import { expect, it } from 'vitest'
import { enteredPriceForTotal, planPriceTaxChange } from './business-price-tax'
import {
  applicableTaxes,
  calculateTax,
  type TaxRate,
  type Workspace,
} from './domain'

const state: TaxRate = {
  id: 'state',
  name: 'State',
  jurisdiction: 'Test',
  ratePercent: 10,
  behavior: 'exclusive',
}
const city: TaxRate = {
  ...state,
  id: 'city',
  name: 'City',
  ratePercent: 5,
  compound: true,
  order: 1,
}

it('preserves the exact total through compound rates and rejects an unreachable cent amount', () => {
  const rates = [state, city]
  const total = calculateTax(19.99, rates).customerTotal
  expect(enteredPriceForTotal(total, rates)).toBe(19.99)
  expect(() => enteredPriceForTotal(0.05, [state])).toThrow(/whole cents/)
  expect(
    enteredPriceForTotal(0.05, [{ ...state, behavior: 'inclusive' }]),
  ).toBe(0.05)
})

it('keeps legacy mixed rates until bulk apply and reports when an inclusive price cannot keep its total', () => {
  const business = {
    id: 'settings',
    name: 'Business',
    defaultPriceTaxMode: 'before',
    taxRates: [state, { ...city, behavior: 'inclusive' }],
  }
  const product = {
    id: 'cup',
    name: 'Cup',
    workflow: 'resale',
    price: 0.04,
    priceTaxMode: 'saved-includes',
  }
  const workspace: Workspace = {
    settings: [business],
    products: [product],
    recipes: [],
    ingredients: [],
  }
  expect(
    applicableTaxes({ ...product, priceTaxMode: 'configured' }, business).map(
      (r) => r.behavior,
    ),
  ).toEqual(['exclusive', 'inclusive'])
  const rejected = planPriceTaxChange(workspace, '2026-11-23', 'total', false)
  expect(rejected.failures).toBe(1)
  expect(rejected.rows[0].error).toMatch(/whole cents/)
  const accepted = planPriceTaxChange(workspace, '2026-11-23', 'entered', false)
  expect(accepted.failures).toBe(0)
  expect(accepted.rows[0]).toMatchObject({
    patch: { priceTaxMode: 'inherit' },
    prices: [
      {
        before: { price: 0.04, total: 0.04 },
        after: { price: 0.04, total: 0.05 },
      },
    ],
  })
})
