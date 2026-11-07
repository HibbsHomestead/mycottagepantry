// @vitest-environment node
import { expect, it } from 'vitest'
import { ovenToday, ovenTimestamp } from './oven-dates'
import {
  applyReceivedDateCorrections,
  receiveDateCorrection,
  receivedDateReview,
} from './received-dates'
import { productDetails } from '../../netlify/lib/product-import'
import { productImportResponse } from './product-import-response'
import { planFinance } from './finance'
import { reviewedProductMetadata } from './inventory-product'
import type { Workspace, Item } from './domain'
const zone = { timezone: 'America/Chicago' }
it('keeps reviewed supplier selections linked to this Oven without changing stock fields', () => {
  const vendors = [{ id: 'supplier', name: 'Material shop' }]
  const input = {
    vendorId: 'supplier',
    vendor: 'Untrusted label',
    quantity: 999,
    cost: 1,
    price: 1,
  }
  expect(
    reviewedProductMetadata({ usedAs: 'material' }, input, vendors),
  ).toEqual({
    vendorId: 'supplier',
    vendor: 'Material shop',
  })
  expect(
    reviewedProductMetadata({ workflow: 'resale' }, input, vendors),
  ).toEqual({
    supplierId: 'supplier',
    vendor: 'Material shop',
  })
  expect(() =>
    reviewedProductMetadata({}, { vendorId: 'other-oven' }, vendors),
  ).toThrow('this oven')
})
it('uses the Oven timezone across evening, midnight, DST and different server zones', () => {
  const old = process.env.TZ
  try {
    for (const serverZone of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
      process.env.TZ = serverZone
      for (const [instant, date] of [
        ['2026-11-04T03:18:00Z', '2026-11-03'],
        ['2026-11-04T05:59:59Z', '2026-11-03'],
        ['2026-11-04T06:00:00Z', '2026-11-04'],
        ['2026-03-08T07:59:59Z', '2026-03-08'],
        ['2026-03-08T08:00:00Z', '2026-03-08'],
        ['2026-11-01T06:59:59Z', '2026-11-01'],
        ['2026-11-01T07:00:00Z', '2026-11-01'],
      ])
        expect(ovenToday(zone, new Date(instant))).toBe(date)
    }
    expect(ovenTimestamp('2026-11-04T03:18:00Z', zone)).toContain('9:18 PM')
  } finally {
    if (old === undefined) delete process.env.TZ
    else process.env.TZ = old
  }
})
const page = (p: Record<string, any>) =>
  `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', ...p })}</script>`
