// @vitest-environment node
import { expect, it } from 'vitest'
import { fetchRecipeUrl } from '../../netlify/lib/recipe-import'
import { productDetails } from '../../netlify/lib/product-import'
import { productImportResponse } from './product-import-response'

it.skipIf(!process.env.TEST_LIVE_SAMS_STATEMENTS)(
  'observes the reported Sam’s Club source using the secure fetcher without bypassing access controls',
  async () => {
    const source =
      'https://www.samsclub.com/ip/Member-s-Mark-Bread-Pizza-Flour-25-lbs/13909715756'
    const { writeFileSync } = await import('node:fs')
    try {
      const page = await fetchRecipeUrl(source)
      const products = productImportResponse.parse({
        products: productDetails(page.bytes.toString('utf8'), page.url),
      }).products
      expect(products.length).toBeGreaterThan(0)
      writeFileSync(
        '/tmp/cottage-sams-statements-observation.json',
        JSON.stringify(
          {
            source,
            retrievedUrl: page.url,
            products: products.map(({ fields, title, checkedAt }) => ({
              title,
              checkedAt,
              purchaseQuantity: fields.purchaseQuantity,
              purchaseUnit: fields.purchaseUnit,
              ingredientStatement: fields.subingredients || null,
              contains: fields.sourceContains || null,
              mayContain: fields.sourceMayContain || null,
              barcode: fields.barcode,
              retailerSku: fields.retailerSku,
            })),
          },
          null,
          2,
        ),
      )
    } catch (error) {
      const message = (error as Error).message
      expect(message).toMatch(
        /access challenge|denied access|HTTP|timed out|couldn’t automatically|unavailable|restricted/,
      )
      writeFileSync(
        '/tmp/cottage-sams-statements-observation.json',
        JSON.stringify({
          source,
          checkedAt: new Date().toISOString(),
          outcome: message,
        }),
      )
    }
  },
  25000,
)
