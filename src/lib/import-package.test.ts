import { expect, it } from 'vitest'
import { explicitCountedPackage } from './import-package'
import { productDetails } from '../../netlify/lib/product-import'
import { productImportResponse } from './product-import-response'
import { ingredientImportFields } from './ingredient-import-draft'
import { inventoryPackagePlan } from './inventory-package'
import { applyPurchaseSetup, purchaseSetupView } from './purchase-setup'
import { convert, type Item } from './domain'
it.each([
  ['Cookie bags 100 count', 100, 'package'],
  ['Box of 500 labels', 500, 'box'],
  ['Case of 4 packs containing 100 bags each', 400, 'case'],
  ['Cookie bags 9.5 × 3 × 3.5 inches, 100 count', 100, 'package'],
])('retains explicit textual contents for %s', (title, quantity, unit) => {
  const [product] = productDetails(
    '<script type="application/ld+json">' +
      JSON.stringify({
        '@type': 'Product',
        name: title,
        offers: { '@type': 'Offer', price: '12.50', priceCurrency: 'USD' },
      }) +
      '</script>',
    'https://test.invalid/item',
  )
  const parsed = productImportResponse.parse({ products: [product] })
    .products[0]
  const fields = ingredientImportFields(parsed.fields, { unit: 'g' }, true)
  expect(fields).toMatchObject({
    amountPerPackage: quantity,
    purchaseUnit: unit,
    unit: 'each',
    packagePrice: 12.5,
  })
  const plan = inventoryPackagePlan({
    ...fields,
    usedAs: 'packaging',
    initialStock: false,
  })
  expect(plan.unitCost).toBeCloseTo(12.5 / Number(quantity))
  expect(plan.stockQuantity).toBe(0)
})
it.each([
  'Cookie bags 9.5 × 3 × 3.5 inches',
  'Cookie bags 4 packs',
  'Cookie bags, assorted sizes',
  'Labels 2 × 500',
])('does not infer ambiguous contents for %s', (text) =>
  expect(explicitCountedPackage(text)).toBeUndefined(),
)
it('preserves a reviewed one-package conversion through the legacy editor save mapping and reopen without adding stock', () => {
  const old = {
    id: 'isolated-bags',
    name: 'Bags',
    unit: 'each',
    quantity: 7,
    conversions: [],
  }
  const saved = applyPurchaseSetup(old, {
    ...old,
    purchaseSetup: { packageUnit: 'package', price: 12.5, stockUnits: 100 },
    purchaseSetupConfirmed: true,
  })
  expect(saved).toMatchObject({
    purchaseQuantity: 1,
    purchaseUnit: 'package',
    packagePrice: 12.5,
    quantity: 7,
  })
  expect(convert(1, 'package', 'each', saved.conversions)).toBe(100)
  expect(purchaseSetupView(saved as Item).setup).toEqual({
    packageUnit: 'package',
    price: 12.5,
    stockUnits: 100,
  })
})
it('does not invent missing or ranged prices', () => {
  for (const offers of [
    undefined,
    { '@type': 'AggregateOffer', lowPrice: 5, highPrice: 10 },
  ]) {
    const [p] = productDetails(
      '<script type="application/ld+json">' +
        JSON.stringify({ '@type': 'Product', name: '100 count bags', offers }) +
        '</script>',
      'https://test.invalid/item',
    )
    expect(p.fields.packagePrice).toBeUndefined()
  }
})
