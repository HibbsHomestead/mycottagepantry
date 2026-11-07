// @vitest-environment node
import { PassThrough } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib'
import { expect, it } from 'vitest'
import {
  readPageResponse,
  PRODUCT_PAGE_BYTES,
  RECIPE_PAGE_BYTES,
} from '../../netlify/lib/page-response'
import { productDetails } from '../../netlify/lib/product-import'

async function read(
  body: Buffer,
  headers: Record<string, string> = {},
  cap = PRODUCT_PAGE_BYTES,
) {
  const response = new PassThrough() as unknown as IncomingMessage
  response.headers = headers
  const result = readPageResponse(response, cap)
  queueMicrotask(() => {
    for (
      let offset = 0;
      offset < body.length && !response.destroyed;
      offset += 16384
    )
      (response as unknown as PassThrough).write(
        body.subarray(offset, offset + 16384),
      )
    ;(response as unknown as PassThrough).end()
  })
  return result
}
const productPage = (size: number) =>
  Buffer.from(
    '<html><script type="application/ld+json">{"@type":"Product","name":"Bags 100 count","image":"https://cdn.example/bags.jpg","offers":{"@type":"Offer","price":12,"priceCurrency":"USD"}}</script>' +
      ' '.repeat(size) +
      '</html>',
  )
it.each([100, RECIPE_PAGE_BYTES + 100])(
  'imports complete valid product HTML with %i padding bytes',
  async (size) => {
    const body = productPage(size)
    const result = await read(body)
    const [product] = productDetails(
      result.toString('utf8'),
      'https://shop.example/bags',
    )
    expect(product.fields).toMatchObject({
      name: 'Bags 100 count',
      packCount: 100,
      packagePrice: 12,
      currency: 'USD',
    })
    expect(product.imageUrl).toBe('https://cdn.example/bags.jpg')
  },
)
it('reproduces the old 1 MiB failure and permits that complete body at the revised limit', async () => {
  const body = productPage(RECIPE_PAGE_BYTES)
  await expect(read(body, {}, RECIPE_PAGE_BYTES)).rejects.toThrow(/1 MiB/)
  expect((await read(body)).length).toBe(body.length)
})
it.each([{}, { 'content-length': '10' }, { 'content-length': 'invalid' }])(
  'rejects actual bytes above 4 MiB despite absent or misleading Content-Length: %j',
  async (headers) => {
    await expect(
      read(
        Buffer.alloc(PRODUCT_PAGE_BYTES + 1),
        headers as Record<string, string>,
      ),
    ).rejects.toThrow(/4 MiB/)
  },
)
it('rejects declared oversized responses and incomplete bodies', async () => {
  await expect(
    read(Buffer.alloc(10), {
      'content-length': String(PRODUCT_PAGE_BYTES + 1),
    }),
  ).rejects.toThrow(/4 MiB/)
  await expect(
    read(Buffer.alloc(10), { 'content-length': '20' }),
  ).rejects.toThrow(/incomplete or malformed/)
})
it.each([
  ['gzip', gzipSync],
  ['br', brotliCompressSync],
  ['deflate', deflateSync],
] as const)(
  'limits decompressed %s bytes as well as download bytes',
  async (encoding, compress) => {
    const safe = productPage(RECIPE_PAGE_BYTES + 100)
    expect(
      await read(compress(safe), { 'content-encoding': encoding }),
    ).toEqual(safe)
    await expect(
      read(compress(Buffer.alloc(PRODUCT_PAGE_BYTES + 1, 32)), {
        'content-encoding': encoding,
      }),
    ).rejects.toThrow(/4 MiB/)
  },
)
it('rejects malformed compression, unsupported compression and interrupted responses without partial products', async () => {
  await expect(
    read(Buffer.from('invalid'), { 'content-encoding': 'gzip' }),
  ).rejects.toThrow(/malformed/)
  await expect(
    read(Buffer.alloc(10), { 'content-encoding': 'gzip, br' }),
  ).rejects.toThrow(/Unsupported/)
  const response = new PassThrough() as unknown as IncomingMessage
  response.headers = {}
  const reading = readPageResponse(response, PRODUCT_PAGE_BYTES)
  response.destroy(new Error('truncated response'))
  await expect(reading).rejects.toThrow(/incomplete or malformed/)
})
it('counts UTF-8 bytes before text decoding', async () => {
  await expect(
    read(Buffer.from('🍞'.repeat(270000)), {}, RECIPE_PAGE_BYTES),
  ).rejects.toThrow(/1 MiB/)
})
it('distinguishes access challenges, sign-in and other non-product content after fetching', () => {
  expect(() =>
    productDetails(
      '<title>Robot check</title>',
      'https://www.amazon.com/dp/B0FK3XFMQQ',
    ),
  ).toThrow(/access challenge/)
  expect(() =>
    productDetails(
      '<title>Sign in</title><input type="password">',
      'https://shop.example',
    ),
  ).toThrow(/sign-in page/)
  expect(() =>
    productDetails('<title>Home</title><h1>Shop</h1>', 'https://shop.example'),
  ).toThrow(/couldn’t automatically read/)
})
