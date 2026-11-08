import { expect, it } from 'vitest'
import { productOfferDefault } from './product-import-offers'

const offer = {
  fields: {
    name: 'Bread flour',
    retailerSku: '13909715756',
    purchaseQuantity: 25,
    purchaseUnit: 'lb',
    packagePrice: 10.98,
  },
  title: 'Bread flour 25 lb',
  sourceUrl: 'https://www.samsclub.com/ip/flour/13909715756?clubId=1234',
  conditions: ['Sam’s Club · PICKUP · Club 1234'],
}
const shipping = {
  ...offer,
  fields: { ...offer.fields, packagePrice: 12.98 },
  conditions: ['Sam’s Club · SHIPPING · Club 1234'],
}

it('prefers the sole Pickup offer regardless of order and price', () => {
  expect(productOfferDefault([shipping, offer]).index).toBe(1)
  expect(productOfferDefault([offer, shipping]).index).toBe(0)
  expect(productOfferDefault([offer]).index).toBe(0)
})

it.each([
  { ...offer, fields: { ...offer.fields, packagePrice: 9.98 } },
  { ...offer, conditions: ['Sam’s Club · PICKUP · Club 5678'] },
  { ...offer, fields: { ...offer.fields, purchaseQuantity: 10 } },
])('requires a choice among multiple Pickup offers: %j', (alternative) => {
  expect(productOfferDefault([offer, shipping, alternative])).toEqual({
    index: -1,
    notice: expect.stringContaining('need review'),
  })
})

it.each([
  { ...shipping, fields: { ...shipping.fields, purchaseQuantity: 10 } },
  { ...shipping, fields: { ...shipping.fields, retailerSku: 'other' } },
  { ...shipping, title: 'Another product 25 lb' },
])(
  'does not choose across different products or packages: %j',
  (alternative) => {
    expect(productOfferDefault([offer, alternative]).index).toBe(-1)
  },
)

it.each([
  { conditions: ['Pickup unavailable'] },
  { conditions: ['Pickup is not available'] },
  { conditions: ['PICKUP', 'https://schema.org/OutOfStock'] },
  { conditions: ['Check pickup availability at checkout'] },
])('does not infer available Pickup from %j', ({ conditions }) => {
  expect(productOfferDefault([shipping, { ...offer, conditions }])).toEqual({
    index: -1,
    notice: expect.stringContaining('Pickup is unavailable'),
  })
})

it('keeps other retailer defaults unchanged', () => {
  const other = { ...offer, sourceUrl: 'https://example.org/product' }
  expect(productOfferDefault([other, other])).toEqual({
    index: -1,
    notice: '',
  })
  expect(productOfferDefault([other])).toEqual({ index: 0, notice: '' })
})
