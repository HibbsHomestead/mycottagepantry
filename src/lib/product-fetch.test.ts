// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../netlify/lib/recipe-import', async (original) => ({
  ...(await original<typeof import('../../netlify/lib/recipe-import')>()),
  fetchRecipeUrl: fixture.fetch,
}))
import { PageFetchHttpError } from '../../netlify/lib/recipe-import'
import { fetchProductDetails } from '../../netlify/lib/product-import'
import aldi from '../../tests/fixtures/aldi-parmesan-2026-11-08.json'
beforeEach(() => {
  fixture.fetch.mockReset()
})
it.each([
  [401, /denied access.*HTTP 401/],
  [403, /denied access.*HTTP 403/],
  [404, /did not find.*HTTP 404/],
  [500, /HTTP 500/],
])(
  'reports observed HTTP %s without guessing login or location',
  async (status, message) => {
    fixture.fetch.mockRejectedValue(new PageFetchHttpError(status as number))
    await expect(
      fetchProductDetails('https://shop.example/product'),
    ).rejects.toThrow(message)
  },
)
it.each([
  [
    Object.assign(new Error('untrusted details'), { code: 'ENOTFOUND' }),
    /network error/,
  ],
  [
    new Error('Recipe link timed out. Paste the recipe instead.'),
    /request timed out/,
  ],
  [
    new Error('unknown internal details'),
    /We couldn’t automatically read this product page. You can enter the details manually./,
  ],
])(
  'classifies network, timeout and unknown failures without exposing raw errors',
  async (failure, message) => {
    fixture.fetch.mockRejectedValue(failure)
    await expect(
      fetchProductDetails('https://shop.example/product'),
    ).rejects.toThrow(message)
  },
)
it('retains partial metadata through fetch and response validation without a price', async () => {
  fixture.fetch.mockResolvedValue({
    url: 'https://shop.example/product',
    mime: 'text/html',
    bytes: Buffer.from(
      '<meta property="og:type" content="product"><meta property="og:title" content="Oil 128 fl oz"><meta property="product:brand" content="Wesson">',
    ),
  })
  const [product] = await fetchProductDetails('https://shop.example/product')
  expect(product.fields).toMatchObject({
    name: 'Oil 128 fl oz',
    brand: 'Wesson',
    packageSize: '128 fl oz',
  })
  expect(product.fields.packagePrice).toBeUndefined()
})
it('sends an Amazon Share link through the shared protected fetcher and retains the resolved source', async () => {
  const requested = 'https://a.co/d/example'
  fixture.fetch.mockResolvedValue({
    url: 'https://www.amazon.com/dp/B000EXAMPLE',
    mime: 'text/html',
    bytes: Buffer.from(
      '<meta property="og:type" content="product"><meta property="og:title" content="Yarn pack">',
    ),
  })
  const [product] = await fetchProductDetails(requested)
  expect(fixture.fetch).toHaveBeenCalledWith(
    requested,
    false,
    expect.any(Number),
    expect.objectContaining({
      deadline: expect.any(Number),
      validateRedirect: expect.any(Function),
    }),
  )
  expect(product).toMatchObject({
    sourceUrl: 'https://www.amazon.com/dp/B000EXAMPLE',
    requestedUrl: requested,
    fields: { name: 'Yarn pack' },
  })
})
it('does not import challenge metadata as a product', async () => {
  fixture.fetch.mockResolvedValue({
    url: 'https://www.walmart.com/blocked',
    mime: 'text/html',
    bytes: Buffer.from(
      '<title>Robot or human?</title><meta property="og:type" content="product"><meta property="og:title" content="Challenge">',
    ),
  })
  await expect(
    fetchProductDetails('https://www.walmart.com/ip/oil/10291484'),
  ).rejects.toMatchObject({ code: 'PRODUCT_HUMAN_VERIFICATION' })
  expect(fixture.fetch).toHaveBeenCalledTimes(1)
})
it('keeps upstream trace and Retry-After without assigning a backend failure to Amazon', async () => {
  const hops = [
    {
      url: 'https://www.amazon.com/dp/B0BQMJJBNP?th=1',
      at: '2026-11-07T19:21:59Z',
      status: 503,
      headers: {
        'retry-after': '45',
        'content-type': 'text/html',
        'x-amz-cf-id': 'edge-reference',
      },
      bodySummary: 'Error document; not parsed.',
    },
  ]
  fixture.fetch.mockRejectedValue(
    new PageFetchHttpError(
      503,
      {
        url: hops[0].url,
        mime: 'text/html',
        bytes: Buffer.from('<title>Unavailable</title>'),
      },
      hops,
    ),
  )
  await expect(fetchProductDetails(hops[0].url)).rejects.toMatchObject({
    retryAfter: '45',
    diagnostics: { source: 'retailer', hops },
  })
})
it.each([
  'https://www.amazon.com/dp/B0XXXXXXXX?th=1',
  'https://www.amazon.com/dp/B0BQMJJBNP',
  'https://other.example/dp/B0BQMJJBNP?th=1',
])(
  'refuses changed Amazon identifiers/options after redirect: %s',
  async (url) => {
    fixture.fetch.mockResolvedValue({
      url,
      mime: 'text/html',
      bytes: Buffer.from(
        '<meta property="og:type" content="product"><meta property="og:title" content="Different pack">',
      ),
    })
    await expect(
      fetchProductDetails('https://www.amazon.com/dp/B0BQMJJBNP?th=1'),
    ).rejects.toThrow(/changed its identifier or selected options/)
  },
)
it('does not extract product-like metadata from a 200 error/refresh page', async () => {
  fixture.fetch.mockResolvedValue({
    url: 'https://shop.example/product',
    mime: 'text/html',
    bytes: Buffer.from(
      '<meta http-equiv="refresh" content="0;url=/error/500"><meta property="og:type" content="product"><meta property="og:title" content="Error">',
    ),
  })
  await expect(
    fetchProductDetails('https://shop.example/product'),
  ).rejects.toThrow(/error document/)
})
it('rejects Amazon metadata for a different ASIN even if the final URL is unchanged', async () => {
  fixture.fetch.mockResolvedValue({
    url: 'https://www.amazon.com/dp/B0BQMJJBNP?th=1',
    mime: 'text/html',
    bytes: Buffer.from(
      '<script type="application/ld+json">{"@type":"Product","name":"Other package","sku":"B0XXXXXXXX"}</script>',
    ),
  })
  await expect(
    fetchProductDetails('https://www.amazon.com/dp/B0BQMJJBNP?th=1'),
  ).rejects.toThrow(/different Amazon identifier or variant/)
})

