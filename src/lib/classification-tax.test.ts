// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  applicableTaxes,
  calculateTax,
  categoryTaxDescription,
  profitability,
  validateTaxRates,
  type Item,
  type TaxRate,
} from './domain'
import { categoryTaxState } from './product-categories'

const rate: TaxRate = {
  id: 'nonfood-tax',
  name: 'Goods tax',
  jurisdiction: 'Test',
  ratePercent: 5,
  behavior: 'exclusive',
  appliesTo: 'classification',
  classification: 'non_food',
}
const business: Item = {
  id: 'business',
  name: 'Test',
  taxRates: [rate],
  categoryTaxMappings: {},
  productCategories: [
    { id: 'gifts', name: 'Gifts', classification: 'non_food' },
    { id: 'home', name: 'Home', classification: 'non_food' },
    { id: 'food', name: 'Gifts', classification: 'food' },
    { id: 'unknown', name: 'Unclassified', classification: null },
  ],
}
const product: Item = {
  id: 'handmade',
  name: 'Bag',
  workflow: 'handmade',
  productCategoryId: 'gifts',
  taxSource: 'category',
  price: 100,
}

describe('classification tax resolution', () => {
  it('resolves Handmade classification without requiring a category tax mapping', () => {
    expect(categoryTaxState(product, business).issue).toBe('')
    expect(applicableTaxes(product, business)).toEqual([rate])
    expect(profitability(product, 40, business)).toMatchObject({
      revenue: 100,
      tax: 5,
    })
    expect(
      calculateTax(
        105,
        applicableTaxes({ ...product, priceTaxMode: 'includes' }, business),
      ),
    ).toMatchObject({ revenue: 100, tax: 5 })
  })
  it('matches the saved category classification independently of category names and product type', () => {
    expect(
      applicableTaxes(
        { ...product, productCategoryId: 'home', workflow: 'food' },
        business,
      ),
    ).toEqual([rate])
    // Identical category display names do not conflate separate classification assignments.
    expect(() =>
      applicableTaxes(
        { ...product, productCategoryId: 'food', category: 'Gifts' },
        business,
      ),
    ).toThrow(/not configured/)
    // An ad hoc field cannot override the authoritative category assignment.
    expect(
      applicableTaxes({ ...product, classification: 'food' }, business),
    ).toEqual([rate])
  })
  it('stacks existing mapped category rates and classification rates once with existing order/compounding', () => {
    const categoryRate: TaxRate = {
      ...rate,
      id: 'category',
      appliesTo: 'product_category',
      category: 'Gifts',
      order: 1,
      compound: true,
      ratePercent: 10,
    }
    const both = {
      ...business,
      taxRates: [rate, categoryRate],
      categoryTaxMappings: { non_food: [rate.id, 'category'] },
    }
    expect(applicableTaxes(product, both).map((r) => r.id)).toEqual([
      rate.id,
      'category',
    ])
    expect(calculateTax(100, applicableTaxes(product, both)).tax).toBe(15.5)
    expect(
      applicableTaxes(
        { ...product, taxSource: undefined, category: 'Gifts' },
        both,
      ),
    ).toHaveLength(2)
    expect(
      applicableTaxes(
        { ...product, taxSource: undefined, taxRateIds: ['category'] },
        both,
      ).map((r) => r.id),
    ).toEqual(['category'])
    expect(
      applicableTaxes(
        { ...product, taxSource: undefined, taxStatus: 'exempt' },
        both,
      ),
    ).toEqual([])
  })
  it('keeps missing, deleted, inactive, expired, future and blank configurations unresolved', () => {
    for (const productCategoryId of ['deleted', 'unknown', ''])
      expect(() =>
        applicableTaxes({ ...product, productCategoryId }, business),
      ).toThrow(/configur/)
    for (const patch of [
      { active: false },
      { end: '2020-01-01' },
      { start: '2090-01-01' },
    ])
      expect(() =>
        applicableTaxes(product, {
          ...business,
          taxRates: [{ ...rate, ...patch }],
        }),
      ).toThrow(/configur/)
    expect(() =>
      calculateTax(
        100,
        applicableTaxes(product, {
          ...business,
          taxRates: [{ ...rate, ratePercent: '' }],
        }),
      ),
    ).toThrow(/percentage/)
    expect(
      calculateTax(
        100,
        applicableTaxes(product, {
          ...business,
          taxRates: [{ ...rate, ratePercent: 0 }],
        }),
      ).tax,
    ).toBe(0)
    expect(() =>
      applicableTaxes(product, {
        ...business,
        categoryTaxMappings: { non_food: ['deleted-rate'] },
      }),
    ).toThrow(/unavailable/)
  })
  it('rejects invalid or foreign classification identifiers and classifications absent from the business', () => {
    for (const classification of [undefined, '', 'foreign-id', 'Food'])
      expect(() =>
        validateTaxRates([{ ...rate, classification } as TaxRate], business),
      ).toThrow(/this business/)
    expect(() =>
      validateTaxRates([rate], {
        ...business,
        productCategories: [
          { id: 'only-food', name: 'Food', classification: 'food' },
        ],
      }),
    ).toThrow(/this business/)
    expect(validateTaxRates([rate], business)).toEqual([rate])
  })
})

it('uses resolved scope and dates in category descriptions instead of reporting mappings alone', () => {
  expect(
    categoryTaxDescription(business.productCategories[0], business),
  ).toContain('Goods tax')
  const expired = { ...business, taxRates: [{ ...rate, end: '2020-01-01' }] }
  expect(
    categoryTaxDescription(business.productCategories[0], expired),
  ).toContain('not tax exempt')
  expect(profitability(product, 40, business)).toMatchObject({
    profit: 60,
    margin: 60,
  })
})
