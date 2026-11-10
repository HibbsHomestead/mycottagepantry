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