const aldiUrl = aldi['@graph'][0].offers.url
const aldiHop = {
  url: aldiUrl,
  at: '2026-11-08T02:27:10.541Z',
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  bodySummary: 'Successful response.',
}
it('imports the observed ALDI Product graph including its separately declared package size', async () => {
  fixture.fetch.mockResolvedValue({
    url: aldiUrl,
    mime: 'text/html',
    bytes: Buffer.from(
      `<meta http-equiv="refresh" content="86400"><script type="application/ld+json">${JSON.stringify(aldi)}</script>`,
    ),
    hops: [aldiHop],
  })
  const [product] = await fetchProductDetails(aldiUrl)
  expect(product).toMatchObject({
    sourceUrl: aldiUrl,
    requestedUrl: aldiUrl,
    fields: {
      name: 'Emporium Selection Parmesan Cheese Wedge',
      brand: 'Emporium Selection',
      packageSize: '8 oz',
      purchaseQuantity: 8,
      purchaseUnit: 'oz',
      packagePrice: 3.99,
      currency: 'USD',
    },
  })
  expect(product.fields.subingredients).toBeUndefined()
  expect(product.fields.barcode).toBeUndefined()
  expect(product.warnings).toContain(
    'Package quantity was read from the product’s structured size; confirm against the actual package.',
  )
  expect(fixture.fetch).toHaveBeenCalledTimes(1)
})
it.each([
  '0;url=/error/500',
  '86400; URL=https://other.example/item',
  '0',
  '',
  'invalid',
])(
  'rejects a redirect or invalid refresh %s even with ALDI product metadata',
  async (refresh) => {
    fixture.fetch.mockResolvedValue({
      url: aldiUrl,
      mime: 'text/html',
      bytes: Buffer.from(
        `<meta http-equiv="REFRESH" content="${refresh}"><script type="application/ld+json">${JSON.stringify(aldi)}</script>`,
      ),
      hops: [aldiHop],
    })
    await expect(fetchProductDetails(aldiUrl)).rejects.toMatchObject({
      message:
        'The source returned an error document instead of product details.',
      diagnostics: { source: 'retailer', stage: 'parse', hops: [aldiHop] },
    })
    expect(fixture.fetch).toHaveBeenCalledTimes(1)
  },
)
it.each(['', 'Large', '2 x 8 oz', '8 oz / 227 g', '8 oz pack of 2'])(
  'does not guess package contents from ambiguous structured size %s',
  async (size) => {
    const graph = structuredClone(aldi)
    graph['@graph'][0].size = size
    fixture.fetch.mockResolvedValue({
      url: aldiUrl,
      mime: 'text/html',
      bytes: Buffer.from(
        `<script type="application/ld+json">${JSON.stringify(graph)}</script>`,
      ),
    })
    const [product] = await fetchProductDetails(aldiUrl)
    expect(product.fields.purchaseQuantity).toBeUndefined()
    expect(product.fields.purchaseUnit).toBeUndefined()
  },
)
it('keeps HTTP 200 evidence when ALDI responds without usable product metadata', async () => {
  fixture.fetch.mockResolvedValue({
    url: aldiUrl,
    mime: 'text/html',
    bytes: Buffer.from('<html><title>ALDI</title></html>'),
    hops: [aldiHop],
  })
  await expect(fetchProductDetails(aldiUrl)).rejects.toMatchObject({
    diagnostics: {
      source: 'retailer',
      stage: 'parse',
      requestedUrl: aldiUrl,
      hops: [aldiHop],
    },
  })
})
it.each([403, 404, 410, 429, 503])(
  'keeps ALDI HTTP %s evidence and Retry-After on failed imports',
  async (status) => {
    const hop = { ...aldiHop, status, headers: { 'retry-after': '45' } }
    fixture.fetch.mockRejectedValue(
      new PageFetchHttpError(status, undefined, [hop]),
    )
    await expect(fetchProductDetails(aldiUrl)).rejects.toMatchObject({
      retryAfter: '45',
      diagnostics: { source: 'retailer', stage: 'fetch', hops: [hop] },
    })
  },
)
it('identifies a request timeout without inventing a retailer HTTP status', async () => {
  fixture.fetch.mockRejectedValue(new Error('Recipe link timed out.'))
  await expect(fetchProductDetails(aldiUrl)).rejects.toMatchObject({
    diagnostics: { source: 'network', stage: 'fetch', hops: [] },
  })
})
