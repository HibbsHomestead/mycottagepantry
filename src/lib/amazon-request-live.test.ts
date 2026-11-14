// @vitest-environment node
import { it, expect } from 'vitest'
import { writeFile } from 'node:fs/promises'
import {
  fetchRecipeUrl,
  PageFetchHttpError,
} from '../../netlify/lib/recipe-import'
import { fetchProductDetails } from '../../netlify/lib/product-import'
import { productDetails } from '../../netlify/lib/product-import'
import { load } from 'cheerio'
import { PRODUCT_PAGE_BYTES } from '../../netlify/lib/page-response'
import { ProductImportFailure } from './product-import-diagnostics'

it.skipIf(!process.env.TEST_AMAZON_B0DRJXJ8HT)(
  'records protected retrieval of B0DRJXJ8HT with the reported variant selection',
  async () => {
    // The reported attribution values were redacted. Check only the cleaned
    // product URL; this does not reproduce the original upstream request.
    const url = 'https://www.amazon.com/dp/B0DRJXJ8HT?th=1'
    const requestedAt = new Date().toISOString()
    let observation
    try {
      const products = await fetchProductDetails(url)
      expect(products.length).toBeGreaterThan(0)
      expect(products.every((product) => product.sourceUrl === url)).toBe(true)
      observation = {
        requestedAt,
        url,
        outcome: 'retrieved',
        products: products.map((product) => ({
          retailerSku: product.fields.retailerSku,
          fields: Object.keys(product.fields),
        })),
      }
    } catch (error) {
      if (!(error instanceof ProductImportFailure)) throw error
      expect(error.diagnostics.normalizedUrl).toBe(url)
      observation = {
        requestedAt,
        url,
        outcome: 'retrieval failed; no product data imported',
        diagnostics: error.diagnostics,
      }
    }
    await writeFile(
      'docs/amazon-B0DRJXJ8HT-retest.json',
      JSON.stringify(observation, null, 2) + '\n',
    )
  },
  35000,
)

it.skipIf(!process.env.TEST_AMAZON_B09V45JBKH)(
  'records retrieval of the reported B09V45JBKH ASIN without redacted search parameters',
  async () => {
    // The supplied search values were redacted, so this checks the clean URL
    // only. It cannot establish a comparison with the original request.
    const url = 'https://www.amazon.com/dp/B09V45JBKH'
    const requestedAt = new Date().toISOString()
    let observation
    try {
      const products = await fetchProductDetails(url)
      expect(products.length).toBeGreaterThan(0)
      expect(products.every((product) => product.sourceUrl === url)).toBe(true)
      observation = {
        requestedAt,
        url,
        outcome: 'retrieved',
        products: products.length,
        fields: products.map((product) => Object.keys(product.fields)),
      }
    } catch (error) {
      if (!(error instanceof ProductImportFailure)) throw error
      expect(error.diagnostics.normalizedUrl).toBe(url)
      observation = {
        requestedAt,
        url,
        outcome: 'retrieval failed; no product data imported',
        diagnostics: error.diagnostics,
      }
    }
    await writeFile(
      'docs/amazon-B09V45JBKH-retest.json',
      JSON.stringify(observation, null, 2) + '\n',
    )
  },
  35000,
)

it.skipIf(!process.env.TEST_AMAZON_REQUEST)(
  'compares the reported ASIN original and normalized paths through protected HTTPS',
  async () => {
    const observations = []
    for (const url of [
      'https://www.amazon.com/Aluminum-Disposable-Containers-Roasting-Blackgold/dp/B0G4WLFMWV/',
      'https://www.amazon.com/dp/B0G4WLFMWV',
    ]) {
      try {
        const page = await fetchRecipeUrl(url, false, PRODUCT_PAGE_BYTES)
        const html = page.bytes.toString('utf8')
        const $ = load(html)
        const sourceFacts = {
          selectedAsin: $('input#ASIN').attr('value'),
          title: $('#productTitle').text().trim().replace(/\s+/g, ' '),
          overview: $('#productOverview_feature_div tr')
            .toArray()
            .map((el) => $(el).text().trim().replace(/\s+/g, ' ')),
          primaryPrices: $(
            '#corePrice_feature_div .apex-pricetopay-value > .a-offscreen, #corePriceDisplay_desktop_feature_div .priceToPay > .a-offscreen',
          )
            .toArray()
            .map((el) => $(el).text().trim()),
          image:
            $('#landingImage').attr('data-old-hires') ||
            $('#landingImage').attr('src'),
        }
        let extraction
        try {
          extraction = { products: productDetails(html, page.url) }
        } catch {
          extraction = { outcome: 'No usable product extracted' }
        }
        observations.push({
          url,
          hops: page.hops,
          bytes: page.bytes.length,
          sourceFacts,
          extraction,
        })
      } catch (error) {
        if (!(error instanceof PageFetchHttpError)) throw error
        observations.push({
          url,
          hops: error.hops,
          bytes: error.page?.bytes.length,
        })
      }
    }
    let importer
    try {
      importer = { products: await fetchProductDetails(observations[0].url) }
    } catch (error) {
      if (!(error instanceof ProductImportFailure)) throw error
      importer = {
        diagnostics: error.diagnostics,
        retryAfter: error.retryAfter || null,
      }
    }
    await writeFile(
      'docs/amazon-B0G4WLFMWV-retest.json',
      JSON.stringify({ observations, importer }, null, 2) + '\n',
    )
    expect(observations).toHaveLength(2)
  },
  60000,
)
