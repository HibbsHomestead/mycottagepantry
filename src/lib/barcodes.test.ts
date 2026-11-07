import { expect, it } from 'vitest'
import {
  barcodeText,
  normalizedBarcode,
  barcodeMatches,
  internalItemId,
  internalItemCode,
} from './barcodes'
import { countQuantity, assertCountUnchanged } from './inventory-count'
import {
  defaultShelfMedia,
  shelfLayout,
  shelfLines,
  validateShelfMedia,
} from './shelf-labels'
it('preserves strings/leading zeros and resolves valid UPC-A to EAN-13 without folding arbitrary codes', () => {
  expect(barcodeText('001234')).toBe('001234')
  expect(normalizedBarcode('036000291452')).toBe('0036000291452')
  expect(normalizedBarcode('04252614', 'upc_e')).toBe('0042100005264')
  expect(normalizedBarcode('04252614')).toBe('04252614')
  expect(normalizedBarcode('036000291453')).toBe('036000291453')
  expect(() => barcodeText('x\n<script>')).toThrow()
  const items = [
    {
      id: 'a',
      name: 'A',
      barcode: '036000291452',
      purchaseOffers: [{ id: 'package', barcode: '0036000291452' }],
    },
    { id: 'b', name: 'B', barcode: '0036000291452' },
  ]
  expect(barcodeMatches(items, '0036000291452')).toHaveLength(3)
  expect(barcodeMatches(items, 'unknown')).toEqual([])
})
it('treats QR text as a selector only and rejects arbitrary links', () => {
  expect(internalItemId(internalItemCode('item_1'))).toBe('item_1')
  expect(internalItemId('https://evil.example/private')).toBeNull()
  expect(internalItemId('cottage-pantry:item:..%2Fprivate')).toBeNull()
})
it('counts on-hand quantities with verified conversions and refuses stale inventory', () => {
  const i = { id: 'a', name: 'A', quantity: 5, unit: 'lb' }
  expect(countQuantity('0.5', 'lb', i)).toBe(0.5)
  expect(countQuantity('8', 'oz', i)).toBe(0.5)
  expect(() => countQuantity('1', 'bag', i)).toThrow()
  expect(() => countQuantity('', 'lb', i)).toThrow()
  expect(() =>
    countQuantity('1', 'lb', { ...i, trackInventory: false }),
  ).toThrow()
  expect(() =>
    assertCountUnchanged(
      [
        {
          id: 'line',
          name: 'Line',
          ingredientId: 'a',
          inventoryRevision: 'old',
        },
      ],
      [i],
      () => 'new',
    ),
  ).toThrow(/recount/)
})
it('builds shelf labels without price/balance defaults and respects physical printable bounds', () => {
  const i = {
    id: 'a',
    name: 'Flour',
    storageLocation: 'Bin 2',
    quantity: 500,
    price: 12,
    threshold: 16,
    unit: 'oz',
    storageUnit: 'lb',
    sku: 'F01',
    barcode: '001234',
  }
  const f = {
    location: true,
    reorder: false,
    sku: false,
    barcode: false,
    qr: false,
    text: '',
  }
  expect(shelfLines(i, f)).toEqual(['Flour', 'Bin 2'])
  expect(shelfLines(i, { ...f, reorder: true })).toContain('Reorder: 1 lb')
  expect(() =>
    validateShelfMedia({ ...defaultShelfMedia, marginY: 10 }),
  ).toThrow()
  expect(
    shelfLayout(
      ['long text that must never disappear'],
      { ...defaultShelfMedia, width: 10, height: 8 },
      false,
    ).clipped,
  ).toBe(true)
  expect(shelfLayout(['Flour'], defaultShelfMedia, false).clipped).toBe(false)
  expect(
    shelfLayout(['Flour'], { ...defaultShelfMedia, fontSize: 7 }, false).small,
  ).toBe(true)
})