function extract(p: Record<string, any>) {
  return productImportResponse.parse({
    products: productDetails(page(p), 'https://example.com/product'),
  }).products[0].fields
}
it('keeps fabric width separate from purchased length and yarn weight separate from length', () => {
  const fabric = extract({
    name: 'Cotton fabric',
    material: '100% cotton',
    additionalProperty: [
      { name: 'Length', value: 3, unitText: 'yd' },
      { name: 'Fabric width', value: 44, unitText: 'in' },
    ],
  })
  expect(fabric).toMatchObject({
    materialType: 'fabric',
    fiber: '100% cotton',
    purchaseQuantity: 3,
    purchaseUnit: 'yd',
    fabricWidth: 44,
    widthUnit: 'in',
  })
  const yarn = extract({
    name: 'Merino yarn',
    color: 'Olive',
    additionalProperty: [
      { name: 'Yarn length', value: 220, unitText: 'yd' },
      { name: 'Yarn weight', value: 100, unitText: 'g' },
    ],
  })
  expect(yarn).toMatchObject({
    materialType: 'yarn',
    yarnLength: 220,
    yarnLengthUnit: 'yd',
    yarnWeight: 100,
    yarnWeightUnit: 'g',
    color: 'Olive',
  })
  expect(yarn).not.toHaveProperty('purchaseQuantity')
})
it('imports explicit multipack facts and identifiers without guessing contents, owner SKU or barcode', () => {
  const packaging = extract({
    name: 'Bread bags 100-count pack',
    sku: 'retailer-104',
    mpn: 'maker-501',
    additionalProperty: [
      { name: 'Items per pack', value: 100 },
      { name: 'Dimensions', value: '7 × 12 in' },
    ],
    offers: { '@type': 'Offer', price: 12, priceCurrency: 'USD' },
  })
  expect(packaging).toMatchObject({
    itemsPerPackage: 100,
    retailerSku: 'retailer-104',
    manufacturerSku: 'maker-501',
    dimensions: '7 × 12 in',
    packagePrice: 12,
  })
  expect(packaging).not.toHaveProperty('sku')
  expect(packaging).not.toHaveProperty('barcode')
  expect(extract({ name: 'Fabric bolt' })).not.toHaveProperty(
    'purchaseQuantity',
  )
  expect(
    extract({
      name: 'Cleaning supply',
      offers: { '@type': 'AggregateOffer', lowPrice: 10, highPrice: 20 },
    }),
  ).not.toHaveProperty('packagePrice')
  expect(
    extract({
      name: 'Mug',
      size: 'Blue / large',
      offers: { '@type': 'Offer', price: 7, priceCurrency: 'USD' },
    }),
  ).toMatchObject({ variant: 'Blue / large', packagePrice: 7 })
})
let id = 0
const nextId = () => `purchase-${++id}`
function apply(w: Workspace, action: string, data: Record<string, any>) {
  const plan = planFinance(w, action, data, nextId)
  for (const write of plan.writes) {
    const records = (w[write.table] ||= [])
    const index = records.findIndex((r) => r.id === write.record.id)
    if (index < 0) records.push(write.record)
    else records[index] = write.record
  }
  if (plan.journal) w.journals.push(plan.journal)
  return plan
}
function workspace(): Workspace {
  const ingredients = ['ingredient', 'material', 'packaging', 'supply'].map(
    (kind) => ({
      id: kind,
      name: kind,
      usedAs: kind,
      quantity: 4,
      cost: 2,
      unit: 'each',
      conversions: [],
    }),
  )
  return {
    ingredients,
    products: [
      {
        id: 'variant-blue',
        name: 'Market mug',
        variant: 'Blue',
        sku: 'MUG-BL',
        workflow: 'resale',
        quantity: 2,
        cost: 3,
        price: 14,
      },
    ],
    settings: [{ id: 'business', name: 'Test', ...zone, currency: 'USD' }],
    receipt_extractions: [
      {
        id: 'r',
        name: 'Older purchase',
        status: 'draft',
        date: '2026-07-25',
        receivedDate: '2026-11-03',
        vendor: 'Mixed merchant',
        subtotal: 50,
        tax: 5,
        total: 55,
        lines: [],
      },
    ],
    journals: [],
    ledger: [],
    expenses: [],
    finance_transactions: [],
    vendor_matches: [],
  }
}
it('posts five inventory types in one receipt, with selected resale variant, confirmed pack contents and actual costs', () => {
  const w = workspace()
  const lines: any[] = ['ingredient', 'material', 'packaging', 'supply'].map(
    (kind) => ({
      description: kind,
      itemId: kind,
      itemTable: 'ingredients',
      quantity: 1,
      unit: 'each',
      amount: 10,
      decision: 'inventory',
      stockQuantityConfirmed: true,
    }),
  )
  lines.push({
    description: 'Blue mugs',
    itemId: 'variant-blue',
    itemTable: 'products',
    quantity: 2,
    unit: 'pack',
    itemsPerUnit: 6,
    packageContentsConfirmed: true,
    amount: 10,
    decision: 'inventory',
    stockQuantityConfirmed: true,
  })
  const plan = apply(w, 'receiptPost', { id: 'r', lines })
  expect(w.products[0]).toMatchObject({
    quantity: 14,
    price: 14,
    variant: 'Blue',
    sku: 'MUG-BL',
  })
  expect(w.products[0].cost).toBeCloseTo(17 / 14)
  expect(w.ledger).toHaveLength(5)
  expect(w.ledger.find((l) => l.productId)).toMatchObject({
    productId: 'variant-blue',
    quantity: 12,
    amount: 11,
    date: '2026-11-03',
    purchaseDate: '2026-07-25',
  })
  expect(w.receipt_extractions[0].lines[4]).toMatchObject({
    itemId: 'variant-blue',
    itemTable: 'products',
    createNew: false,
  })
  expect(plan.journal?.date).toBe('2026-07-25')
  expect(() => apply(w, 'receiptPost', { id: 'r' })).toThrow('closed')
  expect(w.ledger).toHaveLength(5)
  expect(w.finance_transactions).toHaveLength(1)
  expect(w.ingredients.every((i) => i.quantity === 5)).toBe(true)
})
it('creates a resale item from a line without receiving stock, keeps other matches and tolerates creation retries', () => {
  const w = workspace()
  const lines = [
    {
      description: 'Soap',
      createNew: true,
      usedAs: 'resale',
      itemCreationId: 'line-uuid',
      quantity: 2,
      unit: 'pack',
      itemsPerUnit: 6,
      packageContentsConfirmed: true,
      amount: 10,
      decision: 'inventory',
      variant: 'Lavender',
      productSourceUrl: 'https://example.com/soap',
    },
    {
      description: 'Flour',
      itemId: 'ingredient',
      itemTable: 'ingredients',
      quantity: 1,
      unit: 'each',
      amount: 40,
      decision: 'inventory',
    },
  ]
  apply(w, 'receiptCreateItem', { id: 'r', lines, lineIndex: 0 })
  const created = w.products.at(-1)!
  expect(created).toMatchObject({
    quantity: 0,
    cost: 0,
    variant: 'Lavender',
    productSourceUrl: 'https://example.com/soap',
  })
  expect(w.receipt_extractions[0].lines[0]).toMatchObject({
    itemId: created.id,
    itemTable: 'products',
    quantity: 2,
    unit: 'pack',
    createNew: false,
  })
  expect(w.receipt_extractions[0].lines[1]).toEqual(lines[1])
  expect(w.ledger).toHaveLength(0)
  expect(w.journals).toHaveLength(0)
  apply(w, 'receiptCreateItem', { id: 'r', lines, lineIndex: 0 })
  expect(w.products).toHaveLength(2)
})
it('rejects unconfirmed packs, cross-Oven IDs and handmade receipt stock before any writes', () => {
  const w = workspace()
  const line = {
    description: 'Mugs',
    decision: 'inventory',
    itemId: 'variant-blue',
    itemTable: 'products',
    quantity: 2,
    unit: 'pack',
    itemsPerUnit: 6,
    amount: 50,
  }
  expect(() =>
    planFinance(w, 'receiptPost', { id: 'r', lines: [line] }, nextId),
  ).toThrow('Confirm items per package')
  expect(() =>
    planFinance(
      w,
      'receiptPost',
      { id: 'r', lines: [{ ...line, itemId: 'other-oven' }] },
      nextId,
    ),
  ).toThrow('this oven')
  w.products[0].workflow = 'handmade'
  expect(() =>
    planFinance(w, 'receiptPost', { id: 'r', lines: [line] }, nextId),
  ).toThrow('handmade')
  expect(w.ledger).toHaveLength(0)
  expect(w.products[0].quantity).toBe(2)
})
it('requires approval for date annotations and preserves original instants, quantities and expense dates', () => {
  const w = workspace()
  const record: Item = {
    id: 'movement',
    name: 'Bread pans',
    type: 'purchase_receipt',
    date: '2026-11-04',
    addedAt: '2026-11-04T02:55:37.351Z',
    quantity: 100,
    amount: 12,
  }
  expect(receivedDateReview(record, w.settings[0])).toBe('2026-11-03')
  const data = {
    receivedDate: '2026-11-03',
    expectedDate: '2026-11-04',
    reason: 'Confirmed Central receiving date',
    operationId: 'review',
    confirmed: true,
  }
  expect(() =>
    receiveDateCorrection(record, { ...data, confirmed: false }, 'owner'),
  ).toThrow('Approve')
  const correction = receiveDateCorrection(record, data, 'owner')
  const result = applyReceivedDateCorrections([record], {
    ...w.settings[0],
    receivedDateCorrections: [correction],
  })[0]
  expect(result).toMatchObject({
    date: '2026-11-03',
    originalReceivedDate: '2026-11-04',
    quantity: 100,
    amount: 12,
    addedAt: record.addedAt,
  })
  expect(record.date).toBe('2026-11-04')
  expect(record).not.toHaveProperty('dateCorrection')
})
