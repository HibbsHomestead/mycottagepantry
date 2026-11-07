// @vitest-environment node
import { it, expect } from 'vitest'
import { productImportResponse } from './product-import-response'
import { packageCost } from './ingredients'
import { fetchRecipeUrl } from '../../netlify/lib/recipe-import'
import {
  productDetails,
  fetchProductDetails,
} from '../../netlify/lib/product-import'
const page = (v: any) =>
  '<script type="application/ld+json">' + JSON.stringify(v) + '</script>'
const source = 'https://shop.example/product'
it('keeps barcode and SKU separate, reads package rather than unit price and does not invent missing fields', () => {
  const [p] = productDetails(
    page({
      '@type': 'Product',
      name: 'Bread flour 25 lbs',
      gtin12: '001234567890',
      sku: 'SKU-123',
      offers: {
        '@type': 'Offer',
        price: '10.95',
        priceCurrency: 'USD',
        priceSpecification: { price: 0.438 },
      },
    }),
    source,
  )
  expect(p.fields).toMatchObject({
    barcode: '001234567890',
    retailerSku: 'SKU-123',
    packagePrice: 10.95,
    purchaseQuantity: 25,
    purchaseUnit: 'lb',
  })
  expect(p.fields.brand).toBeUndefined()
  expect(p.fields.allergens).toBeUndefined()
})
it('does not guess multipack contents, location prices or aggregate prices; exposes variants separately', () => {
  const p = productDetails(
    page({
      '@type': 'ProductGroup',
      hasVariant: [
        {
          '@type': 'Product',
          name: 'Flour 2 pack 10 lb',
          sku: '111',
          offers: { '@type': 'AggregateOffer', lowPrice: 4 },
        },
        {
          '@type': 'Product',
          name: 'Flour 25 lb',
          offers: { '@type': 'Offer', price: 12, description: 'Members only' },
        },
      ],
    }),
    source,
  )
  expect(p).toHaveLength(2)
  expect(p[0].fields.barcode).toBeUndefined()
  expect(p[0].fields.packagePrice).toBeUndefined()
  expect(p[0].fields.purchaseQuantity).toBeUndefined()
  expect(p[1].conditions).toContain('Members only')
})
it('rejects missing structured data, private and unsafe links', async () => {
  expect(() => productDetails('<h1>Access denied</h1>', source)).toThrow(
    /couldn’t automatically read this product page/,
  )
  await expect(
    fetchProductDetails('https://127.0.0.1/private'),
  ).rejects.toThrow(/Private/)
})
it.skipIf(!process.env.TEST_LIVE_RETAILER)(
  'checks the supplied live Sam’s Club URL without bypassing restrictions',
  async () => {
    try {
      const p = await fetchProductDetails(
        'https://www.samsclub.com/ip/Member-s-Mark-Bread-Pizza-Flour-25-lbs/13909715756',
      )
      const { writeFileSync } = await import('node:fs')
      writeFileSync(
        '/tmp/cottage-retailer-result.txt',
        JSON.stringify(
          p.map(({ title, fields, warnings, imageUrl }) => ({
            title,
            fields,
            warnings,
            imageAvailable: Boolean(imageUrl),
          })),
          null,
          2,
        ),
      )
      expect(p.length).toBeGreaterThan(0)
    } catch (e) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(
        '/tmp/cottage-retailer-result.txt',
        'Sam’s Club live attempt: ' + (e as Error).message,
      )
      expect((e as Error).message).toMatch(
        /unavailable|restricted|timed out|couldn’t automatically|exceeds/,
      )
    }
  },
  20000,
)

const samsUrl =
  'https://www.samsclub.com/ip/Member-s-Mark-Bread-Pizza-Flour-25-lbs/13909715756'
