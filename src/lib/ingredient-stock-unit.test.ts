import { expect, it } from 'vitest'
import { convert, type Item } from './domain'
import {
  changeStockShelfUnit,
  ingredientHasStockHistory,
} from './ingredient-stock-unit'
import { updateIngredient } from './ingredients'

export const jar: Item = {
  id: 'jar',
  name: 'Synthetic jar ingredient',
  unit: 'ml',
  storageUnit: 'cup',
  recipeUnit: 'oz',
  quantity: 0,
  cost: 0.1,
  currentCost: 0.1,
  purchaseQuantity: 1,
  purchaseUnit: 'jar',
  packagePrice: 6.98,
  currency: 'USD',
  threshold: 0,
  reorderQuantity: 0,
  conversions: [
    { from: 'jar', to: 'cup', amountFrom: 1, amountTo: 0.375, verified: true },
  ],
  purchaseSetup: { packageUnit: 'jar', price: 6.98, stockUnits: 0.375 },
}
const weightDraft = () => ({
  ...jar,
  ...changeStockShelfUnit(jar, 'oz'),
  purchaseOffers: undefined,
})

it('accepts oz without converting zero reorder settings or relabeling 0.375 cups', () => {
  const draft = weightDraft()
  expect(draft).toMatchObject({
    storageUnit: 'oz',
    threshold: 0,
    reorderQuantity: 0,
    purchaseSetup: { packageUnit: 'jar', stockUnits: '' },
  })
  expect(jar.purchaseSetup.stockUnits).toBe(0.375)
})

it('clears nonzero reorder settings that cannot be converted', () => {
  const patch = changeStockShelfUnit(
    { ...jar, threshold: 2, reorderQuantity: 4 },
    'oz',
  )
  expect(patch).toMatchObject({ threshold: '', reorderQuantity: '' })
})

it('converts package and reorder amounts only through known relationships', () => {
  const patch = changeStockShelfUnit(
    {
      ...jar,
      storageUnit: 'lb',
      threshold: 2,
      reorderQuantity: 3,
      purchaseSetup: { ...jar.purchaseSetup, stockUnits: 0.5 },
    },
    'oz',
  )
  expect(patch).toMatchObject({
    threshold: 32,
    reorderQuantity: 48,
    purchaseSetup: { stockUnits: 8 },
  })
})

it('ignores unverified imported package weights', () => {
  const patch = changeStockShelfUnit(
    { ...jar, onlinePackageQuantity: 3, onlinePackageUnit: 'oz' },
    'oz',
  )
  expect(patch.purchaseSetup?.stockUnits).toBe('')
})

it('uses a verified net weight per jar without a cup conversion and recalculates cost for the new basis', () => {
  const existing = {
    ...jar,
    conversions: [
      { from: 'jar', to: 'oz', amountFrom: 1, amountTo: 3, verified: true },
    ],
  }
  const draft = {
    ...existing,
    ...changeStockShelfUnit(existing, 'oz'),
    purchaseOffers: undefined,
    confirmEmptyStockUnitChange: true,
    purchaseSetupConfirmed: true,
  }
  expect(draft.purchaseSetup.stockUnits).toBe(3)
  const saved = updateIngredient(existing, draft, { hasStockHistory: false })
  expect(saved.currentCost).toBeCloseTo(6.98 / convert(3, 'oz', 'g'))
  expect(saved.cost).toBe(saved.currentCost)
  expect(saved.unit).toBe('g')
})

it('requires both verified contents and explicit empty-item confirmation before changing canonical units', () => {
  const draft = weightDraft()
  expect(() =>
    updateIngredient(jar, draft, { hasStockHistory: false }),
  ).toThrow('Confirm the new stock basis')
  draft.confirmEmptyStockUnitChange = true
  expect(() =>
    updateIngredient(jar, draft, { hasStockHistory: false }),
  ).toThrow('Enter the price and stock units')
  // This is a synthetic user-confirmed package net weight, never inferred from cups.
  draft.purchaseSetup.stockUnits = 3
  const saved = updateIngredient(jar, draft, { hasStockHistory: false })
  expect(saved).toMatchObject({
    unit: 'g',
    storageUnit: 'oz',
    recipeUnit: 'oz',
    purchaseUnit: 'jar',
    quantity: 0,
    purchaseSetup: { stockUnits: 3 },
  })
  expect(convert(1, 'jar', 'oz', saved.conversions)).toBeCloseTo(3)
  expect(() => convert(1, 'cup', 'oz', saved.conversions)).toThrow(
    'verified unit conversion',
  )
  expect(saved.currentCost).toBeCloseTo(6.98 / convert(3, 'oz', 'g'))
  expect(saved.cost).toBe(saved.currentCost)
  expect(jar.unit).toBe('ml')
  expect(jar.purchaseSetup.stockUnits).toBe(0.375)
})

it('blocks history and ignores client claims that an item has no history', () => {
  const draft = {
    ...weightDraft(),
    confirmEmptyStockUnitChange: true,
    purchaseSetup: { ...jar.purchaseSetup, stockUnits: 3 },
    hasStockHistory: false,
  }
  expect(() => updateIngredient(jar, draft)).toThrow('Stock/history')
  expect(() =>
    updateIngredient({ ...jar, quantity: 1 }, draft, {
      hasStockHistory: false,
    }),
  ).toThrow('Stock/history')
  expect(() => updateIngredient(jar, draft, { hasStockHistory: true })).toThrow(
    'Stock/history',
  )
})

it('rejects simultaneous opening stock or blank reorder settings during a basis change', () => {
  const draft = {
    ...weightDraft(),
    confirmEmptyStockUnitChange: true,
    purchaseSetup: { ...jar.purchaseSetup, stockUnits: 3 },
  }
  expect(() =>
    updateIngredient(
      jar,
      { ...draft, openingStock: { enabled: true } },
      { hasStockHistory: false },
    ),
  ).toThrow('Save the new stock basis first')
  expect(() =>
    updateIngredient(
      jar,
      { ...draft, threshold: '' },
      { hasStockHistory: false },
    ),
  ).toThrow('Re-enter reorder')
})

it('keeps canonical stock and valuation after an explicitly measured conversion', () => {
  const existing = { ...jar, quantity: 100 }
  const conversions = [
    ...jar.conversions,
    {
      from: 'cup',
      to: 'oz',
      amountFrom: 1,
      amountTo: 8,
      verified: true,
      source: 'user_entered',
    },
  ]
  const draft = {
    ...jar,
    ...changeStockShelfUnit({ ...jar, conversions }, 'oz'),
    conversions,
    purchaseOffers: undefined,
  }
  const saved = updateIngredient(existing, draft, { hasStockHistory: true })
  expect(saved).toMatchObject({
    unit: 'ml',
    storageUnit: 'oz',
    quantity: 100,
    cost: jar.cost,
  })
  expect(saved.purchaseSetup.stockUnits).toBeCloseTo(3)
})

it.each([
  { ledger: [{ id: 'l', name: 'old receipt', ingredientId: jar.id }] },
  {
    inventory_counts: [
      { id: 'c', name: 'old count', lines: [{ ingredientId: jar.id }] },
    ],
  },
  {
    batches: [
      { id: 'b', name: 'completed batch', usage: [{ ingredientId: jar.id }] },
    ],
  },
])('detects history even when the balance is zero: %j', (workspace) => {
  expect(
    ingredientHasStockHistory(jar, {
      ledger: [],
      inventory_counts: [],
      batches: [],
      ...workspace,
    }),
  ).toBe(true)
})
