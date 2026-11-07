import { expect, it } from 'vitest'
import {
  inventoryAdjustmentPlan,
  inventoryMovementView,
} from './inventory-adjustment'

const counted = {
  id: 'cups',
  name: 'Applesauce cups',
  unit: 'each',
  storageUnit: 'each',
  recipeUnit: 'g',
  quantity: 2,
  cost: 0.4,
}
const weighted = {
  ...counted,
  unit: 'g',
  quantity: 200,
  conversions: [
    { from: 'each', to: 'g', amountFrom: 1, amountTo: 100, verified: true },
  ],
}

it('sets six each as the total while a quantity change adds six each', () => {
  const before = structuredClone(counted)
  expect(
    inventoryAdjustmentPlan(counted, {
      quantity: 6,
      unit: 'each',
      adjustmentMode: 'total',
    }),
  ).toMatchObject({
    change: 4,
    resultingQuantity: 6,
    previousInventoryQuantity: 2,
    resultingInventoryQuantity: 6,
    inventoryUnit: 'each',
  })
  expect(
    inventoryAdjustmentPlan(counted, { quantity: 6, unit: 'each' }),
  ).toMatchObject({ change: 6, resultingQuantity: 8 })
  expect(counted).toEqual(before)
})
it('uses only a saved weight relationship for both number and unit, never the recipe unit', () => {
  const plan = inventoryAdjustmentPlan(weighted, {
    quantity: 6,
    unit: 'each',
    adjustmentMode: 'total',
  })
  expect(plan).toMatchObject({
    change: 400,
    resultingQuantity: 600,
    previousInventoryQuantity: 2,
    inventoryQuantity: 4,
    resultingInventoryQuantity: 6,
    inventoryUnit: 'each',
  })
  expect(
    inventoryAdjustmentPlan(weighted, { quantity: -0.5, unit: 'each' }),
  ).toMatchObject({
    change: -50,
    resultingQuantity: 150,
    resultingInventoryQuantity: 1.5,
  })
})
it('reproduces a legacy grams balance with saved case-to-each and each-to-ounce relationships', () => {
  const item = {
    id: 'legacy-cups',
    name: 'Legacy cup fixture',
    unit: 'g',
    storageUnit: 'each',
    recipeUnit: 'each',
    quantity: 34,
    conversions: [
      { from: 'bag', to: 'lb', amountFrom: 1, amountTo: 13.5, verified: true },
      {
        from: 'case',
        to: 'each',
        amountFrom: 1,
        amountTo: '36',
        verified: true,
      },
      {
        from: 'each',
        to: 'oz',
        amountFrom: 1,
        amountTo: '3.9',
        verified: true,
      },
    ],
  }
  const before = structuredClone(item)
  const plan = inventoryAdjustmentPlan(item, {
    quantity: 6,
    unit: 'each',
    adjustmentMode: 'total',
  })
  expect(plan.resultingQuantity).toBeCloseTo(663.378841125, 8)
  expect(plan.change).toBeCloseTo(629.378841125, 8)
  expect(plan.previousInventoryQuantity).toBeCloseTo(0.307516591355, 8)
  expect(plan.resultingInventoryQuantity).toBeCloseTo(6, 10)
  expect(item).toEqual(before)
})
it.each([
  { conversions: [] },
  {
    conversions: [
      { from: 'each', to: 'g', amountFrom: 1, amountTo: 100, verified: false },
    ],
  },
])(
  'rejects missing or unverified weight-per-each conversions',
  ({ conversions }) => {
    expect(() =>
      inventoryAdjustmentPlan(
        { ...weighted, conversions },
        { quantity: 6, unit: 'each', adjustmentMode: 'total' },
      ),
    ).toThrow(/verified unit conversion/)
  },
)
it('accepts an explicit zero total, rejects empty, negative totals, underflow and unknown methods', () => {
  expect(
    inventoryAdjustmentPlan(counted, {
      quantity: 0,
      unit: 'each',
      adjustmentMode: 'total',
    }),
  ).toMatchObject({ change: -2, resultingQuantity: 0 })
  for (const data of [
    { quantity: '' },
    { quantity: 'invalid' },
    { quantity: -3 },
    { quantity: 0 },
    { quantity: -1, adjustmentMode: 'total' },
    { quantity: 6, adjustmentMode: 'unknown' },
  ])
    expect(() =>
      inventoryAdjustmentPlan(counted, { unit: 'each', ...data }),
    ).toThrow()
})
it('uses a historical snapshot only for new entries and preserves the original canonical entry', () => {
  const old = {
    id: 'old',
    name: 'Old adjustment',
    quantity: 34,
    unit: 'g',
    enteredQuantity: 34,
    enteredUnit: 'g',
  }
  expect(inventoryMovementView(old)).toBe(old)
  const entry = {
    ...old,
    inventoryQuantity: 4,
    inventoryUnit: 'each',
    normalizedQuantity: 400,
    normalizedUnit: 'g',
  }
  expect(inventoryMovementView(entry)).toMatchObject({
    quantity: 4,
    unit: 'each',
    normalizedQuantity: 400,
    normalizedUnit: 'g',
  })
  expect(entry.quantity).toBe(34)
})