const samsPage = (primary: any) =>
  page({
    '@type': 'Product',
    name: 'Bread flour 25 lbs',
    sku: '13909715756',
    offers: {
      '@type': 'Offer',
      priceSpecification: [
        {
          '@type': 'UnitPriceSpecification',
          price: 12.08,
          priceCurrency: 'USD',
        },
      ],
    },
  }) +
  '<script id="__NEXT_DATA__" type="application/json">' +
  JSON.stringify({
    props: { pageProps: { initialData: { data: { product: primary } } } },
  }) +
  '</script>'
const priceInfo = (price: number) => ({
  currentPrice: { price, currencyUnit: 'USD' },
  unitPrice: { price: 0.439 },
  wasPrice: { price: 12.08 },
  listPrice: { price: 15 },
  savingsAmount: { price: 2 },
})
it('extracts only the matched Sam’s Club primary package current price and labels fulfillment choices', () => {
  const products = productImportResponse.parse({
    products: productDetails(
      samsPage({
        usItemId: '13909715756',
        channelLevelPriceInfo: [
          { type: 'PICKUP', channelPriceInfo: priceInfo(10.98) },
          { type: 'SHIPPING', channelPriceInfo: priceInfo(11.98) },
        ],
      }),
      samsUrl,
    ),
  }).products
  expect(products.map((p) => p.fields.packagePrice)).toEqual([10.98, 11.98])
  expect(products[0].conditions.join(' ')).toContain('PICKUP')
  expect(products[1].conditions.join(' ')).toContain('SHIPPING')
  expect(
    packageCost({ ...products[0].fields, unit: 'lb' } as any).unitCost,
  ).toBeCloseTo(10.98 / 25)
})
it('rejects mismatched primary products, other retailers, ambiguous ranges, missing currency and unit-only prices', () => {
  for (const primary of [
    { usItemId: 'other', priceInfo: priceInfo(10.98) },
    {
      usItemId: '13909715756',
      priceInfo: {
        ...priceInfo(10.98),
        priceRange: { minPrice: 9, maxPrice: 12 },
      },
    },
    { usItemId: '13909715756', priceInfo: { currentPrice: { price: 10.98 } } },
    { usItemId: '13909715756', priceInfo: { unitPrice: { price: 0.439 } } },
  ])
    expect(
      productDetails(samsPage(primary), samsUrl)[0].fields.packagePrice,
    ).toBeUndefined()
  expect(
    productDetails(
      samsPage({ usItemId: '13909715756', priceInfo: priceInfo(10.98) }),
      source,
    )[0].fields.packagePrice,
  ).toBeUndefined()
})
it.skipIf(!process.env.TEST_LIVE_RETAILER && !process.env.TEST_RETAILER_HTML)(
  'traces the retrieved primary-product price through normalized extraction',
  async () => {
    const fetched = process.env.TEST_RETAILER_HTML
      ? {
          bytes: (await import('node:fs')).readFileSync(
            process.env.TEST_RETAILER_HTML,
          ),
          url: samsUrl,
        }
      : await fetchRecipeUrl(samsUrl)
    const { load } = await import('cheerio')
    const $ = load(fetched.bytes.toString('utf8'))
    const primary = JSON.parse($('#__NEXT_DATA__').text()).props.pageProps
      .initialData.data.product
    expect(primary.usItemId).toBe('13909715756')
    const products = productImportResponse.parse({
      products: productDetails(fetched.bytes.toString('utf8'), fetched.url),
    }).products
    expect(products.length).toBeGreaterThan(0)
    for (const product of products) {
      expect(product.fields.packagePrice).toBe(
        primary.priceInfo.currentPrice.price,
      )
      expect(product.fields.currency).toBe(
        primary.priceInfo.currentPrice.currencyUnit,
      )
      expect(product.fields.purchaseQuantity).toBe(25)
      expect(
        packageCost({ ...product.fields, unit: 'lb' } as any).unitCost,
      ).toBeCloseTo(Number(product.fields.packagePrice) / 25)
    }
    console.info(
      process.env.TEST_RETAILER_HTML
        ? 'CAPTURED SOURCE package price'
        : 'LIVE primary package price',
      primary.priceInfo.currentPrice.price,
      primary.priceInfo.currentPrice.currencyUnit,
      'offers',
      products.length,
      'checked',
      products[0].checkedAt,
    )
  },
  20000,
)

