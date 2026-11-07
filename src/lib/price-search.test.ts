import { expect, it, vi, afterEach } from 'vitest'
import {
  packageFromTitle,
  validGtin,
  classifyOffer,
  webComparison,
  searchInput,
  searchPhrase,
} from './price-search'
import { normalizeShopping, findPrices } from '../../netlify/lib/price-search'
const ingredient = {
  id: 'flour',
  name: 'Bread flour',
  brand: 'Example Mills',
  barcode: '0012345678905',
  unit: 'g',
  storageUnit: 'lb',
  purchaseQuantity: 25,
  purchaseUnit: 'lb',
  packagePrice: 10.95,
  currency: 'USD',
  includesTax: false,
  includesShipping: false,
}
const input = {
  query: 'Example Mills Bread flour',
  zip: '90210',
  preference: 'both' as const,
  alternativeBrands: false,
}
const row = {
  title: 'Example Mills Bread flour 10 lb',
  source: 'Test retailer',
  price: '$4.00',
  extracted_price: 4,
  link: 'https://retailer.example/flour',
  brand: 'Example Mills',
}
afterEach(() => vi.unstubAllGlobals())
function shoppingRuntime(apiKey?: string) {
  return {
    env: {
      get: (name: string) =>
        name === 'SHOPPING_SEARCH_ENABLED'
          ? 'true'
          : name === 'SERPAPI_API_KEY'
            ? apiKey
            : undefined,
    },
  }
}

