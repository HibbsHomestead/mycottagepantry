import { expect, it } from 'vitest'
import { catalogSnapshotSchema, externalGTIN, sharedSnapshot } from './catalog'
import { barcodeMatches } from './barcodes'
it('preserves leading zeros and equates only validated UPC/EAN/GTIN-14 identities', () => {
  expect(externalGTIN('036000291452')).toBe('00036000291452')
  expect(externalGTIN('0036000291452')).toBe('00036000291452')
  expect(externalGTIN('00036000291452')).toBe('00036000291452')
  expect(externalGTIN('04252614', 'upc_e')).toBe('00042100005264')
  expect(() => externalGTIN('04252614')).toThrow()
  expect(() => externalGTIN('036000291453')).toThrow()
  expect(() => externalGTIN('36000291452')).toThrow()
  expect(() => externalGTIN('036000291452', 'code_128')).toThrow()
  const items = [
    { id: 'a', name: 'Flour', barcode: '00036000291452' },
    { id: 'b', name: 'Flour', barcode: '4006381333931' },
  ]
  expect(barcodeMatches(items, '036000291452').map((m) => m.item.id)).toEqual([
    'a',
  ])
})
it('rejects private data, unsupported generic facts and food statements on supplies', () => {
  expect(
    catalogSnapshotSchema.safeParse({
      kind: 'ingredient',
      entryType: 'generic',
      fields: { name: 'Flour', barcode: '036000291452' },
    }).success,
  ).toBe(false)
  expect(
    catalogSnapshotSchema.safeParse({
      kind: 'supply',
      entryType: 'branded',
      fields: { name: 'Gloves', subingredients: 'Latex' },
    }).success,
  ).toBe(false)
  expect(
    catalogSnapshotSchema.safeParse({
      kind: 'ingredient',
      entryType: 'branded',
      fields: { name: 'Flour', price: 4 },
    }).success,
  ).toBe(false)
  expect(
    sharedSnapshot(
      {
        name: 'Flour',
        price: 4,
        vendor: 'Private',
        notes: 'Private',
        imageAssetId: 'Private',
        sourceContains: 'Contains wheat',
      },
      'ingredient',
    ),
  ).toEqual({
    kind: 'ingredient',
    entryType: 'branded',
    fields: { name: 'Flour', sourceContains: 'Contains wheat' },
  })
})
it('keeps eight-digit formats explicit and numeric Code 128 private identifiers exact', () => {
  expect(() => externalGTIN('96385074')).toThrow(/Choose EAN-8 or UPC-E/)
  expect(externalGTIN('96385074', 'ean_8')).toBe('ean8:96385074')
  expect(() => externalGTIN('036000291452', 'ean_13')).toThrow(/length/)
  const items = [
    {
      id: 'exact',
      name: 'Internal record',
      barcode: '036000291452',
      barcodeFormat: 'code_128',
    },
  ]
  expect(barcodeMatches(items, '036000291452', 'code_128')).toHaveLength(1)
  expect(barcodeMatches(items, '0036000291452', 'ean_13')).toHaveLength(0)
})
