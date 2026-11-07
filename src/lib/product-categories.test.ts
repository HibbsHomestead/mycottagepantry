// @vitest-environment node
import { expect, it } from 'vitest'
import {
  applicableTaxes,
  calculateTax,
  saleTaxProduct,
  type Item,
} from './domain'
import { categoryTaxState, productCategoryName } from './product-categories'
const rate = {
  id: 'state',
  name: 'State',
  jurisdiction: 'Test jurisdiction',
  ratePercent: 5,
  behavior: 'exclusive',
  active: true,
}
const business: Item = {
  id: 'business',
  name: 'Test',
  taxRates: [
    rate,
    {
      ...rate,
      id: 'city',
      name: 'City',
      ratePercent: 1,
      order: 1,
      compound: true,
    },
  ],
  productCategories: [
    { id: 'bread', name: 'Bread', classification: 'food' },
    { id: 'bags', name: 'Bags', classification: 'non_food' },
    { id: 'review', name: 'Unreviewed', classification: null },
  ],
  categoryTaxMappings: { food: ['state', 'city'], non_food: ['city'] },
}
const product: Item = {
  id: 'loaf',
  name: 'Loaf',
  productCategoryId: 'bread',
  taxSource: 'category',
}
it('uses stable category IDs after renaming and applies configured compound/jurisdiction rules', () => {
  const renamed = {
    ...business,
    productCategories: business.productCategories.map((c: Item) => ({
      ...c,
      name: c.id === 'bread' ? 'Loaves' : c.name,
    })),
  }
  expect(productCategoryName(product, renamed)).toBe('Loaves')
  expect(calculateTax(100, applicableTaxes(product, renamed)).tax).toBe(6.05)
  expect(
    applicableTaxes({ ...product, productCategoryId: 'bags' }, business).map(
      (r) => r.id,
    ),
  ).toEqual(['city'])
})
it('retains legacy overrides, exemptions, inclusive behavior and calculations even when category mappings differ', () => {
  const legacy = { ...product, taxSource: undefined, taxRateIds: ['city'] }
  expect(applicableTaxes(legacy, business).map((r) => r.id)).toEqual(['city'])
  expect(applicableTaxes({ ...legacy, taxStatus: 'exempt' }, business)).toEqual(
    [],
  )
  expect(
    calculateTax(
      105,
      applicableTaxes(
        { ...legacy, taxRateIds: ['state'], priceTaxMode: 'includes' },
        business,
      ),
    ).revenue,
  ).toBe(100)
})
it('does not equate unclassified, unavailable, inactive or unconfigured with exempt', () => {
  for (const p of [
    { ...product, productCategoryId: 'review' },
    { ...product, productCategoryId: 'foreign' },
    { ...product, productCategoryId: '' },
  ])
    expect(() => applicableTaxes(p, business)).toThrow(/configur|review/)
  expect(() =>
    applicableTaxes(product, { ...business, categoryTaxMappings: {} }),
  ).toThrow(/does not mean tax exempt/)
  expect(
    categoryTaxState(product, {
      ...business,
      productCategories: [
        { id: 'bread', name: 'Bread', classification: 'food', active: false },
      ],
    }).issue,
  ).toMatch(/inactive/)
})
it('keeps rate scopes, effective dates, activation and configured zero rates distinct', () => {
  const rates = [
    { ...rate, appliesTo: 'selected_products', productIds: ['other'] },
    { ...rate, id: 'city', start: '2030-01-01' },
  ]
  expect(() =>
    applicableTaxes(product, { ...business, taxRates: rates }, '2026-11-02'),
  ).toThrow(/scope and effective dates/)
  expect(
    applicableTaxes(product, {
      ...business,
      taxRates: [{ ...rate, ratePercent: 0 }],
      categoryTaxMappings: { food: ['state'] },
    }),
  ).toHaveLength(1)
  expect(() =>
    applicableTaxes(product, {
      ...business,
      taxRates: [{ ...rate, active: false }],
    }),
  ).toThrow(/unavailable or inactive/)
})

it('retains category-scoped configured treatments across category renames without altering legacy rule labels', () => {
  const scoped = {
    ...business,
    productCategories: [
      {
        id: 'bread',
        name: 'Loaves',
        classification: 'food',
        previousNames: ['Bread'],
      },
    ],
    categoryTaxMappings: { food: ['state'] },
    taxRates: [{ ...rate, appliesTo: 'product_category', category: 'Bread' }],
  }
  expect(applicableTaxes(product, scoped).map((r) => r.id)).toEqual(['state'])
  expect(scoped.taxRates[0].category).toBe('Bread')
  expect(() =>
    applicableTaxes(product, {
      ...scoped,
      taxRates: [{ ...rate, appliesTo: 'product_category' }],
    }),
  ).toThrow(/scope/)
})
it('uses the existing legacy business default as an available treatment without inventing a new rule', () => {
  const legacySettings = {
    ...business,
    taxRates: undefined,
    taxRate: 7,
    categoryTaxMappings: { food: ['legacy-default'] },
  }
  expect(calculateTax(100, applicableTaxes(product, legacySettings)).tax).toBe(
    7,
  )
})
it('retains explicit sale-level rate overrides without altering product inheritance', () => {
  const inheritedProduct = { ...product }
  expect(
    applicableTaxes(saleTaxProduct(inheritedProduct, ['city']), business).map(
      (r) => r.id,
    ),
  ).toEqual(['city'])
  expect(saleTaxProduct(inheritedProduct, undefined)).toBe(inheritedProduct)
  expect(inheritedProduct.taxSource).toBe('category')
  expect(applicableTaxes(inheritedProduct, business).map((r) => r.id)).toEqual([
    'state',
    'city',
  ])
})
