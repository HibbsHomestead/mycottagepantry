// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { fdcLookup, internetLookup } from '../../netlify/lib/catalog-handler'
afterEach(() => vi.unstubAllGlobals())
function setup(internet = false) {
  vi.stubGlobal('Netlify', {
    env: {
      get: (key: string) =>
        key === 'CATALOG_INTERNET_SEARCH_ENABLED'
          ? String(internet)
          : 'synthetic-test-key',
    },
  })
}
it('accepts only exact FDC barcode matches and never maps nutrition serving size to contents', async () => {
  setup()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        foods: [
          {
            description: 'Flour 2 lb',
            gtinUpc: '036000291452',
            fdcId: 123,
            ingredients: 'WHEAT (FLOUR, MALT)',
            servingSize: 30,
            servingSizeUnit: 'g',
          },
          {
            description: 'Similar flour',
            gtinUpc: '4006381333931',
            fdcId: 124,
          },
        ],
      }),
    ),
  )
  const result = await fdcLookup('0036000291452')
  expect(result.results).toHaveLength(1)
  expect(result.results[0].fields).toEqual({
    name: 'Flour 2 lb',
    barcode: '036000291452',
    subingredients: 'WHEAT (FLOUR, MALT)',
  })
  expect(result.results[0].sources[0].license).toContain('CC0')
})
it('sanitizes provider failures and retains an explicit external-search alternative without paid enablement', async () => {
  setup()
  const fetch = vi.fn(async () =>
    Response.json({ error: 'secret-provider-message' }, { status: 429 }),
  )
  vi.stubGlobal('fetch', fetch)
  await expect(fdcLookup('036000291452')).rejects.toMatchObject({
    status: 429,
    code: 'FDC_UNAVAILABLE',
  })
  const search = await internetLookup('036000291452')
  expect(search.fallbackUrl).toContain('036000291452')
  expect(search.candidates).toEqual([])
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('shows transient unverified title/domain/link candidates without snippets or image copies', async () => {
  setup(true)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        organic_results: [
          {
            title: 'Candidate package',
            link: 'https://example.org/product',
            snippet: 'Unverified ingredients',
            thumbnail: 'https://example.org/image',
          },
          { title: 'Unsafe', link: 'javascript:alert(1)' },
        ],
      }),
    ),
  )
  const search = await internetLookup('036000291452')
  expect(search.candidates).toEqual([
    {
      title: 'Candidate package',
      url: 'https://example.org/product',
      domain: 'example.org',
      confirmed: false,
    },
  ])
})
it('reports missing configuration and invalid response formats without treating them as empty successful product data', async () => {
  vi.stubGlobal('Netlify', { env: { get: () => undefined } })
  expect((await fdcLookup('036000291452')).notice).toContain('not connected')
  setup()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ foods: 'bad' })),
  )
  await expect(fdcLookup('036000291452')).rejects.toMatchObject({
    code: 'FDC_RESPONSE_INVALID',
  })
})
it('keeps long ingredient/subingredient text complete and separates explicit Contains and advisory headings', async () => {
  setup()
  const text =
    'Wheat (flour, malt), ' + 'explicit source ingredient wording, '.repeat(220)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        foods: [
          {
            description: 'Flour',
            gtinUpc: '036000291452',
            fdcId: 123,
            ingredients:
              text +
              '\nContains: Wheat.\nMay contain soy. Made in a facility that handles milk.',
          },
        ],
      }),
    ),
  )
  const result = await fdcLookup('036000291452')
  expect(result.results[0].fields.subingredients).toBe(text.trim())
  expect(result.results[0].fields.sourceContains).toBe('Contains: Wheat.')
  expect(result.results[0].fields.sourceMayContain).toBe(
    'May contain soy.\nMade in a facility that handles milk.',
  )
})
