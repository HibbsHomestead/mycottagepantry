import { expect, it } from 'vitest'
import { minimumOrder } from './item-restocking'
import { stockStatus, updateIngredient } from './ingredients'
import { changeStockShelfUnit } from './ingredient-stock-unit'
import { demoData } from './demo'

it('keeps an absent minimum blank and never supplies a supplier minimum', () => {
  expect(minimumOrder({ id: 'x', name: 'Bag', unit: 'each' })).toEqual({
    minimumOrderQuantity: null,
    minimumOrderUnit: '',
  })
})
it('uses purchase packs independently of stock each and does not mutate stock or reorder levels', () => {
  const item = {
    id: 'x',
    name: 'Bags',
    unit: 'each',
    purchaseUnit: 'pack',
    itemsPerUnit: 100,
    threshold: 25,
    quantity: 7,
    cost: 3,
    minimumOrderQuantity: '2',
  }
  expect(minimumOrder(item)).toEqual({
    minimumOrderQuantity: 2,
    minimumOrderUnit: 'pack',
  })
  expect(item).toMatchObject({ threshold: 25, quantity: 7, cost: 3 })
})
it.each(['0', '-1', 'NaN', 'Infinity', '0.5'])(
  'rejects invalid count purchase minimum %s',
  (minimumOrderQuantity) => {
    expect(() =>
      minimumOrder({
        id: 'x',
        name: 'Bags',
        purchaseUnit: 'pack',
        minimumOrderQuantity,
      }),
    ).toThrow(/positive|whole/)
  },
)
it('allows measured fractional minimums and converts purchase-unit changes when verified', () => {
  expect(
    minimumOrder({
      id: 'x',
      name: 'Flour',
      purchaseUnit: 'kg',
      minimumOrderQuantity: '0.5',
    }).minimumOrderQuantity,
  ).toBe(0.5)
  expect(
    minimumOrder({
      id: 'x',
      name: 'Flour',
      purchaseUnit: 'g',
      minimumOrderQuantity: 2,
      minimumOrderUnit: 'kg',
    }).minimumOrderQuantity,
  ).toBe(2000)
  expect(() =>
    minimumOrder({
      id: 'x',
      name: 'Bags',
      purchaseUnit: 'case',
      minimumOrderQuantity: 2,
      minimumOrderUnit: 'pack',
    }),
  ).toThrow(/Review/)
})
it('converts reorder levels between stock units and requires review for unverified relationships', () => {
  expect(
    changeStockShelfUnit(
      { id: 'x', name: 'Flour', unit: 'kg', threshold: 2 },
      'g',
    ).threshold,
  ).toBe(2000)
  expect(
    changeStockShelfUnit(
      { id: 'x', name: 'Flour', unit: 'kg', threshold: 2 },
      'cup',
    ).threshold,
  ).toBe('')
  expect(
    stockStatus({
      id: 'x',
      name: 'Flour',
      unit: 'g',
      quantity: 25,
      threshold: 25,
    }),
  ).toBe('Low stock')
})
it('persists a minimum with ordinary item edits without changing cost, threshold or stock', () => {
  const original = demoData().ingredients.find((i) => i.usedAs !== 'packaging')!
  const updated = updateIngredient(original, {
    ...original,
    storageUnit: original.unit,
    reorderQuantity: 0,
    minimumOrderQuantity: 2,
    minimumOrderUnit: original.purchaseUnit,
  })
  expect(updated).toMatchObject({
    minimumOrderQuantity: 2,
    minimumOrderUnit: original.purchaseUnit,
    quantity: original.quantity,
    cost: original.cost,
    threshold: original.threshold,
  })
})
