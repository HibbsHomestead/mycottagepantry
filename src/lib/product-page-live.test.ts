// @vitest-environment node
import { writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import {
  fetchRecipeUrl,
  PageFetchHttpError,
} from '../../netlify/lib/recipe-import'
import { fetchProductDetails } from '../../netlify/lib/product-import'
import { PRODUCT_PAGE_BYTES } from '../../netlify/lib/page-response'
import { ProductImportFailure } from './product-import-diagnostics'

it.skipIf(!process.env.TEST_OWNER_AMAZON)(
  'compares the confirmed original Amazon URL with the same ASIN and variant without referral parameters',
  async () => {
    const original =
      'https://www.amazon.com/dp/B0BQMJJBNP?ref_=ppx_hzsearch_conn_dt_b_fed_asin_title_8&th=1'
    const canonical = 'https://www.amazon.com/dp/B0BQMJJBNP?th=1'
    const observations = []
    for (const url of [original, canonical]) {
      const requestedAt = new Date().toISOString()
      try {
        const page = await fetchRecipeUrl(url, false, PRODUCT_PAGE_BYTES)
        observations.push({
          url,
          requestedAt,
          status: 200,
          hops: page.hops,
          bytes: page.bytes.length,
        })
      } catch (error) {
        if (!(error instanceof PageFetchHttpError)) throw error
        const html = error.page?.bytes.toString('utf8') || ''
        observations.push({
          url,
          requestedAt,
          status: error.status,
          hops: error.hops,
          bytes: error.page?.bytes.length,
          sanitizedBody: {
            document: 'HTML',
            browserRedirectTarget:
              html.match(/https:\/\/www\.amazon\.com\/error\/\d+/)?.[0] || null,
            containsProductMetadata: /application\/ld\+json|og:type/i.test(
              html,
            ),
            containsVerification:
              /captcha|robot check|human verification/i.test(html),
          },
        })
      }
    }
    let importer
    try {
      const products = await fetchProductDetails(original)
      importer = { outcome: 'retrieved', products: products.length }
    } catch (error) {
      if (!(error instanceof ProductImportFailure)) throw error
      importer = {
        outcome: 'structured failure; no product data imported',
        diagnostics: error.diagnostics,
        retryAfter: error.retryAfter || null,
      }
    }
    await writeFile(
      'docs/amazon-import-retest.json',
      JSON.stringify({ observations, importer }, null, 2) + '\n',
    )
    expect(observations.map((o) => new URL(o.url).pathname)).toEqual([
      '/dp/B0BQMJJBNP',
      '/dp/B0BQMJJBNP',
    ])
    expect(
      observations.every((o) => new URL(o.url).searchParams.get('th') === '1'),
    ).toBe(true)
  },
  40000,
)
