// @vitest-environment node
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
type Options = {
  headers: Record<string, string>
  lookup: (
    host: string,
    options: object,
    callback: (error: unknown, address: string) => void,
  ) => void
}
type ReplyStream = PassThrough & {
  headers: Record<string, string>
  statusCode: number
}
const remote = vi.hoisted(() => ({
  replies: [] as {
    status?: number
    headers?: Record<string, string>
    body?: string
    stall?: boolean
    stallBody?: boolean
  }[],
  requests: [] as { url: string; options: Options }[],
}))
vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '8.8.8.8', family: 4 }],
}))
vi.mock('node:https', () => ({
  request: (
    url: URL,
    options: Options,
    callback: (response: ReplyStream) => void,
  ) => {
    remote.requests.push({ url: url.href, options })
    let response: ReplyStream | undefined
    const req = Object.assign(new EventEmitter(), {
      end(): void {
        queueMicrotask(() => {
          const reply = remote.replies.shift() || { stall: true }
          if (reply.stall) return
          response = Object.assign(new PassThrough(), {
            headers: reply.headers || { 'content-type': 'text/html' },
            statusCode: reply.status || 200,
          })
          callback(response)
          if (reply.stallBody) response.write(reply.body || '<html>')
          else response.end(reply.body || '')
        })
      },
      destroy(error: Error): void {
        response?.destroy(error)
        req.emit('error', error)
      },
    })
    return req
  },
}))
import { fetchRecipeUrl } from '../../netlify/lib/recipe-import'
import { fetchProductDetails } from '../../netlify/lib/product-import'
import { walmartVerificationMessage } from './product-import-response'
beforeEach(() => {
  remote.requests = []
  remote.replies = []
})
afterEach(() => {
  vi.useRealTimers()
})
it('normalizes the exact ASIN, backs off on 503 and extracts only the successful document', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  remote.replies = [
    {
      status: 503,
      body: '<script>window.location.replace("https://www.amazon.com/error/500")</script><meta property="og:type" content="product"><meta property="og:title" content="Error title">',
    },
    {
      body: '<input id="ASIN" value="B0G4WLFMWV"><span id="productTitle">Selected roasting pans</span>',
    },
  ]
  const result = fetchProductDetails(
    'https://www.amazon.com/Aluminum-Disposable-Containers-Roasting-Blackgold/dp/B0G4WLFMWV/?ref_=search',
  )
  await vi.advanceTimersByTimeAsync(499)
  expect(remote.requests).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect((await result)[0].fields.name).toBe('Selected roasting pans')
  expect(remote.requests.map((r) => r.url)).toEqual(
    Array(2).fill('https://www.amazon.com/dp/B0G4WLFMWV'),
  )
})
it('stops at three transient attempts and retains each response and browser redirect', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  remote.replies = Array.from({ length: 3 }, () => ({
    status: 503,
    body: '<script>window.location.replace("https://www.amazon.com/error/500")</script>',
  }))
  const check = expect(
    fetchProductDetails('https://www.amazon.com/dp/B0G4WLFMWV'),
  ).rejects.toMatchObject({
    diagnostics: {
      stage: 'fetch',
      normalizedUrl: 'https://www.amazon.com/dp/B0G4WLFMWV',
      hops: [1, 2, 3].map((attempt) =>
        expect.objectContaining({
          attempt,
          status: 503,
          browserRedirect: {
            url: 'https://www.amazon.com/error/500',
            kind: 'error',
          },
        }),
      ),
    },
  })
  await vi.advanceTimersByTimeAsync(1500)
  await check
  expect(remote.requests).toHaveLength(3)
})
it('honors a short Retry-After before retrying', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  remote.replies = [
    {
      status: 503,
      headers: { 'retry-after': '2', 'content-type': 'text/html' },
    },
    {
      body: '<meta property="og:type" content="product"><meta property="og:title" content="Recovered product">',
    },
  ]
  const result = fetchProductDetails('https://shop.example/product')
  await vi.advanceTimersByTimeAsync(1999)
  expect(remote.requests).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect((await result)[0].fields.name).toBe('Recovered product')
})
it.each(['60', 'Tue, 10 Nov 2026 06:00:00 GMT'])(
  'returns a long Retry-After %s without early retries',
  async (retryAfter) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-11-10T05:00:00Z'))
    remote.replies = [
      {
        status: 503,
        headers: { 'retry-after': retryAfter, 'content-type': 'text/html' },
      },
    ]
    await expect(
      fetchProductDetails('https://shop.example/product'),
    ).rejects.toMatchObject({ retryAfter })
    expect(remote.requests).toHaveLength(1)
  },
)
it('rejects a changed selected Amazon offer before requesting its redirect destination', async () => {
  remote.replies = [
    {
      status: 302,
      headers: { location: 'https://www.amazon.com/dp/B0G4WLFMWV?smid=other' },
    },
  ]
  await expect(
    fetchProductDetails('https://www.amazon.com/dp/B0G4WLFMWV?smid=selected'),
  ).rejects.toMatchObject({
    diagnostics: {
      hops: [
        expect.objectContaining({
          status: 302,
          location: expect.stringContaining('/dp/B0G4WLFMWV'),
        }),
      ],
    },
  })
  expect(remote.requests).toHaveLength(1)
})
it.each([200, 403, 429])(
  'stops Walmart HTTP %s verification without extracting or retrying',
  async (status) => {
    remote.replies = [
      {
        status,
        body: '<title>Robot or human?</title><script type="application/ld+json">{"@type":"Product","name":"Not a product","offers":{"price":1}}</script>',
      },
    ]
    await expect(
      fetchProductDetails('https://www.walmart.com/ip/oil/10291484'),
    ).rejects.toMatchObject({
      code: 'PRODUCT_HUMAN_VERIFICATION',
      message: walmartVerificationMessage,
    })
    expect(remote.requests).toHaveLength(1)
  },
)
it.each([
  ['https://www.walmart.com/ip/oil/10291484', '<h1>Verify you are human</h1>'],
  ['https://www.walmart.com/blocked', '<title>Walmart</title>'],
])(
  'rejects Walmart verification at %s before reading product metadata',
  async (url, html) => {
    remote.replies = [
      {
        body:
          html +
          '<meta property="og:type" content="product"><meta property="og:title" content="Challenge">',
      },
    ]
    await expect(fetchProductDetails(url)).rejects.toMatchObject({
      code: 'PRODUCT_HUMAN_VERIFICATION',
    })
    expect(remote.requests).toHaveLength(1)
  },
)
it('retains the overall 12 second request deadline and maps it to a product timeout', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  remote.replies = [{ stall: true }]
  const result = fetchProductDetails('https://shop.example/product')
  const check = expect(result).rejects.toThrow(/product page request timed out/)
  await vi.advanceTimersByTimeAsync(12001)
  await check
})
it('times out a stalled body without returning an incomplete product prefix', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  remote.replies = [
    {
      stallBody: true,
      body: '<html><script type="application/ld+json">{"@type":"Product","name":"Incomplete"}</script>',
    },
  ]
  const check = expect(
    fetchProductDetails('https://shop.example/product'),
  ).rejects.toThrow(/product page request timed out/)
  await vi.advanceTimersByTimeAsync(12001)
  await check
})
it('revalidates redirect destinations and pins validated public DNS without account credentials', async () => {
  remote.replies = [
    { status: 302, headers: { location: 'https://127.0.0.1/private' } },
  ]
  await expect(fetchRecipeUrl('https://shop.example/product')).rejects.toThrow(
    /Private/,
  )
  expect(remote.requests).toHaveLength(1)
  const { options } = remote.requests[0]
  expect(options.headers).not.toHaveProperty('Cookie')
  expect(options.headers).not.toHaveProperty('Authorization')
  options.lookup('shop.example', {}, (_error: unknown, address: string) =>
    expect(address).toBe('8.8.8.8'),
  )
})
it('allows no more than three redirects', async () => {
  remote.replies = Array.from({ length: 4 }, () => ({
    status: 302,
    headers: { location: 'https://shop.example/again' },
  }))
  await expect(fetchRecipeUrl('https://shop.example/start')).rejects.toThrow(
    /Too many/,
  )
  expect(remote.requests).toHaveLength(4)
})
it('does not mislabel HTTP denial as size or missing product data', async () => {
  remote.replies = [{ status: 403 }]
  await expect(
    fetchProductDetails('https://shop.example/item'),
  ).rejects.toThrow(/denied access.*403/)
})
it('only accepts an absent Content-Type when the complete body is explicitly an HTML document', async () => {
  remote.replies = [
    { headers: {}, body: '<!DOCTYPE html><html><title>Item</title></html>' },
  ]
  expect((await fetchRecipeUrl('https://shop.example/item')).mime).toBe(
    'text/html',
  )
  remote.replies = [{ headers: {}, body: 'not HTML' }]
  await expect(fetchRecipeUrl('https://shop.example/item')).rejects.toThrow(
    /does not return a recipe/,
  )
  remote.replies = [
    {
      headers: { 'content-type': 'application/pdf' },
      body: '<html>bad</html>',
    },
  ]
  await expect(fetchRecipeUrl('https://shop.example/item')).rejects.toThrow(
    /does not return a recipe/,
  )
})
