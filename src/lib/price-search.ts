import { convert, type Item } from './domain'
import { hasPurchasePackage, packageCost } from './ingredients'
export type PriceSearchInput = {
  query: string
  zip: string
  preference: 'both' | 'nearby' | 'online'
  alternativeBrands: boolean
}
export type WebOffer = {
  id: string
  retailer: string
  title: string
  brand?: string
  url: string
  direct: boolean
  thumbnail?: string
  price: number
  currency: string
  packageQuantity: number | null
  purchaseUnit: string | null
  multipack: number | null
  barcode?: string
  match: string
  rank: number
  checkedAt: string
  conditions: string[]
  conditional: boolean
  delivery?: string
  availability?: string
  availabilitySource?: string
  shipping: number | null
  deliveredTotal: number | null
}
export function searchPhrase(i: Item) {
  return [
    i.brand,
    i.name,
    (i.purchaseQuantity ?? i.packageQuantity) && i.purchaseUnit
      ? `${i.purchaseQuantity ?? i.packageQuantity} ${i.purchaseUnit}`
      : '',
    typeof i.barcode === 'string' ? i.barcode : '',
  ]
    .filter(Boolean)
    .join(' ')
}
export function validGtin(value: unknown) {
  if (typeof value !== 'string' || !/^\d{8}$|^\d{12,14}$/.test(value))
    return null
  const digits = value.split('').map(Number),
    last = digits.pop()!
  const sum = digits
    .reverse()
    .reduce((s, n, index) => s + n * (index % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === last ? value.padStart(14, '0') : null
}
export function searchInput(raw: any, i: Item): PriceSearchInput {
  const query = String(raw.query ?? searchPhrase(i)).trim(),
    zip = String(raw.zip || '').trim()
  if (!query || query.length > 180)
    throw new Error('Enter a product search of 1–180 characters.')
  if (zip && !/^\d{5}(?:-\d{4})?$/.test(zip))
    throw new Error('Enter a valid US ZIP code or leave it blank.')
  if (!['both', 'nearby', 'online'].includes(raw.preference || 'both'))
    throw new Error('Choose a shopping preference.')
  return {
    query,
    zip,
    preference: raw.preference || 'both',
    alternativeBrands: raw.alternativeBrands === true,
  }
}
export function packageFromTitle(
  title: string,
): { packageQuantity: number; purchaseUnit: string; multipack: number } | null {
  if (/\d\s*\/\s*\d|\d,\d{3}/.test(title)) return null
  const unitMap: Record<string, string> = {
    lb: 'lb',
    lbs: 'lb',
    pound: 'lb',
    pounds: 'lb',
    oz: 'oz',
    ounce: 'oz',
    ounces: 'oz',
    g: 'g',
    gram: 'g',
    grams: 'g',
    kg: 'kg',
    kilogram: 'kg',
    kilograms: 'kg',
    ml: 'ml',
    milliliter: 'ml',
    milliliters: 'ml',
    l: 'l',
    liter: 'l',
    liters: 'l',
    ct: 'each',
    count: 'each',
    each: 'each',
    'fl oz': 'fl oz',
  }
  const hits = [
    ...title
      .toLowerCase()
      .matchAll(
        /(?<![\d.,/])(\d+(?:\.\d+)?|\.\d+)\s*(fl\.?\s*oz|kilograms?|pounds?|ounces?|milliliters?|liters?|grams?|lbs?|kg|oz|ml|ct|count|each|g|l)\b/g,
      ),
  ]
  if (hits.length !== 1) return null
  const hit = hits[0],
    q = Number(hit[1]),
    unit = unitMap[hit[2].replace(/\./g, '').replace(/\s+/g, ' ')]
  const multipliers = [
    ...title
      .toLowerCase()
      .matchAll(
        /(?:pack|case)\s+of\s+(\d+)\b|\b(\d+)\s*[- ]?pack\b|\b(\d+)\s*[x×]\s*\d+(?:\.\d+)?\s*(?:fl\.?\s*oz|lb|oz|kg|g|ml|l|ct|count|each)\b/g,
      ),
  ].map((m) => Number(m[1] || m[2] || m[3]))
  if (
    multipliers.length > 1 ||
    (multipliers.length > 0 && /\b(?:total|combined)\b/i.test(title)) ||
    (/\b\d+\s*[x×]/i.test(title) && !multipliers.length) ||
    (/\b(?:case|multipack)\b/i.test(title) && !multipliers.length) ||
    !unit ||
    q <= 0
  )
    return null
  const count = multipliers[0] || 1
  if (!Number.isInteger(count) || count < 1 || count > 1000) return null
  return { packageQuantity: q * count, purchaseUnit: unit, multipack: count }
}
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
export function classifyOffer(
  i: Item,
  title: string,
  brand: string | undefined,
  barcode: string | undefined,
  pkg: ReturnType<typeof packageFromTitle>,
  alternativeBrands: boolean,
) {
  const name = words(i.name),
    candidate = words(title),
    sourceBrand = words(brand || ''),
    wantedBrand = words(i.brand || '')
  for (const [a, b] of [
    ['bread flour', 'all purpose'],
    ['gluten free', 'wheat flour'],
    ['whole wheat', 'white flour'],
    ['unsalted', 'salted'],
  ]) {
    if (
      (name.includes(a) && candidate.includes(b) && !candidate.includes(a)) ||
      (name.includes(b) && candidate.includes(a) && !name.includes(a))
    )
      return null
  }
  if (
    !name.includes('gluten free') &&
    candidate.includes('gluten free') &&
    name.includes('flour')
  )
    return null
  const tokens = name
    .split(' ')
    .filter(
      (w) =>
        w.length > 2 &&
        !['the', 'and', 'organic', 'package', 'bag', 'pack', 'lbs'].includes(
          w,
        ) &&
        !/^\d+$/.test(w),
    )
  const productMatch =
    tokens.length > 0 && tokens.every((w) => candidate.split(' ').includes(w))
  const sameBrand =
    wantedBrand &&
    (sourceBrand === wantedBrand ||
      (' ' + candidate + ' ').includes(' ' + wantedBrand + ' '))
  const otherBrand =
    !!wantedBrand && !!sourceBrand && sourceBrand !== wantedBrand && !sameBrand
  if (otherBrand && !alternativeBrands) return null
  const exact =
    validGtin(i.barcode) && validGtin(i.barcode) === validGtin(barcode)
  if (exact) return { match: 'Exact barcode match', rank: 0 }
  if (wantedBrand && !sameBrand && !alternativeBrands) return null
  if (!productMatch) return null
  if (otherBrand)
    return { match: 'Alternative brand — review labels and allergens', rank: 4 }
  if (pkg && hasPurchasePackage(i)) {
    try {
      const different =
        Math.abs(
          convert(
            pkg.packageQuantity,
            pkg.purchaseUnit,
            i.purchaseUnit,
            i.conversions,
          ) - Number(i.purchaseQuantity ?? i.packageQuantity),
        ) > 1e-8
      if (different)
        return {
          match: 'Different package size — check product details',
          rank: 2,
        }
      if (sameBrand) return { match: 'Brand/product/package match', rank: 1 }
    } catch {
      return { match: 'Likely match — check measurement category', rank: 3 }
    }
  }
  return { match: 'Likely match — check details', rank: 3 }
}
export function webComparison(
  i: Item,
  o: WebOffer,
): {
  warning?: string
  contents?: number
  unitCost?: number
  unit?: string
  difference?: number
  percent?: number
  equivalent?: number
} {
  if (!o.packageQuantity || !o.purchaseUnit)
    return {
      warning: 'Package size needs checking — unit comparison unavailable.',
    }
  try {
    const contents = convert(
        o.packageQuantity,
        o.purchaseUnit,
        i.storageUnit || i.unit,
        i.conversions,
      ),
      unitCost = o.price / contents
    const base = { contents, unitCost, unit: i.storageUnit || i.unit }
    if (o.currency !== (i.currency || 'USD'))
      return {
        ...base,
        warning: 'Different currency — comparison unavailable.',
      }
    if (!hasPurchasePackage(i) || i.packagePrice <= 0)
      return { ...base, warning: 'Add a reference price to compare.' }
    // An inclusive saved reference cannot be silently treated as an item-only quote.
    if (i.includesTax !== false || i.includesShipping !== false)
      return {
        ...base,
        warning:
          'Reference tax/shipping basis needs review; web prices are before tax and shipping.',
      }
    const ref = packageCost(i),
      difference = unitCost - ref.unitCost
    return {
      ...base,
      difference,
      percent: (difference / ref.unitCost) * 100,
      equivalent: difference * ref.contents,
    }
  } catch {
    return {
      warning: 'Package size needs checking — unit comparison unavailable.',
    }
  }
}
export function rankWebOffers(i: Item, offers: WebOffer[]) {
  return [...offers].sort(
    (a, b) =>
      a.rank - b.rank ||
      Number(a.conditional) - Number(b.conditional) ||
      (webComparison(i, a).difference == null
        ? Infinity
        : webComparison(i, a).unitCost!) -
        (webComparison(i, b).difference == null
          ? Infinity
          : webComparison(i, b).unitCost!),
  )
}
