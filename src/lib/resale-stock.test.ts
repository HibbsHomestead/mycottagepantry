import { expect, it } from 'vitest'
import {
  resaleStockPlan,
  resaleStockPreview,
  stockEntrySummary,
  stockUnitLabel,
  suspiciousResaleCounts,
  titlePackSize,
} from './resale-stock'
import type { Item, Workspace } from './domain'

const existing = (extra: Item) =>
  resaleStockPlan({
    stockChoice: 'existing',
    sellUnit: 'bottle',
    costBasis: 'unit',
    costAmount: 1,
    ...extra,
  } as unknown as Item)

it('counts 15 individual bottles as 15 bottles', () => {
  const plan = existing({
    countMethod: 'direct',
    startingCount: 15,
  } as unknown as Item)
  expect(plan.quantity).toBe(15)
  expect(plan.names.plural).toBe('bottles')
})
it('counts 1 case of 15 as 15 bottles', () => {
  expect(
    existing({
      countMethod: 'packs',
      packCount: 1,
      unitsPerPack: 15,
    } as unknown as Item).quantity,
  ).toBe(15)
})
it('counts 2 cases of 15 plus 3 loose as 33 bottles', () => {
  expect(
    existing({
      countMethod: 'packs',
      packCount: 2,
      unitsPerPack: 15,
      looseUnits: 3,
    } as unknown as Item).quantity,
  ).toBe(33)
})
it('uses only the active entry method; never multiplies a converted count again', () => {
  const plan = existing({
    countMethod: 'direct',
    startingCount: 15,
    packCount: 15,
    unitsPerPack: 15,
    looseUnits: 4,
  } as unknown as Item)
  expect(plan.quantity).toBe(15)
  expect(plan.entry).not.toHaveProperty('packCount')
})
it('tracks sealed packs, not loose contents', () => {
  const plan = resaleStockPlan({
    stockChoice: 'existing',
    sellUnit: 'sealed pack',
    packContents: '15 bottles',
    countMethod: 'direct',
    startingCount: 4,
    costBasis: 'unit',
    costAmount: 9,
  } as unknown as Item)
  expect(plan.quantity).toBe(4)
  expect(plan.names.plural).toBe('sealed packs')
  expect(plan.totalCost).toBe(36)
  expect(stockUnitLabel({ stockEntry: plan.entry } as unknown as Item, 4)).toBe(
    'sealed packs',
  )
})
it('produces consistent previews for per-unit, per-case and total cost', () => {
  const counts = {
    countMethod: 'packs',
    packCount: 2,
    unitsPerPack: 15,
    looseUnits: 3,
  }
  const unit = existing({
    ...counts,
    costBasis: 'unit',
    costAmount: 0.5,
  } as unknown as Item)
  const pack = existing({
    ...counts,
    costBasis: 'pack',
    costAmount: 7.5,
  } as unknown as Item)
  const total = existing({
    ...counts,
    costBasis: 'total',
    costAmount: 16.5,
  } as unknown as Item)
  for (const plan of [unit, pack, total]) {
    expect(plan.quantity).toBe(33)
    expect(plan.totalCost).toBe(16.5)
    expect(plan.unitCost).toBeCloseTo(0.5)
  }
  const purchase = resaleStockPlan({
    stockChoice: 'purchase',
    sellUnit: 'bottle',
    purchaseQuantity: 2,
    purchaseUnit: 'case',
    itemsPerUnit: 15,
    packageContentsConfirmed: true,
    costBasis: 'pack',
    costAmount: 7.5,
  } as unknown as Item)
  expect(purchase.quantity).toBe(30)
  expect(purchase.totalCost).toBe(15)
})
it('rejects a pack cost basis when counting individual units', () => {
  expect(() =>
    existing({
      countMethod: 'direct',
      startingCount: 3,
      costBasis: 'pack',
    } as unknown as Item),
  ).toThrow(/how you are entering the cost/)
})
it('never treats an unknown or blank cost as zero', () => {
  expect(() =>
    existing({
      countMethod: 'direct',
      startingCount: 3,
      costBasis: 'unknown',
    } as unknown as Item),
  ).toThrow(/needs an acquisition cost/)
  expect(() =>
    existing({
      countMethod: 'direct',
      startingCount: 3,
      costAmount: '',
    } as unknown as Item),
  ).toThrow(/acquisition cost/)
  const free = existing({
    countMethod: 'direct',
    startingCount: 3,
    costAmount: 0,
  } as unknown as Item)
  expect(free.totalCost).toBe(0)
})
it('requires the sellable unit before stock is added', () => {
  expect(
    resaleStockPreview({
      stockChoice: 'existing',
      startingCount: 2,
    } as unknown as Item).error,
  ).toMatch(/sellable unit/)
  expect(
    resaleStockPlan({ stockChoice: 'none' } as unknown as Item).quantity,
  ).toBe(0)
})
it('requires confirmed purchase contents', () => {
  expect(() =>
    resaleStockPlan({
      stockChoice: 'purchase',
      sellUnit: 'bottle',
      purchaseQuantity: 1,
      purchaseUnit: 'case',
      itemsPerUnit: 15,
      costBasis: 'total',
      costAmount: 10,
    } as unknown as Item),
  ).toThrow(/Confirm/)
})
it('reads pack sizes from titles as contents, and flags likely double multiplication', () => {
  expect(titlePackSize('Sparkling water 15 pack')).toBe(15)
  expect(titlePackSize('Mug')).toBe(0)
  const w = {
    products: [
      {
        id: 'a',
        name: 'Sparkling water 15 pack',
        workflow: 'resale',
        quantity: 225,
      },
      {
        id: 'b',
        name: 'Soda',
        workflow: 'resale',
        quantity: 36,
        purchaseUnit: 'case',
        purchaseQuantity: 6,
        itemsPerUnit: 6,
      },
      { id: 'c', name: 'Juice 15 pack', workflow: 'resale', quantity: 15 },
      {
        id: 'd',
        name: 'Tea 15 pack',
        workflow: 'resale',
        quantity: 225,
        stockEntry: { choice: 'existing' },
      },
    ],
  } as unknown as Workspace
  const flagged = suspiciousResaleCounts(w)
  expect(flagged.map((f) => [f.product.id, f.proposed])).toEqual([
    ['a', 15],
    ['b', 6],
  ])
})
it('summarizes a saved entry so reopening shows units, quantities and cost basis', () => {
  const plan = resaleStockPlan({
    stockChoice: 'existing',
    sellUnit: 'bottle',
    countMethod: 'packs',
    packCount: 2,
    unitsPerPack: 15,
    looseUnits: 3,
    costBasis: 'pack',
    costAmount: 7.5,
  } as unknown as Item)
  expect(stockEntrySummary(plan.entry)).toBe(
    '2 × 15 + 3 loose = 33 bottles · cost entered per pack/case',
  )
})
