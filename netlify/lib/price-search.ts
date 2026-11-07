import { createHash } from 'node:crypto'
import { z } from 'zod'
import { shoppingSearchEnabled } from './feature-flags'
import {
  classifyOffer,
  packageFromTitle,
  rankWebOffers,
  type PriceSearchInput,
  type WebOffer,
} from '../../src/lib/price-search'
import type { Item } from '../../src/lib/domain'
export function priceSearchConfigured() {
  return !!globalThis.Netlify?.env.get('SERPAPI_API_KEY')?.trim()
}
const safeUrl = (value: unknown) => {
  try {
    const u = new URL(String(value))
    return u.protocol === 'https:' && !u.username && !u.password
      ? u.href
      : undefined
  } catch {
    return undefined
  }
}
const isDirect = (url: string) =>
  !/(^|\.)google\.[a-z.]+$/.test(new URL(url).hostname)
function listingUrl(row: Record<string, unknown>) {
  const links = [safeUrl(row.link), safeUrl(row.product_link)].filter(
    (url): url is string => !!url,
  )
  return links.find(isDirect) || links[0]
}
const text = (v: unknown, max = 1000) =>
  typeof v === 'string' ? v.slice(0, max) : undefined
const rowSchema = z
  .object({
    title: z.string().min(1).max(1000),
    extracted_price: z.number().finite().nonnegative(),
    price: z.string().max(100),
  })
  .passthrough()
