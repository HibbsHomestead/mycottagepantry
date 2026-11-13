import { expect, it } from 'vitest'
import {
  compareOffer,
  packageCost,
  sortIngredients,
  updateIngredient,
  validateOffer,
  duplicateBarcodes,
  affectedRecipes,
  pantryDisplayUnit,
} from './ingredients'
import { convert, recipeCost, type Item } from './domain'
const flour = (): Item => ({
  id: 'flour',
  name: 'Flour',
  unit: 'g',
  storageUnit: 'oz',
  quantity: 17463.306245,
  cost: 0.0009,
  currentCost: 10.95 / 11339.80925,
  purchaseQuantity: 25,
  purchaseUnit: 'lb',
  packagePrice: 10.95,
  threshold: 453.59237,
  reorderQuantity: 907.18474,
  allergens: ['Wheat'],
  reviewed: true,
  includesTax: false,
  includesShipping: false,
  currency: 'USD',
  vendor: 'Current store',
})
const edit = (i: Item) => ({
  ...i,
  purchaseOffers: undefined,
  threshold: convert(i.threshold, i.unit, i.storageUnit),
  reorderQuantity: convert(i.reorderQuantity, i.unit, i.storageUnit),
})
it('uses saved units for a missing shelf conversion without inventing package contents', () => {
  const item = {
    ...flour(),
    unit: 'each',
    storageUnit: 'can',
    conversions: [],
  }
  const snapshot = structuredClone(item)
  expect(pantryDisplayUnit(item)).toEqual({
    unit: 'each',
    warning:
      'A verified unit conversion from can to each is required. Showing saved quantities and costs in each.',
  })
  expect(() => convert(1, 'can', 'each', item.conversions)).toThrow(
    'verified unit conversion',
  )
  expect(item).toEqual(snapshot)
  expect(
    pantryDisplayUnit({
      ...item,
      conversions: [
        { from: 'can', to: 'each', amountFrom: 1, amountTo: 3, verified: true },
      ],
    }),
  ).toEqual({ unit: 'can', warning: '' })
  expect(
    pantryDisplayUnit({
      ...item,
      conversions: [
        {
          from: 'can',
          to: 'each',
          amountFrom: 1,
          amountTo: 3,
          verified: false,
        },
      ],
    }).unit,
  ).toBe('each')
  expect(pantryDisplayUnit(flour())).toEqual({ unit: 'oz', warning: '' })
})
it('does not conceal invalid units, malformed conversions, or conflicting measurements', () => {
  expect(() =>
    pantryDisplayUnit({ ...flour(), storageUnit: 'unknown' }),
  ).toThrow('supported unit')
  expect(() =>
    pantryDisplayUnit({
      ...flour(),
      storageUnit: 'can',
      conversions: [
        { from: 'can', to: 'g', amountFrom: 0, amountTo: 1, verified: true },
      ],
    }),
  ).toThrow('Conversion from quantity')
  expect(() =>
    pantryDisplayUnit({
      ...flour(),
      storageUnit: 'can',
      conversions: [
        { from: 'can', to: 'oz', amountFrom: 1, amountTo: 8, verified: true },
        { from: 'can', to: 'lb', amountFrom: 1, amountTo: 1, verified: true },
      ],
    }),
  ).toThrow('Conflicting verified conversions')
})
it('normalizes total package price to storage cost with full precision', () => {
  const c = packageCost(flour())
  expect(c.contents).toBeCloseTo(400, 10)
  expect(c.unitCost).toBeCloseTo(0.027375, 12)
  expect(
    recipeCost(
      {
        id: 'r',
        name: 'r',
        yield: 1,
        lines: [{ ingredientId: 'flour', quantity: 1, unit: 'oz' }],
        laborRate: 0,
      },
      [flour()],
    ),
  ).toBeCloseTo(0.027375, 12)
})
it('compares like-sized content rather than package totals using the supplied acceptance example', () => {
  const i = { ...flour(), storageUnit: 'lb' }
  const c = compareOffer(i, {
    purchaseQuantity: 10,
    purchaseUnit: 'lb',
    packagePrice: 4,
    currency: 'USD',
    includesTax: false,
    includesShipping: false,
  })
  expect(c.unitCost).toBeCloseTo(0.4, 10)
  expect(c.difference).toBeCloseTo(-0.038, 10)
  expect(c.percent).toBeCloseTo(-8.675799, 5)
  expect(c.equivalent).toBeCloseTo(-0.95, 10)
})
it('does not divide by a zero reference price or compare incompatible price bases', () => {
  const o = {
    purchaseQuantity: 10,
    purchaseUnit: 'lb',
    packagePrice: 4,
    includesTax: false,
    includesShipping: false,
  }
  expect(compareOffer({ ...flour(), packagePrice: 0 }, o).warning).toBe(
    'Add a reference price to compare.',
  )
  expect(
    compareOffer(flour(), { ...o, currency: 'CAD' }).difference,
  ).toBeUndefined()
  expect(
    compareOffer(flour(), { ...o, includesTax: true }).difference,
  ).toBeUndefined()
  expect(
    compareOffer(flour(), { ...o, includesTax: null }).difference,
  ).toBeUndefined()
})
it('requires explicit package contents and density conversions', () => {
  expect(() =>
    packageCost(flour(), {
      purchaseQuantity: 1,
      purchaseUnit: 'case',
      packagePrice: 4,
    }),
  ).toThrow('conversion')
  expect(() =>
    packageCost(flour(), {
      purchaseQuantity: 1,
      purchaseUnit: 'cup',
      packagePrice: 4,
    }),
  ).toThrow('conversion')
  const i = {
    ...flour(),
    conversions: [
      { from: 'case', to: 'lb', amountFrom: 1, amountTo: 25, verified: true },
    ],
  }
  expect(
    packageCost(i, {
      purchaseQuantity: 1,
      purchaseUnit: 'case',
      packagePrice: 10.95,
    }).contents,
  ).toBeCloseTo(400)
  for (const q of [0, -1])
    expect(() =>
      packageCost(flour(), {
        purchaseQuantity: q,
        purchaseUnit: 'lb',
        packagePrice: 10,
      }),
    ).toThrow('quantity')
})
it('sorts quantities numerically in canonical units, groups categories, and puts missing values last in either direction', () => {
  const rows = [
    { id: 'b', name: 'B', unit: 'lb', quantity: 2 },
    { id: 'a', name: 'A', unit: 'oz', quantity: 12 },
    { id: 'd', name: 'D', unit: 'each', quantity: 1 },
    { id: 'c', name: 'C', unit: 'cup', quantity: 1 },
    { id: 'e', name: 'E', unit: 'lb' },
  ]
  expect(
    sortIngredients(rows, { key: 'quantity', direction: 'asc' }).map(
      (i) => i.id,
    ),
  ).toEqual(['a', 'b', 'c', 'd', 'e'])
  expect(
    sortIngredients(rows, { key: 'quantity', direction: 'desc' }).map(
      (i) => i.id,
    ),
  ).toEqual(['b', 'a', 'c', 'd', 'e'])
  expect(rows[0].id).toBe('b')
})
it('normalizes costs across units and sorts values as currency', () => {
  const rows = [
    { id: 'a', name: 'A', unit: 'lb', cost: 2, quantity: 100 },
    { id: 'b', name: 'B', unit: 'oz', cost: 1, quantity: 2 },
  ]
  expect(
    sortIngredients(rows, { key: 'currentCost', direction: 'asc' })[0].id,
  ).toBe('a')
  expect(sortIngredients(rows, { key: 'value', direction: 'asc' })[0].id).toBe(
    'b',
  )
})
it('edits details and reference cost without overwriting stock, base unit, valuation or prior cost history', () => {
  const i = flour(),
    saved = updateIngredient(i, {
      ...edit(i),
      quantity: 999999,
      unit: 'lb',
      cost: 700,
      packagePrice: 12,
      name: 'Bread flour',
      storageUnit: 'lb',
      threshold: 1,
      reorderQuantity: 2,
    })
  expect(saved.quantity).toBe(i.quantity)
  expect(saved.cost).toBe(i.cost)
  expect(saved.unit).toBe('g')
  expect(saved.currentCost).toBeCloseTo(12 / 11339.80925, 12)
  expect(saved.threshold).toBeCloseTo(i.threshold, 10)
  expect(saved.costReferenceHistory[0].packagePrice).toBe(10.95)
  expect(i.name).toBe('Flour')
})
it('keeps leading zero barcodes and checks offers for duplicates', () => {
  const i = flour(),
    s = updateIngredient(i, { ...edit(i), barcode: '001234567890' })
  expect(s.barcode).toBe('001234567890')
  expect(
    duplicateBarcodes(
      [{ ...i, purchaseOffers: [{ id: 'o', barcode: '001234567890' }] }],
      '001234567890',
      'other',
    ),
  ).toEqual(['Flour'])
})
it('validates manual store prices and oven vendor ownership', () => {
  const data = {
    id: 'o',
    vendorId: 's',
    purchaseQuantity: 10,
    purchaseUnit: 'lb',
    packagePrice: 4,
    priceCheckedAt: '2026-10-30',
    barcode: '000123',
    source: 'connected_provider',
  }
  expect(() => validateOffer(flour(), data, [])).toThrow('oven')
  expect(
    validateOffer(flour(), data, [{ id: 's', name: 'Store' }]),
  ).toMatchObject({
    ingredientId: 'flour',
    barcode: '000123',
    source: 'manual',
  })
  expect(() =>
    validateOffer(flour(), { ...data, productUrl: 'javascript:alert(1)' }, [
      { id: 's', name: 'Store' },
    ]),
  ).toThrow('URL')
})
it('includes compound recipes in impacted estimates', () => {
  expect(
    affectedRecipes(
      'flour',
      [flour(), { id: 'dough', name: 'Dough', compoundRecipeId: 'prep' }],
      [
        { id: 'prep', name: 'Prep', lines: [{ ingredientId: 'flour' }] },
        { id: 'bread', name: 'Bread', lines: [{ ingredientId: 'dough' }] },
      ],
    ).map((r) => r.id),
  ).toEqual(['prep', 'bread'])
})
it('preserves legacy costs and history when package details are absent', () => {
  const i: Item = {
    ...flour(),
    purchaseQuantity: undefined,
    packagePrice: undefined,
    purchaseUnit: undefined,
    currentCost: 0.12,
    cost: 0.11,
  }
  const saved = updateIngredient(i, {
    ...edit(i),
    purchaseQuantity: '',
    packagePrice: '',
    purchaseUnit: '',
    name: 'Renamed flour',
  })
  expect(saved.name).toBe('Renamed flour')
  expect(saved.currentCost).toBe(0.12)
  expect(saved.cost).toBe(0.11)
  expect(saved.quantity).toBe(i.quantity)
  expect(saved.purchaseQuantity).toBeUndefined()
  expect(saved.packagePrice).toBeUndefined()
  expect(saved.costReferenceHistory).toEqual(i.costReferenceHistory)
  expect(compareOffer({ ...i, packagePrice: 10 }, { ...flour() }).warning).toBe(
    'Add a reference price to compare.',
  )
  expect(() =>
    updateIngredient(i, { ...edit(i), purchaseQuantity: 0, packagePrice: 10 }),
  ).toThrow('Enter a package quantity greater than zero.')
})
it('retains listed-price provenance separately when the actual package price is corrected', () => {
  const i = flour()
  const saved = updateIngredient(i, {
    ...edit(i),
    packagePrice: 12,
    listedOnlinePrice: 10.98,
    productSourceUrl: 'https://www.samsclub.com/ip/flour/13909715756',
    productCheckedAt: '2026-11-01T19:08:00Z',
  })
  expect(saved.packagePrice).toBe(12)
  expect(saved.listedOnlinePrice).toBe(10.98)
  expect(saved.productSourceUrl).toContain('13909715756')
  expect(saved.productCheckedAt).toBe('2026-11-01T19:08:00Z')
  const reopened = updateIngredient(saved, edit(saved))
  expect(reopened.listedOnlinePrice).toBe(10.98)
})
