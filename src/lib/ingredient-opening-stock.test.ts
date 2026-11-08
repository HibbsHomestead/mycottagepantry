import { expect, it } from 'vitest'
import { openingStockEntry } from './ingredient-opening-stock'
import type { Item } from './domain'
const item = (): Item => ({
  id: 'applesauce',
  name: 'Applesauce',
  unit: 'each',
  storageUnit: 'each',
  quantity: 0,
  cost: 2,
  currentCost: 2,
})
const input = () => ({
  enabled: true,
  operationId: 'stable-operation',
  quantity: '3',
  unit: 'each',
  value: '6',
  date: '2026-11-08',
})

it('plans exactly 3 each, with a matching ledger and owner-equity journal, without mutating the draft', () => {
  const i = item(),
    data = input(),
    before = structuredClone({ i, data })
  const result = openingStockEntry(i, data, [])!
  expect(result.replay).toBe(false)
  if (result.replay) throw new Error('Unexpected replay')
  expect(result.item).toMatchObject({ quantity: 3, cost: 2, unit: 'each' })
  expect(result.ledger).toMatchObject({
    quantity: 3,
    unit: 'each',
    amount: 6,
    type: 'opening_balance',
    openingCountUnit: 'each',
  })
  expect(result.journal?.lines).toEqual([
    { account: 'Inventory asset', debit: 6, credit: 0 },
    { account: 'Owner equity', debit: 0, credit: 6 },
  ])
  expect({ i, data }).toEqual(before)
})
it('treats a retry as the same operation and rejects reused IDs with different values or a second opening', () => {
  const first = openingStockEntry(item(), input(), [])!
  if (first.replay) throw new Error('Unexpected replay')
  expect(openingStockEntry(first.item, input(), [first.ledger])?.replay).toBe(
    true,
  )
  expect(() =>
    openingStockEntry(first.item, { ...input(), quantity: 4 }, [first.ledger]),
  ).toThrow('different values')
  expect(() =>
    openingStockEntry(first.item, { ...input(), operationId: 'another' }, [
      first.ledger,
    ]),
  ).toThrow('Stock history')
})
it('creates no entry for ordinary edits or disabled opening stock; rejects history even at zero balance', () => {
  expect(openingStockEntry(item(), undefined, [])).toBeNull()
  expect(
    openingStockEntry(item(), { ...input(), enabled: false }, []),
  ).toBeNull()
  expect(() =>
    openingStockEntry(item(), input(), [
      {
        id: 'used',
        name: 'Receipt',
        ingredientId: 'applesauce',
        type: 'purchase_receipt',
      },
    ]),
  ).toThrow('Stock history')
  expect(() =>
    openingStockEntry({ ...item(), openingStockRecorded: true }, input(), []),
  ).toThrow('Stock history')
})
it('validates the saved unit and normalizes storage quantities only through verified conversions', () => {
  expect(() =>
    openingStockEntry(item(), { ...input(), unit: 'g' }, []),
  ).toThrow('Inventory unit changed')
  const result = openingStockEntry(
    { ...item(), unit: 'g', storageUnit: 'kg' },
    { ...input(), quantity: 0.5, unit: 'kg' },
    [],
  )!
  if (result.replay) throw new Error('Unexpected replay')
  expect(result.item.quantity).toBe(500)
  expect(result.ledger.unit).toBe('g')
  expect(() =>
    openingStockEntry(item(), { ...input(), quantity: 0 }, []),
  ).toThrow('quantity')
  expect(() =>
    openingStockEntry(item(), { ...input(), value: '' }, []),
  ).toThrow('value')
})