it('distinguishes an evidenced retailer access challenge from a parser missing product fields', () => {
  expect(() =>
    productDetails(
      "<title>Let us know you're not a robot - Sam's Club</title>",
      samsUrl,
    ),
  ).toThrow(/access challenge instead of product data/)
})

it('recognizes the observed Walmart challenge title without guessing login or location', () => {
  expect(() =>
    productDetails(
      '<title>Robot or human?</title><h1>Robot or human?</h1><p>Activate and hold the button to confirm that you’re human.</p>',
      'https://www.walmart.com/blocked',
    ),
  ).toThrow(/Walmart requires human verification/)
})
it('reads public product metadata independently, retaining available fields without a price', () => {
  const html =
    '<meta property="og:type" content="product"><meta property="og:title" content="Canola oil 128 fl oz"><meta property="product:brand" content="Wesson"><meta property="og:image" content="https://images.example/oil.jpg">'
  const product = productImportResponse.parse({
    products: productDetails(html, source),
  }).products[0]
  expect(product.fields).toMatchObject({
    name: 'Canola oil 128 fl oz',
    brand: 'Wesson',
    packageSize: '128 fl oz',
  })
  expect(product.fields.purchaseUnit).toBeUndefined() // Regional volume needs confirmation.
  expect(product.fields.packagePrice).toBeUndefined()
  expect(product.fields.currency).toBeUndefined()
  expect(product.imageUrl).toBe('https://images.example/oil.jpg')
  expect(product.sourceUrl).toBe(source)
  expect(Number.isFinite(Date.parse(product.checkedAt))).toBe(true)
})
it('keeps nameless partial product fields rather than inventing a name', () => {
  const product = productImportResponse.parse({
    products: productDetails(
      page({
        '@type': 'Product',
        brand: 'Wesson',
        image: 'https://images.example/oil.jpg',
      }),
      source,
    ),
  }).products[0]
  expect(product.fields.name).toBeUndefined()
  expect(product.fields.brand).toBe('Wesson')
  expect(product.title).toBe('Product details')
  expect(
    productImportResponse.safeParse({
      products: [{ ...product, fields: {}, imageUrl: '' }],
    }).success,
  ).toBe(false)
})
it('requires product-specific metadata and rejects ambiguous metadata prices without discarding the name', () => {
  const metadata =
    '<meta property="og:title" content="Oil 128 US fl oz"><meta property="product:price:amount" content="9.12"><meta property="product:price:currency" content="USD">'
  expect(() => productDetails(metadata, source)).toThrow(
    /couldn’t automatically read/,
  )
  const productMeta = '<meta property="og:type" content="product">' + metadata
  expect(productDetails(productMeta, source)[0].fields).toMatchObject({
    packagePrice: 9.12,
    currency: 'USD',
    purchaseQuantity: 128,
    purchaseUnit: 'fl oz',
  })
  for (const extra of [
    '<meta property="product:price:amount" content="5.43">',
    '<meta property="product:price:currency" content="CAD">',
  ]) {
    const product = productDetails(productMeta + extra, source)[0]
    expect(product.fields.name).toBe('Oil 128 US fl oz')
    expect(product.fields.packagePrice).toBeUndefined()
  }
})
it('extracts explicit pack count without guessing a multipack total', () => {
  const product = productDetails(
    page({ '@type': 'Product', name: 'Oil 2 pack 128 fl oz' }),
    source,
  )[0]
  expect(product.fields.packCount).toBe(2)
  expect(product.fields.packageSize).toBe('128 fl oz')
  expect(product.fields.purchaseQuantity).toBeUndefined()
})
it('reads nested mainEntity Product while ignoring a password field in an unrelated sign-in widget', () => {
  const product = productDetails(
    '<input type="password">' +
      page({
        '@type': 'WebPage',
        mainEntity: { '@type': 'Product', name: 'Oil' },
      }),
    source,
  )[0]
  expect(product.fields.name).toBe('Oil')
})

