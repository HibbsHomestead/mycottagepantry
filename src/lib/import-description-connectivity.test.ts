// @vitest-environment node
import { expect, it } from 'vitest'
import { fetchProductDetails } from '../../netlify/lib/product-import'
import { productDescriptionAnswer } from '../../netlify/lib/support-ai-provider'
import { supportAiDefaults } from './support-ai'
import { ProductImportFailure } from './product-import-diagnostics'

// Explicit transport checks only: no workspace writes or customer data.
it.skipIf(process.env.IMPORT_DESCRIPTION_LIVE_CHECK !== '1')(
  'checks real Amazon retrieval using a historically reported product, clean link and tracking link',
  async () => {
    for (const url of [
      'https://www.amazon.com/Aluminum-Disposable-Containers-Roasting-Blackgold/dp/B0G4WLFMWV/',
      'https://www.amazon.com/dp/B0G4WLFMWV',
      'https://www.amazon.com/dp/B0G4WLFMWV?tag=tracking&utm_source=test',
    ]) {
      try {
        const products = await fetchProductDetails(url)
        expect(products.length).toBeGreaterThan(0)
        console.info(
          JSON.stringify({
            check: 'amazon-live',
            url,
            result: 'retrieved',
            products: products.length,
          }),
        )
      } catch (error) {
        if (!(error instanceof ProductImportFailure)) throw error
        console.info(
          JSON.stringify({
            check: 'amazon-live',
            url,
            result: 'unavailable',
            stage: error.diagnostics.stage,
            source: error.diagnostics.source,
            statuses: error.diagnostics.hops.map((h) => h.status),
          }),
        )
      }
    }
  },
  100000,
)
it.skipIf(process.env.IMPORT_DESCRIPTION_LIVE_CHECK !== '1')(
  'checks real description generation and regeneration with a minimal kit source',
  async () => {
    const source = {
      name: 'Test bakery assortment',
      type: 'kit' as const,
      category: '',
      packageQuantity: '',
      packageUnit: '',
      netWeight: '',
      ingredients: [],
      contents: [
        { name: 'Test loaf', quantity: '1' },
        { name: 'Test muffin', quantity: '2' },
      ],
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const draft = await productDescriptionAnswer(
          source,
          supportAiDefaults,
          async () => async () => {},
        )
        expect(draft.description.trim().length).toBeGreaterThan(10)
        expect(draft.outputTokens).toBeGreaterThan(0)
        console.info(
          JSON.stringify({
            check: 'description-live',
            attempt,
            result: 'generated',
            outputTokens: draft.outputTokens,
          }),
        )
      } catch (error) {
        console.info(
          JSON.stringify({
            check: 'description-live',
            attempt,
            result: 'failed',
            type: error instanceof Error ? error.name : 'unknown',
            status: (error as { status?: number }).status,
          }),
        )
        throw new Error(
          'Live description provider check failed; inspect server configuration without exposing provider credentials.',
        )
      }
    }
  },
  60000,
)
