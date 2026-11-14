// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { openFoodFactsProduct } from '../../netlify/lib/open-food-facts'
import { fetchProductDetails } from '../../netlify/lib/product-import'
const product = {
  code: '0051500141335',
  product_name_en: 'ORANGE MARMALADE FRUIT SPREAD',
  brands: "SMUCKER'S",
  quantity: '17.25 oz (1 LB 1.25 oz) 489g',
  ingredients_text:
    'SUGAR, ORANGE JUICE, ORANGE PEEL, WATER, FRUIT PECTIN, CITRIC ACID.',
  image_front_url:
    'https://images.openfoodfacts.org/images/products/005/150/014/1335/front_en.17.400.jpg',
  allergens_tags: ['en:milk'],
  product_quantity: 999,
  nutriments: { serving_size: 20 },
}
afterEach(() => vi.unstubAllGlobals())
it('verifies the actual GTIN including leading zeros and maps only explicit source details', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ status: 1, product })),
  )
  const p = await openFoodFactsProduct('051500141335')
  expect(p?.fields).toMatchObject({
    name: product.product_name_en,
    barcode: '051500141335',
    purchaseQuantity: 17.25,
    purchaseUnit: 'oz',
    brand: "SMUCKER'S",
  })
  expect(p?.fields).not.toHaveProperty('sourceContains')
  expect(p?.fields).not.toHaveProperty('sourceMayContain')
  expect(p?.imageUrl).toBe(product.image_front_url)
  expect(p?.warnings.join(' ')).toContain('CC BY-SA')
})
it('rejects a different barcode and never guesses a missing name or photo', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        status: 1,
        product: { ...product, code: '036000291452' },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        status: 1,
        product: { ...product, product_name_en: undefined },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        status: 1,
        product: { ...product, image_front_url: 'http://127.0.0.1/private' },
      }),
    )
  vi.stubGlobal('fetch', fetch)
  expect(await openFoodFactsProduct('051500141335')).toBeNull()
  expect(await openFoodFactsProduct('051500141335')).toBeNull()
  expect((await openFoodFactsProduct('051500141335'))?.imageUrl).toBe('')
})
it('uses the same protected product review response for the selected public product page', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ status: 1, product })),
  )
  const products = await fetchProductDetails(
    'https://world.openfoodfacts.org/product/0051500141335',
  )
  expect(products).toHaveLength(1)
  expect(products[0].fields).toMatchObject({
    purchaseQuantity: 17.25,
    purchaseUnit: 'oz',
  })
  expect(products[0].imageUrl).toBe(product.image_front_url)
})