it('retains explicitly supplied currency even when metadata has no usable price', () => {
  const [product] = productDetails(
    '<meta property="og:type" content="product"><meta property="og:title" content="Oil"><meta property="product:price:currency" content="USD">',
    source,
  )
  expect(product.fields.currency).toBe('USD')
  expect(product.fields.packagePrice).toBeUndefined()
})

it('does not coerce missing or non-price values to a zero package price', () => {
  for (const price of [' ', false, null, {}, undefined]) {
    const [product] = productDetails(
      page({
        '@type': 'Product',
        name: 'Oil',
        offers: { '@type': 'Offer', price, priceCurrency: 'USD' },
      }),
      source,
    )
    expect(product.fields.packagePrice).toBeUndefined()
    expect(product.fields.name).toBe('Oil')
  }
})

it('extracts the observed Sam’s Club specification format and keeps Contains separate', () => {
  const html = samsPage({
    usItemId: '13909715756',
    priceInfo: priceInfo(10.98),
  })
  const data = JSON.parse(
    html.match(
      /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/,
    )![1],
  )
  data.props.pageProps.initialData.data.idml = {
    ingredients: null,
    specifications: [
      {
        name: 'Specifications',
        value:
          '<p><strong>Net Weight: </strong>25 pounds</p><p><strong>Ingredients: </strong>Bleached wheat flour, malted barley flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid.<strong> Contains</strong> wheat.</p>',
      },
    ],
  }
  const capturedFormat = html.replace(
    /(<script id="__NEXT_DATA__" type="application\/json">).*?(<\/script>)/,
    `$1${JSON.stringify(data)}$2`,
  )
  expect(productDetails(capturedFormat, samsUrl)[0].fields).toMatchObject({
    subingredients:
      'Bleached wheat flour, malted barley flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid.',
    sourceContains: 'Contains wheat.',
  })
  expect(
    productDetails(capturedFormat, samsUrl)[0].fields.sourceMayContain,
  ).toBeUndefined()
  expect(
    productDetails(capturedFormat, samsUrl.replace('13909715756', '111'))[0]
      .fields.subingredients,
  ).toBeUndefined()
})
it('preserves nested wording and reads explicit details without borrowing ingredients from descriptions or reviews', () => {
  const wording =
    'Chocolate chips (sugar, cocoa butter, chocolate (cocoa, vanilla)), flour; salt.'
  const product = productDetails(
    page({
      '@type': 'Product',
      name: 'Cookies',
      description: 'Made with flour and eggs.',
    }) +
      `<h2>Ingredients</h2><p>${wording}</p><h3>Contains</h3><p>Wheat, milk.</p><h3>May contain</h3><p>Peanuts. Made in a facility that handles soy.</p>`,
    source,
  )[0]
  expect(product.fields).toMatchObject({
    subingredients: wording,
    sourceContains: 'Wheat, milk.',
    sourceMayContain: 'Peanuts. Made in a facility that handles soy.',
  })
  const absent = productDetails(
    page({
      '@type': 'Product',
      name: 'Pure Salt',
      description: 'Ingredients from the sea.',
    }) +
      '<aside><p><strong>Ingredients:</strong>Review author guess</p></aside>',
    source,
  )[0]
  expect(absent.fields.subingredients).toBeUndefined()
})
it('supports relevant structured properties and keeps combined allergen sentences distinct', () => {
  const product = productDetails(
    page({
      '@type': 'Product',
      name: 'Mix',
      additionalProperty: [
        {
          name: 'Ingredients',
          value:
            'Flour (wheat, malt), salt. Contains: wheat. May contain: soy. Made in a facility that handles peanuts.',
        },
      ],
    }),
    source,
  )[0]
  expect(product.fields).toMatchObject({
    subingredients: 'Flour (wheat, malt), salt.',
    sourceContains: 'Contains: wheat.',
    sourceMayContain:
      'May contain: soy. Made in a facility that handles peanuts.',
  })
  expect(product.fields.reviewed).toBeUndefined()
})

