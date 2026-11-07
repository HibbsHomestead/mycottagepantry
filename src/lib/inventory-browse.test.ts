import { expect, it } from 'vitest'
import { demoData } from './demo'
import {
  inventoryEntries,
  onHandText,
  packageText,
  stockReceiptPreview,
  inventoryStatus,
} from './inventory-browse'
it('labels remaining stock without inventing unopened packages or changing precision', () => {
  const i = Object.freeze({
    id: 'flour',
    name: 'Flour',
    unit: 'oz',
    storageUnit: 'lb',
    quantity: 120,
    purchaseQuantity: 5,
    purchaseUnit: 'lb',
  })
  expect(onHandText(i)).toBe('7.5 lb remaining')
  expect(packageText(i)).toBe('5 lb / purchase package')
  expect(i.quantity).toBe(120)
  expect(inventoryStatus({ ...i, quantity: undefined })).toBe(
    'Stock not recorded',
  )
  expect(onHandText({ ...i, quantity: undefined })).toBe(
    'Quantity not recorded',
  )
})
it('labels fractional fabric and counted resale without changing stored values', () => {
  const i = { id: 'f', name: 'Cotton', unit: 'yd', quantity: 3.254321 }
  expect(onHandText(i)).toBe('3.254 yd remaining')
  expect(i.quantity).toBe(3.254321)
  expect(onHandText({ ...i, quantity: 0.0001 })).toBe('<0.001 yd remaining')
  expect(onHandText({ ...i, workflow: 'resale', quantity: 50 })).toBe('50 each')
})
it('previews only convertible receipts and leaves the original record unchanged', () => {
  const i = Object.freeze({ id: 'f', name: 'Flour', unit: 'lb', quantity: 7.5 })
  expect(stockReceiptPreview(i, '8', 'oz')).toBe(
    '8 lb after receiving (0.5 lb added)',
  )
  expect(stockReceiptPreview(i, '1', 'bag')).toContain(
    'verified package conversion',
  )
  expect(stockReceiptPreview(i, '', 'lb')).toBe('')
  expect(i.quantity).toBe(7.5)
})
it('requires confirmed fabric roll contents and resale pack contents', () => {
  const f = {
    id: 'f',
    name: 'Cotton',
    unit: 'yd',
    quantity: 3.25,
    materialType: 'fabric',
    fabricTracking: 'length',
  }
  expect(
    stockReceiptPreview(f, 2, 'roll', {
      usableLength: 5,
      usableLengthUnit: 'yd',
      lengthConfirmed: true,
    }),
  ).toBe('13.25 yd after receiving (10 yd added)')
  expect(stockReceiptPreview(f, 2, 'roll')).toContain('Confirm the fabric')
  const p = { id: 'p', name: 'Mug', workflow: 'resale', quantity: 50 }
  expect(stockReceiptPreview(p, 2, 'case', { itemsPerUnit: 12 })).toBe(
    '74 each after receiving (24 each added)',
  )
  expect(stockReceiptPreview(p, 2, 'case', { itemsPerUnit: '' })).toContain(
    'Confirm the sellable',
  )
})
it('keeps pantry and resale source identities separate without mutating records', () => {
  const w = demoData()
  w.products.push({ id: w.ingredients[0].id, name: 'Mug', workflow: 'resale' })
  const before = structuredClone(w)
  expect(
    inventoryEntries(w)
      .filter((e) => e.item.id === w.ingredients[0].id)
      .map((e) => e.key),
  ).toEqual([
    `ingredients:${w.ingredients[0].id}`,
    `products:${w.ingredients[0].id}`,
  ])
  expect(w).toEqual(before)
})
