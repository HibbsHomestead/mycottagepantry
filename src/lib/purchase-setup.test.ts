import { expect, it } from 'vitest'
import { convert, recipeCost, type Item } from './domain'
import { packageCost, updateIngredient } from './ingredients'
import {
  applyPurchaseSetup,
  purchaseSetupView,
  validateConversions,
} from './purchase-setup'
const bottle = (): Item => ({
  id: 'sugar',
  name: 'Sugar',
  unit: 'g',
  storageUnit: 'oz',
  recipeUnit: 'oz',
  quantity: 100,
  cost: 0.04,
  currentCost: 5.99 / convert(3.7, 'oz', 'g'),
  threshold: 0,
  purchaseQuantity: 1,
  purchaseUnit: 'bottle',
  packagePrice: 5.99,
  conversions: [
    { from: 'bottle', to: 'oz', amountFrom: 1, amountTo: 3.7, verified: true },
  ],
})
const draft = (i: Item) => ({
  ...i,
  purchaseOffers: undefined,
  purchaseSetup: purchaseSetupView(i).setup,
})
it('maps the weight-stock example without changing canonical stock, valuation, price basis or recipe costs', () => {
  const i = bottle(),
    saved = updateIngredient(i, draft(i))
  expect(saved.purchaseSetup).toEqual({
    packageUnit: 'bottle',
    price: 5.99,
    stockUnits: 3.7,
  })
  expect(packageCost(saved).unitCost).toBeCloseTo(1.6189189189189, 12)
  for (const key of [
    'unit',
    'quantity',
    'cost',
    'currentCost',
    'purchaseQuantity',
    'purchaseUnit',
    'packagePrice',
  ])
    expect(saved[key]).toBe(i[key])
  expect(
    recipeCost(
      {
        id: 'r',
        name: 'r',
        yield: 1,
        lines: [{ ingredientId: i.id, quantity: 2, unit: 'oz' }],
      },
      [saved],
    ),
  ).toBeCloseTo((2 * 5.99) / 3.7, 12)
  expect(updateIngredient(saved, draft(saved))).toEqual(saved)
})
it('tracks identical package/stock units and only converts a recipe when a valid relationship exists', () => {
  const i = {
    ...bottle(),
    unit: 'bottle',
    storageUnit: 'bottle',
    quantity: 3,
    cost: 5.99,
    currentCost: 5.99,
  }
  expect(purchaseSetupView(i).setup.stockUnits).toBe(1)
  expect(packageCost(updateIngredient(i, draft(i))).baseCost).toBe(5.99)
  const missing = { ...i, conversions: [] }
  expect(updateIngredient(missing, draft(missing)).recipeUnit).toBe('oz')
  expect(() => convert(1, 'oz', 'bottle', missing.conversions)).toThrow(
    'conversion',
  )
  expect(() =>
    updateIngredient(i, {
      ...draft(i),
      purchaseSetup: { packageUnit: 'bottle', price: 5.99, stockUnits: 2 },
    }),
  ).toThrow('exactly 1')
})
it('preserves totals covering several packages and divides only the presentation price', () => {
  const i: Item = { ...bottle(), purchaseQuantity: 3, packagePrice: 17.97 }
  const view = purchaseSetupView(i)
  expect(view.setup.price).toBeCloseTo(5.99, 12)
  const saved = updateIngredient(i, draft(i))
  expect(saved.purchaseQuantity).toBe(3)
  expect(saved.packagePrice).toBe(17.97)
  expect(saved.currentCost).toBe(i.currentCost)
  const changed = updateIngredient(i, {
    ...draft(i),
    purchaseSetup: { ...view.setup, price: 6.99 },
  })
  expect(changed.legacyPurchaseBasis).toMatchObject({
    purchaseQuantity: 3,
    packagePrice: 17.97,
  })
  expect(changed.currentCost).toBeCloseTo(6.99 / convert(3.7, 'oz', 'g'), 12)
  expect(changed.cost).toBe(i.cost)
  expect(changed.quantity).toBe(i.quantity)
})
it('flags measurement totals and ambiguous pack grouping for review; unrelated edits keep their saved meaning', () => {
  const flour = {
    ...bottle(),
    purchaseQuantity: 25,
    purchaseUnit: 'lb',
    packagePrice: 10.95,
    conversions: [],
  }
  expect(purchaseSetupView(flour).review).toContain('unknown')
  const saved = updateIngredient(flour, {
    ...draft(flour),
    name: 'Renamed flour',
  })
  expect(saved.packagePrice).toBe(10.95)
  expect(saved.purchaseQuantity).toBe(25)
  expect(saved.purchaseSetup).toBeUndefined()
  expect(() =>
    applyPurchaseSetup(flour, {
      ...draft(flour),
      purchaseSetup: { packageUnit: 'bag', price: 10.95, stockUnits: 400 },
    }),
  ).toThrow('Confirm')
  const ambiguous = {
    ...bottle(),
    purchaseQuantity: 75,
    purchaseUnit: 'pack',
    conversions: [
      { from: 'pack', to: 'each', amountFrom: 1, amountTo: 75, verified: true },
    ],
  }
  expect(purchaseSetupView(ambiguous).review).toBeTruthy()
})
it('creates one authoritative package relationship and rejects duplicates, zero, negative, standard and alternate-path conflicts', () => {
  const i = {
    ...bottle(),
    conversions: [],
    purchaseQuantity: undefined,
    packagePrice: undefined,
  }
  const mapped = applyPurchaseSetup(i, {
    ...draft(i),
    purchaseSetupConfirmed: true,
    purchaseSetup: { packageUnit: 'bottle', price: 5.99, stockUnits: 3.7 },
  })
  expect(mapped.conversions).toHaveLength(1)
  const c = mapped.conversions[0]
  expect(() =>
    validateConversions([
      c,
      { ...c, from: 'oz', to: 'bottle', amountFrom: 3.7, amountTo: 1 },
    ]),
  ).toThrow('Duplicate')
  expect(() => validateConversions([{ ...c, amountTo: 0 }])).toThrow()
  expect(() => validateConversions([{ ...c, amountTo: -2 }])).toThrow()
  expect(() =>
    validateConversions([
      { from: 'g', to: 'kg', amountFrom: 1, amountTo: 1, verified: true },
    ]),
  ).toThrow('Conflicting')
  expect(() =>
    validateConversions([
      c,
      { from: 'bottle', to: 'g', amountFrom: 1, amountTo: 12, verified: true },
    ]),
  ).toThrow('Conflicting')
  expect(() =>
    validateConversions([
      {
        from: 'tsp',
        to: 'mg',
        amountFrom: '1/8',
        amountTo: 600,
        verified: true,
      },
    ]),
  ).not.toThrow()
})
