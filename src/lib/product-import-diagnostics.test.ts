import { expect, it } from 'vitest'
import { diagnosticUrl, retryDeadline } from './product-import-diagnostics'
it('redacts arbitrary query values while retaining ASIN and safe variant selectors', () => {
  expect(
    diagnosticUrl(
      'https://www.amazon.com/dp/B0BQMJJBNP?ref_=private-search&th=1&psc=1&asin=B0BQMJJBNP#private',
    ),
  ).toBe(
    'https://www.amazon.com/dp/B0BQMJJBNP?ref_=%5Bredacted%5D&th=1&psc=1&asin=B0BQMJJBNP',
  )
  expect(diagnosticUrl('https://shop.example/p?th=secret')).not.toContain(
    'secret',
  )
})
it('respects seconds and date Retry-After values with a bounded default delay', () => {
  const now = Date.parse('2026-11-07T20:00:00Z')
  expect(retryDeadline('60', now)).toBe(now + 60000)
  expect(retryDeadline('Sat, 07 Nov 2026 20:02:00 GMT', now)).toBe(now + 120000)
  expect(retryDeadline(undefined, now)).toBe(now + 3000)
  expect(retryDeadline('bad', now)).toBe(now + 3000)
})
