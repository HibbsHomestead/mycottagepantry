// @vitest-environment node
import { it, expect, vi, beforeEach } from 'vitest'
const network = vi.hoisted(() => ({
  responses: [] as any[],
  requests: [] as any[],
  addresses: [{ address: '8.8.8.8', family: 4 }],
}))
vi.mock('node:dns/promises', () => ({ lookup: async () => network.addresses }))
vi.mock('node:https', async () => {
  const { EventEmitter } = await import('node:events'),
    { Readable } = await import('node:stream')
  return {
    request: (url: URL, options: any, callback: any) => {
      network.requests.push({ url: String(url), options })
      const req = new EventEmitter() as any
      req.destroy = (e: Error) => {
        req.emit('error', e)
        req.emit('close')
      }
      req.end = () => {
        const data = network.responses.shift() || {}
        const res = Readable.from([Buffer.from(data.body || '')]) as any
        res.statusCode = data.status || 200
        res.headers = {
          'content-type': data.mime || 'text/html',
          ...(data.location ? { location: data.location } : {}),
        }
        res.on('end', () => req.emit('close'))
        callback(res)
      }
      return req
    },
  }
})
import {
  fetchRecipeUrl,
  recipesFromHtml,
  validateRecipeUrl,
} from '../../netlify/lib/recipe-import'
import { fetchProductDetails } from '../../netlify/lib/product-import'
beforeEach(() => {
  network.responses = []
  network.requests = []
  network.addresses = [{ address: '8.8.8.8', family: 4 }]
})
it('fetches a public recipe page with pinned DNS and extracts its structured recipe', async () => {
  network.responses = [
    {
      body: '<script type="application/ld+json">{"@type":"Recipe","name":"Public fixture bread","recipeIngredient":["100 g flour"],"recipeYield":"1 loaf","recipeInstructions":[{"text":"Bake."}]}</script>',
    },
  ]
  const result = await fetchRecipeUrl('https://public-recipe.example/bread')
  expect(recipesFromHtml(result.bytes.toString()).recipes[0].title).toBe(
    'Public fixture bread',
  )
  const callback = vi.fn()
  network.requests[0].options.lookup(
    'public-recipe.example',
    { all: true },
    callback,
  )
  expect(callback).toHaveBeenCalledWith(null, [
    { address: '8.8.8.8', family: 4 },
  ])
  expect(network.requests[0].options.headers.Cookie).toBeUndefined()
})
it('checks every redirect and every resolved address rather than following private targets', async () => {
  network.responses = [
    { status: 302, location: 'https://169.254.169.254/latest/meta-data' },
  ]
  await expect(
    fetchRecipeUrl('https://public-recipe.example/redirect'),
  ).rejects.toThrow(/Private or reserved/)
  expect(network.requests).toHaveLength(1)
  network.addresses = [
    { address: '8.8.8.8', family: 4 },
    { address: '10.0.0.1', family: 4 },
  ]
  await expect(validateRecipeUrl('https://mixed-dns.example')).rejects.toThrow(
    /Private or reserved/,
  )
})
it('reports access restrictions and enforces response size and redirect limits', async () => {
  network.responses = [{ status: 403 }]
  await expect(
    fetchRecipeUrl('https://public-recipe.example/private'),
  ).rejects.toThrow(/access-restricted/)
  network.responses = [{ body: 'x'.repeat(1024 * 1024 + 1) }]
  await expect(
    fetchRecipeUrl('https://public-recipe.example/large'),
  ).rejects.toThrow(/1 MiB/)
  network.responses = Array.from({ length: 4 }, () => ({
    status: 302,
    location: 'https://public-recipe.example/again',
  }))
  await expect(
    fetchRecipeUrl('https://public-recipe.example/again'),
  ).rejects.toThrow(/Too many/)
})
it('imports product-link details directly with shopping disabled and without reading provider configuration', async () => {
  const get = vi.fn(() => undefined)
  const fetcher = vi.fn()
  vi.stubGlobal('Netlify', { env: { get } })
  vi.stubGlobal('fetch', fetcher)
  network.responses = [
    {
      body: '<script type="application/ld+json">{"@type":"Product","name":"Flour 1 kg","offers":{"@type":"Offer","price":"4.00","priceCurrency":"USD"}}</script>',
    },
  ]
  try {
    const [product] = await fetchProductDetails('https://store.example/flour')
    expect(product.fields).toMatchObject({
      name: 'Flour 1 kg',
      purchaseQuantity: 1,
      purchaseUnit: 'kg',
      packagePrice: 4,
      currency: 'USD',
    })
    expect(product.sourceUrl).toBe('https://store.example/flour')
    expect(network.requests.map((request) => request.url)).toEqual([
      'https://store.example/flour',
    ])
    expect(get).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})
