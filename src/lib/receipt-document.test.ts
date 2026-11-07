// @vitest-environment node
import { expect, it } from 'vitest'
import {
  readReceiptResponse,
  receiptFileEndpoint,
  receiptObjectKey,
  receiptDifferences,
} from './receipt-document'
it('rejects missing file ids and cross-business storage references', () => {
  expect(() => receiptFileEndpoint('')).toThrow('identifier')
  expect(() =>
    receiptObjectKey(
      'a',
      { id: 'b', name: 'Receipt', originalObjectKey: 'other/b/original' },
      true,
    ),
  ).toThrow('oven')
})
it('rejects expired authentication and HTML fallback independently of extraction', async () => {
  await expect(
    readReceiptResponse(
      new Response('<html>login</html>', {
        status: 401,
        headers: { 'content-type': 'text/html' },
      }),
    ),
  ).rejects.toThrow('access expired')
  await expect(
    readReceiptResponse(
      new Response('<html>app</html>', {
        headers: { 'content-type': 'text/html' },
      }),
    ),
  ).rejects.toThrow('instead of a receipt')
  await expect(
    readReceiptResponse(
      new Response('<html>app</html>', {
        headers: { 'content-type': 'application/pdf' },
      }),
    ),
  ).rejects.toThrow('not a supported')
})
it('checks status, byte type, redirects and missing files', async () => {
  await expect(
    readReceiptResponse(new Response('', { status: 404 })),
  ).rejects.toThrow('not found')
  const redirect = new Response('%PDF-1.7', {
    headers: { 'content-type': 'application/pdf' },
  })
  Object.defineProperty(redirect, 'redirected', { value: true })
  await expect(readReceiptResponse(redirect)).rejects.toThrow('redirected')
  await expect(
    readReceiptResponse(
      new Response('%PDF-1.7', { headers: { 'content-type': 'image/png' } }),
    ),
  ).rejects.toThrow('does not match')
})
it('preserves unknown totals and computes only known differences', () => {
  expect(receiptDifferences({ lines: [{ amount: null }] })).toEqual({
    lineTotal: null,
    subtotalDifference: null,
    totalDifference: null,
  })
  expect(
    receiptDifferences({
      subtotal: 10,
      tax: 1,
      otherCharges: 2,
      total: 14,
      lines: [{ amount: 9 }],
    }),
  ).toEqual({ lineTotal: 9, subtotalDifference: -1, totalDifference: -1 })
})