export function normalizeShopping(
  rows: unknown,
  i: Item,
  input: PriceSearchInput,
  checkedAt: string,
): WebOffer[] {
  if (!Array.isArray(rows))
    throw new Error('Price provider returned an invalid response.')
  const offers: WebOffer[] = []
  for (const raw of rows.slice(0, 40)) {
    const parsed = rowSchema.safeParse(raw)
    if (!parsed.success) continue
    const r = parsed.data,
      url = listingUrl(r),
      retailer = text(r.source) || text(r.name)
    if (!url || !retailer) continue
    const currency =
      typeof r.currency === 'string'
        ? r.currency
        : /^\$\s*[\d,]/.test(r.price)
          ? 'USD'
          : 'Unknown'
    const pkg = packageFromTitle(r.title),
      brand = text(r.brand, 120),
      barcode =
        typeof r.gtin === 'string'
          ? r.gtin
          : typeof r.upc === 'string'
            ? r.upc
            : undefined
    const classification = classifyOffer(
      i,
      r.title,
      brand,
      barcode,
      pkg,
      input.alternativeBrands,
    )
    if (!classification) continue
    const details = [
      ...(Array.isArray(r.extensions) ? r.extensions : []),
      ...(Array.isArray(r.details_and_offers) ? r.details_and_offers : []),
      r.delivery,
      r.shipping,
      r.tag,
    ]
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.slice(0, 300))
    const conditions = details.filter((v) =>
      /member|coupon|subscri|subscribe|first order|with code|auto.?ship/i.test(
        v,
      ),
    )
    if (/member|coupon|subscri|subscribe|with code|auto.?ship/i.test(r.title))
      conditions.push('Conditional price — check retailer requirements')
    const availability = details.find((v) =>
      /\bin stock\b|\bout of stock\b|sold out|available for pickup/i.test(v),
    )
    const direct = isDirect(url)
    offers.push({
      id: createHash('sha256')
        .update(url + '|' + r.extracted_price + '|' + r.title)
        .digest('hex')
        .slice(0, 24),
      retailer,
      title: r.title,
      brand,
      url,
      direct,
      thumbnail: safeUrl(r.thumbnail),
      price: r.extracted_price,
      currency,
      packageQuantity: pkg?.packageQuantity ?? null,
      purchaseUnit: pkg?.purchaseUnit ?? null,
      multipack: pkg?.multipack ?? null,
      barcode,
      ...classification,
      checkedAt,
      conditions,
      conditional: conditions.length > 0,
      delivery:
        text(r.delivery) ||
        details.find((v) => /delivery|pickup|shipping/i.test(v)),
      availability,
      availabilitySource: availability ? 'SerpApi listing details' : undefined,
      shipping:
        typeof r.shipping_extracted === 'number' && r.shipping_extracted >= 0
          ? r.shipping_extracted
          : null,
      deliveredTotal:
        typeof r.extracted_total === 'number' && r.extracted_total >= 0
          ? r.extracted_total
          : null,
    })
  }
  return rankWebOffers(i, [
    ...new Map(offers.map((o) => [o.url + '|' + o.price, o])).values(),
  ]).slice(0, 16)
}
export class PriceSearchError extends Error {
  constructor(
    message: string,
    public code:
      | 'authentication_failed'
      | 'allowance_exhausted'
      | 'provider_unavailable'
      | 'feature_disabled'
      | 'missing_configuration' = 'provider_unavailable',
  ) {
    super(message)
  }
}
function providerFailure(status: number, detail = '') {
  if (
    [401, 403].includes(status) ||
    /invalid.*(?:api.?key|key)|(?:api.?key|key).*invalid|unauthorized|authentication/i.test(
      detail,
    )
  )
    return new PriceSearchError(
      'Authentication failed. SerpApi rejected the API key. An owner must check the server configuration.',
      'authentication_failed',
    )
  if (
    [402, 429].includes(status) ||
    /run out|exhaust|quota|allowance|rate.?limit|searches.*(?:left|limit)|limit.*(?:search|exceed)/i.test(
      detail,
    )
  )
    return new PriceSearchError(
      'Allowance exhausted or rate limit reached. Check your SerpApi plan before retrying.',
      'allowance_exhausted',
    )
  return new PriceSearchError(
    'Provider unavailable. SerpApi could not complete the request. Try again later.',
  )
}
async function providerCall(parameters: Record<string, string>, key: string) {
  requireShoppingSearch()
  const url = new URL('https://serpapi.com/search.json')
  for (const [k, v] of Object.entries({ ...parameters, api_key: key }))
    url.searchParams.set(k, v)
  let response: Response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
    })
  } catch {
    throw new PriceSearchError(
      'Provider unavailable. The request timed out or is unavailable. Try again later.',
    )
  }
  if (!response.ok) throw providerFailure(response.status)
  if (
    !(response.headers.get('content-type') || '').includes('application/json')
  )
    throw new PriceSearchError(
      'Provider unavailable. SerpApi returned an unexpected response format. Try again later.',
    )
  const payload = await response.json().catch(() => null)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new PriceSearchError(
      'Provider unavailable. SerpApi returned an invalid response. Try again later.',
    )
  if (
    parameters.engine === 'google_shopping' &&
    typeof payload.error === 'string' &&
    /google (?:hasn't|has not) returned any results for this query/i.test(
      payload.error,
    )
  )
    return { shopping_results: [] }
  if (payload.error)
    throw providerFailure(
      response.status,
      typeof payload.error === 'string' ? payload.error : '',
    )
  return payload
}
export async function findPrices(i: Item, input: PriceSearchInput) {
  requireShoppingSearch()
  const key = globalThis.Netlify?.env.get('SERPAPI_API_KEY')?.trim()
  if (!key)
    throw new PriceSearchError(
      'Missing configuration. Set SERPAPI_API_KEY for Netlify Functions, then redeploy.',
      'missing_configuration',
    )
  const result = await providerCall(
    {
      engine: 'google_shopping',
      q: input.query + (input.preference === 'nearby' ? ' near me' : ''),
      gl: 'us',
      hl: 'en',
      ...(input.zip ? { location: input.zip + ', United States' } : {}),
    },
    key,
  )
  if (
    !Array.isArray(result.shopping_results) &&
    !result.search_information?.shopping_results_state
  )
    throw new PriceSearchError(
      'Provider unavailable. Price provider returned an invalid response.',
    )
  let rows = Array.isArray(result.shopping_results)
    ? result.shopping_results
    : []
  // Expand at most two relevant listings to obtain direct retailer links when available.
  const seenTokens = new Set<string>()
  const candidates = rows
    .filter((r: any) => {
      if (!r || typeof r !== 'object') return false
      const direct = listingUrl(r)
      if (direct && isDirect(direct)) return false
      if (seenTokens.has(r.immersive_product_page_token)) return false
      const relevant =
        typeof r.title === 'string' &&
        classifyOffer(
          i,
          r.title,
          r.brand,
          r.gtin || r.upc,
          packageFromTitle(r.title),
          input.alternativeBrands,
        ) &&
        typeof r.immersive_product_page_token === 'string'
      if (relevant) seenTokens.add(r.immersive_product_page_token)
      return relevant
    })
    .slice(0, 2)
  for (const candidate of candidates) {
    try {
      const product = await providerCall(
        {
          engine: 'google_immersive_product',
          page_token: candidate.immersive_product_page_token,
        },
        key,
      )
      const stores = product.product_results?.stores
      if (Array.isArray(stores) && stores.length) {
        const expanded = stores.slice(0, 6).map((store: any) => ({
          ...store,
          source: store.name,
          brand: product.product_results.brand,
          thumbnail:
            product.product_results.thumbnails?.[0] || candidate.thumbnail,
          title:
            store.title || product.product_results.title || candidate.title,
        }))
        rows = [...expanded, ...rows.filter((r: any) => r !== candidate)]
      }
    } catch (error) {
      if (
        error instanceof PriceSearchError &&
        ['authentication_failed', 'allowance_exhausted'].includes(error.code)
      )
        throw error
      // Keep base listings, but stop spending allowance after an enrichment failure.
      break
    }
  }
  return normalizeShopping(rows, i, input, new Date().toISOString())
}

function requireShoppingSearch() {
  if (!shoppingSearchEnabled())
    throw new PriceSearchError(
      'Shopping search is unavailable.',
      'feature_disabled',
    )
}