const ownerAmazonUrl =
  'https://www.amazon.com/dp/B0FK3XFMQQ?ref_=ppx_hzsearch_conn_dt_b_fed_asin_title_4'
const amazonDom = (prices = ['$31.99'], asin = 'B0FK3XFMQQ') =>
  `<html><title>Amazon.com - Bread bags</title><input id="ASIN" value="${asin}"><span id="productTitle">100 Pcs Bread Bags</span><img id="landingImage" src="https://m.media-amazon.com/images/bags.jpg"><div id="corePrice_feature_div">${prices.map((price) => `<span class="apex-pricetopay-value"><span class="a-offscreen">${price}</span></span>`).join('')}<span class="apex-priceperunit-value"><span class="a-offscreen">$0.32</span></span></div><div id="productOverview_feature_div"><table><tr><td>Number of Items</td><td>100</td></tr><tr><td>Capacity</td><td>16 ounces</td></tr><tr><td>Brand</td><td>Roppolo</td></tr></table></div></html>`
it('reads the ASIN-matched Amazon product, primary pay price, image and explicit item count without inferring currency or capacity as purchased weight', () => {
  const [result] = productDetails(amazonDom(), ownerAmazonUrl)
  expect(result.fields).toMatchObject({
    name: '100 Pcs Bread Bags',
    retailerSku: 'B0FK3XFMQQ',
    brand: 'Roppolo',
    packagePrice: 31.99,
    purchaseQuantity: 100,
    purchaseUnit: 'each',
    packageSize: '100 each',
  })
  expect(result.imageUrl).toContain('m.media-amazon.com')
  expect(result.fields.currency).toBeUndefined()
  expect(result.warnings.join(' ')).toContain('confirm currency')
})
it('does not choose between conflicting Amazon primary prices or substitute unit prices when a primary price is absent', () => {
  expect(
    productDetails(amazonDom(['$31.99', '$29.99']), ownerAmazonUrl)[0].fields
      .packagePrice,
  ).toBeUndefined()
  expect(
    productDetails(amazonDom([]), ownerAmazonUrl)[0].fields.packagePrice,
  ).toBeUndefined()
})
it('rejects an Amazon DOM for a different selected ASIN or a lookalike host', () => {
  expect(() =>
    productDetails(amazonDom([], 'B012345678'), ownerAmazonUrl),
  ).toThrow(/couldn’t automatically read/)
  expect(() =>
    productDetails(
      amazonDom(),
      ownerAmazonUrl.replace('www.amazon.com', 'amazon.com.example'),
    ),
  ).toThrow(/couldn’t automatically read/)
})
it('rejects an Amazon sign-in document even when it contains decoy Product metadata', () => {
  expect(() =>
    productDetails(
      '<title>Amazon Sign-In</title><input type="password">' +
        page({ '@type': 'Product', name: 'Decoy' }),
      ownerAmazonUrl,
    ),
  ).toThrow(/sign-in page/)
})
it('does not replace an Amazon weight package with Number of Items from its overview', () => {
  const html = amazonDom().replace('100 Pcs Bread Bags', 'Bread flour 20 lb')
  expect(productDetails(html, ownerAmazonUrl)[0].fields).toMatchObject({
    purchaseQuantity: 20,
    purchaseUnit: 'lb',
  })
})
