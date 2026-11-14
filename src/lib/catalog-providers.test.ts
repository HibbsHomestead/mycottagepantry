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

it('falls back for the actual marmalade barcode, retaining leading zeros and unverified selection', async () => {
  setup(true)
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ foods: [], totalHits: 0 }))
    .mockResolvedValueOnce(Response.json({ status: 0 }))
    .mockResolvedValueOnce(
      Response.json({
        organic_results: [
          {
            title: 'Smucker’s Orange Marmalade',
            link: 'https://www.smuckers.com/fruit-spreads/marmalade/orange-marmalade',
          },
        ],
      }),
    )
  vi.stubGlobal('fetch', fetch)
  const { handleCatalog } = await import('../../netlify/lib/catalog-handler')
  const queries: string[] = []
  const response = await handleCatalog(
    new Request('https://example.org/api/workspace?catalog=1', {
      method: 'POST',
      body: JSON.stringify({
        operation: 'lookup',
        query: '051500141335',
        kind: 'ingredient',
      }),
    }),
    {
      client: {
        query: async (sql) => {
          queries.push(sql)
          return { rows: [] }
        },
      },
      org: 'test-org',
      actor: 'test-user',
      role: 'Owner',
      state: { ingredients: [] } as unknown as import('./domain').Workspace,
    },
  )
  expect(response.status).toBe(200)
  const data = await response.json()
  expect(data.results).toEqual([])
  expect(data.candidates[0]).toMatchObject({
    confirmed: false,
    title: 'Smucker’s Orange Marmalade',
  })
  expect(JSON.parse(fetch.mock.calls[0][1].body).query).toBe('051500141335')
  expect(new URL(fetch.mock.calls[2][0]).searchParams.get('q')).toBe(
    '"051500141335"',
  )
  expect(
    queries.some((q) => /INSERT INTO (ingredients|inventory|stock)/i.test(q)),
  ).toBe(false)
})

it('maps explicit package weight without inventing an allergen statement', async () => {
  setup()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        foods: [
          {
            description: 'Orange Marmalade',
            brandName: 'Smucker’s',
            gtinUpc: '051500141335',
            fdcId: 123,
            packageWeight: '18 oz',
            ingredients: 'Oranges, sugar',
          },
          { description: 'Different jar', gtinUpc: '036000291452', fdcId: 124 },
        ],
      }),
    ),
  )
  const data = await fdcLookup('051500141335')
  expect(data.results).toHaveLength(1)
  expect(data.results[0].fields).toMatchObject({
    barcode: '051500141335',
    purchaseQuantity: 18,
    purchaseUnit: 'oz',
  })
  expect(data.results[0].fields.sourceContains).toBeUndefined()
})

it('enables configured search without an extra flag and treats a genuinely empty Google result as empty', async () => {
  vi.stubGlobal('Netlify', {
    env: {
      get: (key: string) =>
        key === 'SERPAPI_API_KEY' ? 'synthetic-test-key' : undefined,
    },
  })
  const fetch = vi.fn(async () =>
    Response.json({
      error: "Google hasn't returned any results for this query.",
      search_information: {
        organic_results_state: 'Fully empty',
        total_results: 0,
      },
    }),
  )
  vi.stubGlobal('fetch', fetch)
  const result = await internetLookup('051500141335')
  expect(fetch).toHaveBeenCalledOnce()
  expect(result.candidates).toEqual([])
  expect(result.notice).toContain('No web results')
  expect(result.fallbackUrl).toContain('051500141335')
})