it('preserves barcode text and only normalizes valid GTIN check digits', () => {
  expect(searchPhrase(ingredient)).toBe(
    'Example Mills Bread flour 25 lb 0012345678905',
  )
  expect(validGtin('012345678905')).toBe('00012345678905')
  expect(validGtin('012345678900')).toBeNull()
  expect(validGtin(12345678905)).toBeNull()
  expect(searchPhrase({ ...ingredient, barcode: '' })).toBe(
    'Example Mills Bread flour 25 lb',
  )
  expect(
    searchInput({ ...input, query: 'Corrected product query' }, ingredient)
      .query,
  ).toBe('Corrected product query')
  expect(() =>
    searchInput({ ...input, zip: 'full address' }, ingredient),
  ).toThrow(/ZIP/)
})
it('parses explicit total contents and multipacks without guessing ambiguous cases', () => {
  expect(packageFromTitle('Bread flour 10 lb')).toEqual({
    packageQuantity: 10,
    purchaseUnit: 'lb',
    multipack: 1,
  })
  expect(packageFromTitle('2 x 5 lb bread flour')).toEqual({
    packageQuantity: 10,
    purchaseUnit: 'lb',
    multipack: 2,
  })
  expect(packageFromTitle('Flour .5 lb')).toEqual({
    packageQuantity: 0.5,
    purchaseUnit: 'lb',
    multipack: 1,
  })
  expect(packageFromTitle('Flour 2 pack total 10 lb')).toBeNull()
  expect(packageFromTitle('Milk 8 fl oz pack of 6')).toEqual({
    packageQuantity: 48,
    purchaseUnit: 'fl oz',
    multipack: 6,
  })
  for (const name of [
    'Bread flour case',
    'Bread flour case 5 lb',
    'Flour 5 lb / 80 oz',
    'Flour 2 1/2 lb',
    'Flour large bag',
  ])
    expect(packageFromTitle(name)).toBeNull()
})
it('labels exact matches only with a matching returned identifier and rejects wrong varieties', () => {
  const i = { ...ingredient, barcode: '012345678905' }
  expect(
    classifyOffer(
      i,
      row.title,
      row.brand,
      undefined,
      packageFromTitle(row.title),
      false,
    )?.match,
  ).not.toBe('Exact barcode match')
  expect(
    classifyOffer(
      i,
      row.title,
      row.brand,
      '0012345678905',
      packageFromTitle(row.title),
      false,
    )?.match,
  ).toBe('Exact barcode match')
  expect(
    classifyOffer(
      i,
      'Example Mills All-purpose flour 10 lb',
      row.brand,
      undefined,
      packageFromTitle(row.title),
      false,
    ),
  ).toBeNull()
  expect(
    classifyOffer(
      i,
      'Example Mills Gluten-free bread flour 10 lb',
      row.brand,
      undefined,
      packageFromTitle(row.title),
      false,
    ),
  ).toBeNull()
  expect(
    classifyOffer(
      i,
      'Other Mills Bread flour 10 lb',
      'Other Mills',
      undefined,
      packageFromTitle(row.title),
      false,
    ),
  ).toBeNull()
  expect(
    classifyOffer(
      i,
      'Other Mills Bread flour 10 lb',
      'Other Mills',
      undefined,
      packageFromTitle(row.title),
      true,
    )?.rank,
  ).toBe(4)
})
it('uses only provider prices and URLs and compares normalized packages with the reference', () => {
  const offers = normalizeShopping(
    [
      row,
      { ...row, extracted_price: 'fake' },
      { ...row, link: 'javascript:alert(1)' },
    ],
    ingredient,
    input,
    '2026-10-30T12:00:00Z',
  )
  expect(offers).toHaveLength(1)
  const c = webComparison(ingredient, offers[0])
  expect(c.unitCost).toBeCloseTo(0.4)
  expect(c.difference).toBeCloseTo(-0.038)
  expect(c.percent).toBeCloseTo(-8.6758)
  expect(c.equivalent).toBeCloseTo(-0.95)
  expect(offers[0].url).toBe(row.link)
  expect(offers[0].match).toMatch(/Different package size/)
  expect(
    webComparison({ ...ingredient, includesTax: null }, offers[0]).warning,
  ).toMatch(/basis/)
  expect(
    webComparison(ingredient, { ...offers[0], currency: 'CAD' }).difference,
  ).toBeUndefined()
  expect(
    webComparison(ingredient, { ...offers[0], packageQuantity: null }).warning,
  ).toMatch(/Package size needs checking/)
})
it('keeps conditional prices explicit and does not infer stock or shipping', () => {
  const offers = normalizeShopping(
    [
      {
        ...row,
        extensions: ['Members only', 'Coupon required'],
        delivery: 'Pickup at selected location',
      },
    ],
    ingredient,
    input,
    new Date().toISOString(),
  )
  expect(offers[0].conditional).toBe(true)
  expect(offers[0].availability).toBeUndefined()
  expect(offers[0].shipping).toBeNull()
  expect(offers[0].delivery).toBe('Pickup at selected location')
})
it('calls the configured provider with necessary search data only, and handles failures/no matches', async () => {
  vi.stubGlobal('Netlify', shoppingRuntime('test-credential'))
  const fetcher = vi.fn(async (_url: URL) =>
    Response.json({ shopping_results: [row] }),
  )
  vi.stubGlobal('fetch', fetcher)
  expect(await findPrices(ingredient, input)).toHaveLength(1)
  const url = fetcher.mock.calls[0][0] as unknown as URL
  expect(url.hostname).toBe('serpapi.com')
  expect(url.searchParams.get('q')).toBe(input.query)
  expect(url.searchParams.get('location')).toBe('90210, United States')
  expect([...url.searchParams.keys()].sort()).toEqual([
    'api_key',
    'engine',
    'gl',
    'hl',
    'location',
    'q',
  ])
  vi.stubGlobal('fetch', async () => Response.json({ shopping_results: [] }))
  expect(await findPrices(ingredient, input)).toEqual([])
  vi.stubGlobal('fetch', async () => new Response('', { status: 503 }))
  await expect(findPrices(ingredient, input)).rejects.toThrow(
    /could not complete/,
  )
  vi.stubGlobal('Netlify', shoppingRuntime())
  await expect(findPrices(ingredient, input)).rejects.toThrow(
    'Missing configuration',
  )
})
it('gives safe errors for invalid credentials, exhausted allowance, non-JSON and timeouts', async () => {
  vi.stubGlobal('Netlify', shoppingRuntime('test-credential'))
  for (const [status, message] of [
    [401, 'API key'],
    [403, 'API key'],
    [429, 'Allowance exhausted'],
  ] as const) {
    vi.stubGlobal(
      'fetch',
      async () => new Response('provider error', { status }),
    )
    await expect(findPrices(ingredient, input)).rejects.toThrow(message)
  }
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response('<html>Unavailable</html>', {
        headers: { 'content-type': 'text/html' },
      }),
  )
  await expect(findPrices(ingredient, input)).rejects.toThrow(
    'unexpected response format',
  )
  vi.stubGlobal('fetch', async () => {
    throw new Error('untrusted provider internals')
  })
  await expect(findPrices(ingredient, input)).rejects.toThrow(
    'timed out or is unavailable',
  )
})
it.each([
  ['Your API key is invalid', 'authentication_failed'],
  ['You have run out of searches', 'allowance_exhausted'],
  ['Unexpected provider details: private-value', 'provider_unavailable'],
])('classifies JSON provider errors safely: %s', async (error, code) => {
  vi.stubGlobal('Netlify', shoppingRuntime('test-credential'))
  const fetcher = vi.fn(async () => Response.json({ error }))
  vi.stubGlobal('fetch', fetcher)
  await expect(findPrices(ingredient, input)).rejects.toMatchObject({ code })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each(['null', '[]', '{broken'])(
  'handles malformed provider JSON %s without parser errors',
  async (body) => {
    vi.stubGlobal('Netlify', shoppingRuntime('test-credential'))
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(body, { headers: { 'content-type': 'application/json' } }),
    )
    await expect(findPrices(ingredient, input)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  },
)
it('uses at most three requests, deduplicates tokens and skips direct merchant links', async () => {
  vi.stubGlobal('Netlify', shoppingRuntime('test-credential'))
  const listing = (token: string) => ({
    ...row,
    link: 'https://www.google.com/shopping/product/' + token,
    immersive_product_page_token: token,
  })
  const fetcher = vi.fn(async (url: URL) =>
    url.searchParams.get('engine') === 'google_shopping'
      ? Response.json({
          shopping_results: [
            null,
            { ...listing('direct'), product_link: row.link },
            listing('one'),
            listing('one'),
            listing('two'),
            listing('three'),
          ],
        })
      : Response.json({ product_results: { stores: [] } }),
  )
  vi.stubGlobal('fetch', fetcher)
  await findPrices(ingredient, input)
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(
    fetcher.mock.calls
      .slice(1)
      .map(([url]) => url.searchParams.get('page_token')),
  ).toEqual(['one', 'two'])
})
it.each([429, 503])(
  'stops enrichment without retries after HTTP %s',
  async (status) => {
    vi.stubGlobal('Netlify', shoppingRuntime('test-credential'))
    const rows = ['one', 'two'].map((token) => ({
      ...row,
      link: 'https://www.google.com/shopping/' + token,
      immersive_product_page_token: token,
    }))
    const fetcher = vi.fn(async (url: URL) =>
      url.searchParams.get('engine') === 'google_shopping'
        ? Response.json({ shopping_results: rows })
        : new Response('unavailable', { status }),
    )
    vi.stubGlobal('fetch', fetcher)
    if (status === 429)
      await expect(findPrices(ingredient, input)).rejects.toMatchObject({
        code: 'allowance_exhausted',
      })
    else expect(await findPrices(ingredient, input)).toHaveLength(2)
    expect(fetcher).toHaveBeenCalledTimes(2)
  },
)
it('treats the documented Google empty-result response as no matches', async () => {
  vi.stubGlobal('Netlify', shoppingRuntime('test-credential'))
  const fetcher = vi.fn(async () =>
    Response.json({
      error: "Google hasn't returned any results for this query.",
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  expect(await findPrices(ingredient, input)).toEqual([])
  expect(fetcher).toHaveBeenCalledTimes(1)
})
