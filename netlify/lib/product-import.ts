import { openFoodFactsProduct } from './open-food-facts'
import {
  ProductImportFailure,
  diagnosticUrl,
} from '../../src/lib/product-import-diagnostics'
import { productSpecifications } from './product-specifications'
import { PRODUCT_PAGE_BYTES } from './page-response'
import { normalizeUnit, parseQuantity } from '../../src/lib/domain'
import {
  productUrl,
  productImportResponse,
  ProductHumanVerificationError,
} from '../../src/lib/product-import-response'
import { load } from 'cheerio'
import { productStatements } from './product-statements'
import { fetchRecipeUrl, PageFetchHttpError } from './recipe-import'
import {
  amazonAsin,
  amazonSelectionKeys,
  normalizeProductUrl,
} from '../../src/lib/product-url'
import {
  retryDeadline,
  type ProductFetchHop,
} from '../../src/lib/product-import-diagnostics'
import { pageEvidence } from './page-diagnostics'
const scalar = (v: any): string =>
  typeof v === 'string'
    ? v.slice(0, 6000)
    : typeof v === 'number'
      ? String(v)
      : ''
const name = (v: any) => scalar(v?.name || v)
const safeLink = (v: any, base: string) => {
  try {
    const value = scalar(v?.url || v)
    if (!value) return ''
    const u = new URL(value, base)
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''
  } catch {
    return ''
  }
}
// Sam’s Club puts the selected package price in primary-product hydration data.
// Never search arbitrary price keys: recommendations and unit prices share this page.
function samsOffers(
  $: ReturnType<typeof load>,
  sourceUrl: string,
  product: any,
) {
  const url = new URL(sourceUrl)
  if (!['samsclub.com', 'www.samsclub.com'].includes(url.hostname)) return []
  const id = url.pathname.match(/\/ip\/[^/]+\/(\d+)\/?$/)?.[1]
  if (!id || scalar(product.sku) !== id) return []
  try {
    const primary = JSON.parse($('#__NEXT_DATA__').text())?.props?.pageProps
      ?.initialData?.data?.product
    if (scalar(primary?.usItemId) !== id) return []
    const candidates = Array.isArray(primary.channelLevelPriceInfo)
      ? primary.channelLevelPriceInfo.map((channel: any) => ({
          info: channel.channelPriceInfo,
          label: scalar(channel.type),
        }))
      : [{ info: primary.priceInfo, label: 'Selected online offer' }]
    return candidates.flatMap(({ info, label }: any) => {
      const price = info?.currentPrice?.price
      const currency = info?.currentPrice?.currencyUnit
      const range = info?.priceRange
      if (
        typeof price !== 'number' ||
        !Number.isFinite(price) ||
        price < 0 ||
        !/^[A-Z]{3}$/.test(currency || '') ||
        range?.minPrice != null ||
        range?.maxPrice != null ||
        range?.priceString ||
        info?.priceDisplayCodes?.finalCostByWeight
      )
        return []
      const sourceOffers = Array.isArray(product.offers)
        ? product.offers
        : [product.offers]
      const tiers = sourceOffers.flatMap((offer: any) => {
        const specs = Array.isArray(offer?.priceSpecification)
          ? offer.priceSpecification
          : [offer?.priceSpecification]
        return specs
          .filter(
            (spec: any) =>
              spec?.price === price && spec?.priceCurrency === currency,
          )
          .map((spec: any) =>
            scalar(
              spec.validForMemberTier?.name || spec.validForMemberTier?.['@id'],
            ),
          )
          .filter(Boolean)
      })
      return [
        {
          '@type': 'Offer',
          price,
          priceCurrency: currency,
          description: `Sam’s Club · ${label} · ${tiers.length ? 'Membership: ' + tiers.join(', ') + ' · ' : ''}confirm membership and store at checkout`,
        },
      ]
    })
  } catch {
    return []
  }
}
// Accessible Amazon product DOM only; no challenge bypass, browser automation or price scraping across recommendations.
function amazonProduct($: ReturnType<typeof load>, sourceUrl: string) {
  const url = new URL(sourceUrl)
  if (!['amazon.com', 'www.amazon.com'].includes(url.hostname)) return null
  const asin = url.pathname.match(
    /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/,
  )?.[1]
  const ids = $('input#ASIN')
    .map((_, el) => $(el).attr('value') || '')
    .get()
  const title = $('#productTitle').text().trim().replace(/\s+/g, ' ')
  if (!asin || !ids.length || ids.some((id) => id !== asin) || !title)
    return null
  const values = (selector: string) => [
    ...new Set(
      $(selector)
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(Boolean),
    ),
  ]
  // Only the primary offer's pay price, never unit, list, recommendation or installment prices.
  const prices = values(
    '#corePrice_feature_div .apex-pricetopay-value > .a-offscreen, #corePriceDisplay_desktop_feature_div .priceToPay > .a-offscreen',
  )
  const price =
    prices.length === 1 && /^\$[\d,]+\.\d{2}$/.test(prices[0])
      ? Number(prices[0].replace(/[$,]/g, ''))
      : undefined
  const details = new Map<string, string>()
  $('#productOverview_feature_div tr').each((_, el) => {
    const cells = $(el).find('td')
    if (cells.length === 2)
      details.set(
        $(cells[0]).text().trim().replace(/\s+/g, ' '),
        $(cells[1]).text().trim().replace(/\s+/g, ' '),
      )
  })
  const count = details.get('Number of Items')
  const titleCount = title.match(/\b(\d+)\s*(?:pcs?|pieces?|count|ct)\b/i)?.[1]
  return {
    '@type': 'Product',
    name: title,
    sku: asin,
    brand: details.get('Brand'),
    image:
      $('#landingImage').attr('data-old-hires') ||
      $('#landingImage').attr('src'),
    cottagePackageCount:
      count &&
      /^\d+$/.test(count) &&
      Number(count) > 0 &&
      titleCount &&
      Number(titleCount) === Number(count)
        ? Number(count)
        : undefined,
    offers: {
      '@type': 'Offer',
      price,
      seller: 'Amazon',
      description:
        'Primary online offer; verify selected package, seller, coupons and checkout conditions. Currency needs confirmation when absent from the source.',
    },
  }
}
function rejectProductChallenge($: ReturnType<typeof load>, sourceUrl: string) {
  const url = new URL(sourceUrl)
  const walmart = ['walmart.com', 'walmart.ca'].some(
    (host) => url.hostname === host || url.hostname.endsWith('.' + host),
  )
  const humanVerification =
    /robot or human|let us know you.re not a robot|robot check|captcha|human verification|verify (?:that )?you(?:.re| are)? (?:a )?human|confirm (?:that )?you(?:.re| are)? (?:a )?human/i
  const challenge =
    humanVerification.test($('title').text()) ||
    $('form[action*="captcha" i], input#captchacharacters').length > 0
  const walmartChallenge =
    walmart &&
    (challenge ||
      /^\/blocked(?:\/|$)/i.test(url.pathname) ||
      humanVerification.test($('h1, h2, [role="heading"]').text()))
  if (walmartChallenge) throw new ProductHumanVerificationError()
  if (challenge || /access denied/i.test($('title').text()))
    throw new Error(
      'The retailer returned an access challenge instead of product data. Automatic import cannot proceed from this response. You can enter the details manually; retailer access controls are not bypassed.',
    )
}
export function productDetails(html: string, sourceUrl: string) {
  const $ = load(html)
  rejectProductChallenge($, sourceUrl)
  // A delayed reload of this same document is not a redirect (ALDI uses 86400).
  // Never execute refresh directives; reject destinations and immediate/invalid reloads.
  const redirectRefresh = $('meta[http-equiv="refresh" i]')
    .toArray()
    .some((element) => {
      const content = ($(element).attr('content') || '').trim()
      return (
        !/^\d+(?:\.\d+)?$/.test(content) ||
        !Number.isFinite(Number(content)) ||
        Number(content) <= 0
      )
    })
  const browserRedirect = pageEvidence(
    html,
    new URL(sourceUrl),
    $,
  ).browserRedirect
  if (
    redirectRefresh ||
    (browserRedirect &&
      (browserRedirect.kind === 'error' ||
        browserRedirect.kind === 'challenge' ||
        !$('#productTitle').length)) ||
    /^(?:service unavailable|internal server error|sorry[!,.]?|error\s*[45]\d\d)/i.test(
      $('title').text().trim(),
    )
  )
    throw new Error(
      'The source returned an error document instead of product details.',
    )
  const products: any[] = []
  if (
    $('input[type="password"]').length &&
    /^(?:Amazon[\s.:–-]*)?(?:sign[ -]?in|log[ -]?in)(?:\b|$)/i.test(
      $('title').text().trim(),
    )
  )
    throw new Error(
      'The retailer returned a sign-in page instead of product details. You can enter the details manually; retailer authentication is not bypassed.',
    )
  const visit = (v: any, depth = 0) => {
    if (!v || typeof v !== 'object' || depth > 12 || products.length >= 20)
      return
    if (Array.isArray(v)) {
      v.forEach((x) => visit(x, depth + 1))
      return
    }
    const types = Array.isArray(v['@type']) ? v['@type'] : [v['@type']]
    if (types.includes('Product')) products.push(v)
    if (v['@graph']) visit(v['@graph'], depth + 1)
    if (v.mainEntity) visit(v.mainEntity, depth + 1)
    if (v.itemListElement) visit(v.itemListElement, depth + 1)
    if (v.item) visit(v.item, depth + 1)
    if (v.hasVariant) visit(v.hasVariant, depth + 1)
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()))
    } catch {}
  })
  if (!products.length) {
    const amazon = amazonProduct($, sourceUrl)
    if (amazon) products.push(amazon)
  }
  // Public product metadata only: a generic page's title/image is not a product.
  // Never read prices from page text, recommendations, unit prices or URL slugs.
  if (!products.length) {
    const meta = (key: string) => {
      const values = $(`meta[property="${key}"], meta[name="${key}"]`)
        .map((_, el) => $(el).attr('content')?.trim() || '')
        .get()
        .filter(Boolean)
      return new Set(values).size === 1 ? values[0] : ''
    }
    if (meta('og:type').toLowerCase() === 'product') {
      const amount = meta('product:price:amount')
      const currency = meta('product:price:currency')
      products.push({
        '@type': 'Product',
        name: meta('og:title'),
        brand: meta('product:brand'),
        image: meta('og:image'),
        description: meta('og:description'),
        sku: meta('product:retailer_item_id'),
        offers: {
          '@type': 'Offer',
          ...(/^[A-Z]{3}$/.test(currency) ? { priceCurrency: currency } : {}),
          ...(/^\d+(?:\.\d+)?$/.test(amount) && /^[A-Z]{3}$/.test(currency)
            ? { price: amount }
            : {}),
        },
      })
    }
  }
  if (!products.length) {
    throw new Error(
      'We couldn’t automatically read this product page. You can enter the details manually.',
    )
  }
  const checkedAt = new Date().toISOString()
  return products
    .flatMap((p) => {
      const structuredOffers = p.offers
        ? Array.isArray(p.offers)
          ? p.offers
          : [p.offers]
        : [{}]
      const retailerOffers = structuredOffers.every((o: any) => o.price == null)
        ? samsOffers($, sourceUrl, p)
        : []
      const offers = retailerOffers.length ? retailerOffers : structuredOffers
      const statements = productStatements(
        p,
        html,
        sourceUrl,
        products.length === 1,
        $,
      )
      return offers.slice(0, 10).map((o: any) => {
        // Use an explicit Offer.price or the ID-checked retailer package price above; never infer a package price from unit specifications or aggregate ranges.
        const fields: Record<string, string | number> = {}
        const add = (key: string, value: any) => {
          const s = scalar(value)
          if (s) fields[key] = s
        }
        add('name', p.name)
        add('brand', name(p.brand))
        add(
          'vendor',
          name(o.seller) || $('meta[property="og:site_name"]').attr('content'),
        )
        add('retailerSku', p.sku)
        const gtin = [p.gtin, p.gtin12, p.gtin13, p.gtin14, p.gtin8].find((v) =>
          /^\d{8}$|^\d{12,14}$/.test(scalar(v)),
        )
        add('barcode', gtin)
        add(
          'notes',
          typeof p.description === 'string' ? load(p.description).text() : '',
        )
        Object.assign(fields, statements)
        if (/^[A-Z]{3}$/.test(scalar(o.priceCurrency)))
          add('currency', o.priceCurrency)
        const price = o.price
        if (
          (o['@type'] === 'Offer' || !o['@type']) &&
          (typeof price === 'number' ||
            (typeof price === 'string' &&
              /^\d+(?:\.\d+)?$/.test(price.trim()))) &&
          Number.isFinite(Number(price)) &&
          Number(price) >= 0
        ) {
          fields.packagePrice = Number(price)
        }
        const title = scalar(p.name)
        const packagePattern =
          /\b(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s*((?:US\s+)?(?:fl\.?\s*oz|gallons?|gal|quarts?|qt|pints?|pt|cups?|tbsp|tsp)|lbs?|pounds?|oz|ounces?|mg|kg|g|ml|liters?|l)\b/i
        const titlePackageMatch = title.match(packagePattern)
        // ALDI supplies the package size separately from the name in Product.size.
        // Accept only a complete, explicit measure, never a clothing size or multipack fragment.
        const size = typeof p.size === 'string' ? p.size.trim() : ''
        const sizeMatch = size.match(packagePattern)
        const packageMatch =
          titlePackageMatch || (sizeMatch?.[0] === size ? sizeMatch : null)
        const count = title.match(
          /\b(\d+)\s*[- ]?(?:pack|pk|count|ct)\b|\b\d+\s*[x×]\s*\d/i,
        )
        if (count?.[1] && Number(count[1]) > 0)
          fields.packCount = Number(count[1])
        if (packageMatch) fields.packageSize = packageMatch[0]
        if (packageMatch && !count) {
          const unit = normalizeUnit(packageMatch[2])
          if (unit) {
            fields.purchaseQuantity = parseQuantity(packageMatch[1])
            fields.purchaseUnit = unit
          }
        }
        if (
          !packageMatch &&
          Number.isSafeInteger(p.cottagePackageCount) &&
          p.cottagePackageCount > 0
        ) {
          fields.purchaseQuantity = p.cottagePackageCount
          fields.purchaseUnit = 'each'
          fields.packageSize = `${p.cottagePackageCount} each`
        }
        Object.assign(fields, productSpecifications(p))
        const image = Array.isArray(p.image) ? p.image[0] : p.image
        return {
          fields,
          imageUrl: safeLink(image, sourceUrl),
          sourceUrl,
          checkedAt,
          title: title || 'Product details',
          conditions: [
            ...(o['@type'] === 'AggregateOffer' ||
            o.lowPrice != null ||
            o.highPrice != null
              ? [
                  'Price range / starting price; select a specific variant and confirm its price.',
                ]
              : []),
            scalar(o.description),
            scalar(o.eligibleCustomerType),
            scalar(o.availability),
          ].filter(Boolean),
          warnings: [
            'Verify the selected package and any membership, coupon, subscription or location conditions. Tax and shipping are not inferred.',
            ...(count
              ? [
                  'Multipack detected. Confirm package count and contents manually; no total quantity was guessed.',
                ]
              : []),
            ...(p.cottagePackageCount
              ? [
                  'Package count was read from the selected product details; confirm against the package.',
                ]
              : []),
            ...(packageMatch && !count
              ? [
                  titlePackageMatch
                    ? 'Package quantity was read from the product title; confirm against the actual package.'
                    : 'Package quantity was read from the product’s structured size; confirm against the actual package.',
                ]
              : ['Package size needs checking.']),
            ...(!fields.currency && fields.packagePrice !== undefined
              ? [
                  'Source currency was not provided; confirm currency before using the price.',
                ]
              : []),
            ...(fields.packagePrice === undefined
              ? [
                  'The retrieved source did not expose a supported, usable package price. Existing price is preserved; enter or confirm the amount paid manually.',
                ]
              : []),
          ],
        }
      })
    })
    .filter(
      (product) =>
        Boolean(product.imageUrl) ||
        Object.keys(product.fields).some(
          (key) => !['vendor', 'currency'].includes(key),
        ),
    )
    .slice(0, 20)
}
export async function fetchProductDetails(url: string) {
  const requestedAt = new Date().toISOString()
  const requestedUrl = productUrl(url)
  const input = new URL(normalizeProductUrl(requestedUrl))
  if (input.hostname === 'world.openfoodfacts.org') {
    const code = input.pathname.match(
      /^\/product\/(\d{8}|\d{12,14})(?:\/|$)/,
    )?.[1]
    if (!code)
      throw new Error(
        'Choose an Open Food Facts product page with a complete barcode.',
      )
    const product = await openFoodFactsProduct(
      code,
      code.length === 8 ? 'ean_8' : undefined,
    )
    if (!product)
      throw new Error(
        'No exact public product record was found. Your draft is unchanged.',
      )
    return productImportResponse.parse({ products: [product] }).products
  }
  const failure = (
    message: string,
    source: 'retailer' | 'network',
    hops: ProductImportFailure['diagnostics']['hops'] = [],
    stage: 'fetch' | 'parse' = 'fetch',
  ) =>
    new ProductImportFailure(
      message,
      {
        requestedAt,
        requestedUrl: diagnosticUrl(requestedUrl),
        normalizedUrl: diagnosticUrl(input.href),
        retrieval: 'direct-https',
        fallback: 'none-configured',
        source,
        stage,
        hops,
      },
      hops.at(-1)?.headers['retry-after'],
    )
  let page
  const hops: ProductFetchHop[] = []
  const deadline = Date.now() + 28000
  const requestedAsin = amazonAsin(input)
  const validateRedirect = (destination: URL) => {
    if (
      requestedAsin &&
      (amazonAsin(destination) !== requestedAsin ||
        amazonSelectionKeys.some(
          (key) =>
            input.searchParams.has(key) &&
            destination.searchParams.get(key) !== input.searchParams.get(key),
        ))
    )
      throw new Error(
        'The product request changed its identifier or selected options. No details were imported. Continue manually or verify the product link.',
      )
  }
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        page = await fetchRecipeUrl(input.href, false, PRODUCT_PAGE_BYTES, {
          deadline,
          validateRedirect,
        })
        hops.push(...(page.hops || []).map((hop) => ({ ...hop, attempt })))
        page.hops = hops
        break
      } catch (error) {
        if (error instanceof PageFetchHttpError) {
          hops.push(...error.hops.map((hop) => ({ ...hop, attempt })))
          const challenge =
            error.page?.mime === 'text/html' &&
            pageEvidence(
              error.page.bytes.toString('utf8'),
              new URL(error.page.url),
            ).challenge
          const transient =
            [429, 500, 502, 503, 504].includes(error.status) && !challenge
          const retryAfter = error.hops.at(-1)?.headers['retry-after']
          const delay = retryAfter
            ? retryDeadline(retryAfter) - Date.now()
            : 500 * 2 ** (attempt - 1)
          // Long Retry-After waits belong to the explicit UI retry. Do not
          // truncate the wait and contact the source earlier than requested.
          if (
            attempt < 3 &&
            transient &&
            delay <= 5000 &&
            Date.now() + delay + 1000 < deadline
          ) {
            await new Promise((resolve) => setTimeout(resolve, delay))
            continue
          }
          throw new PageFetchHttpError(error.status, error.page, hops)
        }
        hops.push(
          ...((error as { hops?: ProductFetchHop[] })?.hops || []).map(
            (hop) => ({ ...hop, attempt }),
          ),
        )
        const transient = ['EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT'].includes(
          String((error as { code?: string })?.code),
        )
        const delay = 500 * 2 ** (attempt - 1)
        if (attempt < 3 && transient && Date.now() + delay + 1000 < deadline) {
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }
        throw error
      }
    }
    if (!page) throw new Error('Product page request timed out.')
  } catch (e) {
    if (e instanceof PageFetchHttpError) {
      let message = `The product details could not be retrieved (HTTP ${e.status}).`
      if ([401, 403].includes(e.status))
        message = `The retailer denied access to this request (HTTP ${e.status}). You can enter the details manually; access restrictions are not bypassed.`
      if ([404, 410].includes(e.status))
        message = `The retailer did not find this product page (HTTP ${e.status}). Check the link or enter the details manually.`
      if (e.page?.mime === 'text/html') {
        try {
          rejectProductChallenge(
            load(e.page.bytes.toString('utf8')),
            e.page.url,
          )
        } catch (challenge) {
          if (challenge instanceof ProductHumanVerificationError)
            throw challenge
          if (
            pageEvidence(e.page.bytes.toString('utf8'), new URL(e.page.url))
              .challenge
          )
            message = `The source returned an access challenge (HTTP ${e.status}). Enter the details manually.`
        }
      }
      throw failure(message, 'retailer', e.hops)
    }
    const message = e instanceof Error ? e.message : ''
    if (/timed out/i.test(message))
      throw failure(
        'The product page request timed out. Retry or enter the details manually.',
        'network',
        hops,
      )
    // Only relay our own bounded validation messages, never arbitrary network errors.
    if (
      /^(The product request changed|Private or|Use a public HTTPS|Too many recipe link|Recipe page exceeds|The page response was|Unsupported page compression|This link does not return a recipe)/.test(
        message,
      )
    )
      throw failure(
        message.replace(/recipe/gi, 'product'),
        hops.length ? 'retailer' : 'network',
        hops,
      )
    if (
      [
        'ENOTFOUND',
        'EAI_AGAIN',
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
      ].includes(String((e as { code?: string })?.code))
    )
      throw failure(
        'The product page could not be fetched because of a network error. Retry or enter the details manually.',
        'network',
        hops,
      )
    throw failure(
      'We couldn’t automatically read this product page. You can enter the details manually.',
      'network',
      hops,
    )
  }
  try {
    if (requestedAsin) {
      const finalUrl = new URL(page.url)
      const finalAsin = finalUrl.pathname.match(
        /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i,
      )?.[1]
      if (
        !finalUrl.hostname.match(/(^|\.)amazon\.[a-z.]+$/i) ||
        finalAsin?.toUpperCase() !== requestedAsin.toUpperCase() ||
        amazonSelectionKeys.some(
          (key) =>
            input.searchParams.has(key) &&
            finalUrl.searchParams.get(key) !== input.searchParams.get(key),
        )
      )
        throw new Error(
          'The product request changed its identifier or selected options. No details were imported. Keep the original URL or continue manually.',
        )
    }
    if (page.mime !== 'text/html')
      throw new Error('This product link does not return an HTML product page.')
    const parsed = productImportResponse.safeParse({
      products: productDetails(page.bytes.toString('utf8'), page.url),
    })
    if (!parsed.success)
      throw new Error(
        'We couldn’t automatically read this product page. You can enter the details manually.',
      )
    if (
      requestedAsin &&
      parsed.data.products.some(
        (product) =>
          /^[A-Z0-9]{10}$/i.test(String(product.fields.retailerSku || '')) &&
          String(product.fields.retailerSku).toUpperCase() !==
            requestedAsin.toUpperCase(),
      )
    )
      throw new Error(
        'The page describes a different Amazon identifier or variant. No details were imported; continue manually or verify the original product link.',
      )
    return parsed.data.products.map((product) => ({
      ...product,
      requestedUrl,
    }))
  } catch (error) {
    if (error instanceof ProductHumanVerificationError) throw error
    throw failure(
      error instanceof Error &&
        /^(The (?:source|retailer|product|page)|This product|We couldn’t)/.test(
          error.message,
        )
        ? error.message
        : 'We couldn’t automatically read this product page. You can enter the details manually.',
      'retailer',
      page.hops,
      'parse',
    )
  }
}
