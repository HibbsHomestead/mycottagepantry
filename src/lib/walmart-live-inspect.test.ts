// @vitest-environment node
import { it, expect } from 'vitest'
import { ownerWalmartUrl } from '../test/fixtures/walmart-owner-url'
import { writeFileSync } from 'node:fs'
import { load } from 'cheerio'
import { fetchRecipeUrl } from '../../netlify/lib/recipe-import'
import { productDetails } from '../../netlify/lib/product-import'
it.skipIf(process.env.TEST_LIVE_WALMART !== '1')(
  'observes the exact owner URL without bypassing an access challenge',
  async () => {
    const url = ownerWalmartUrl
    try {
      const page = await fetchRecipeUrl(url)
      const html = page.bytes.toString('utf8')
      writeFileSync('/tmp/cottage-walmart-page.html', html)
      const $ = load(html)
      const summary: any = {
        checkedAt: new Date().toISOString(),
        finalHost: new URL(page.url).hostname,
        finalPath: new URL(page.url).pathname,
        status: page.status,
        mime: page.mime,
        bytes: page.bytes.length,
        title: $('title').text(),
        ldScripts: $('script[type="application/ld+json"]').length,
        nextData: $('#__NEXT_DATA__').length,
        ogTitle: $('meta[property="og:title"]').attr('content'),
        passwordInputs: $('input[type="password"]').length,
      }
      try {
        summary.products = productDetails(html, page.url)
      } catch (e) {
        summary.extractionError = (e as Error).message
        expect(summary.extractionError).toMatch(
          /access challenge|couldn’t automatically read/,
        )
      }
      writeFileSync(
        '/tmp/cottage-walmart-evidence.json',
        JSON.stringify(summary, null, 2),
      )
      console.info(
        JSON.stringify({
          ...summary,
          products: summary.products?.map((p: any) => ({
            fields: p.fields,
            imageAvailable: !!p.imageUrl,
          })),
        }),
      )
    } catch (e) {
      const summary = {
        checkedAt: new Date().toISOString(),
        fetchError: (e as Error).message,
      }
      writeFileSync(
        '/tmp/cottage-walmart-evidence.json',
        JSON.stringify(summary),
      )
      console.info(summary)
      throw e
    }
  },
  25000,
)
