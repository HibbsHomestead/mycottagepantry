import { expect, it } from 'vitest'
import { normalizeProductUrl } from './product-url'

it('normalizes the exact reported Amazon path before a request', () => {
  expect(
    normalizeProductUrl(
      'https://www.amazon.com/Aluminum-Disposable-Containers-Roasting-Blackgold/dp/B0G4WLFMWV/?ref_=search&qid=123#details',
    ),
  ).toBe('https://www.amazon.com/dp/B0G4WLFMWV')
})
it('removes search refinements and store-result context from the reported ASIN', () => {
  expect(
    normalizeProductUrl(
      'https://www.amazon.com/dp/B09V45JBKH?refinements=p_123%3Aexample&srs=example-search',
    ),
  ).toBe('https://www.amazon.com/dp/B09V45JBKH')
})
it('keeps offer, seller, quantity and variant choices while discarding tracking', () => {
  const url = new URL(
    normalizeProductUrl(
      'http://amazon.com/gp/product/b0g4wlfmwv/ref=abc?th=1&psc=1&smid=SELLER&m=MERCHANT&offerListingID=selected%2Boffer&condition=used&quantity=2&unknownChoice=keep&tag=tracking&pd_rd_w=tracking&utm_source=search&refinements=search-filter&srs=store-results',
    ),
  )
  expect(url.origin + url.pathname).toBe('https://www.amazon.com/dp/B0G4WLFMWV')
  expect(Object.fromEntries(url.searchParams)).toEqual({
    th: '1',
    psc: '1',
    smid: 'SELLER',
    m: 'MERCHANT',
    offerListingID: 'selected+offer',
    condition: 'used',
    quantity: '2',
    unknownChoice: 'keep',
  })
})
it.each([
  'https://www.samsclub.com/ip/flour/13909715756?selected=pickup',
  'https://www.amazon.com/s?refinements=keep&srs=keep',
  'https://amazon.com.example/dp/B0G4WLFMWV?tag=keep',
  'https://a.co/d/selected',
])('leaves other retailer and short-link paths intact: %s', (value) => {
  expect(normalizeProductUrl(value)).toBe(value)
})
it('leaves unsafe credentials and ports for the protected fetcher to reject', () => {
  const url = new URL(
    normalizeProductUrl('https://user:password@amazon.com:8443/dp/B0G4WLFMWV'),
  )
  expect(url.username).toBe('user')
  expect(url.port).toBe('8443')
})
