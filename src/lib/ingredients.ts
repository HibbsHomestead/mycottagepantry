import { applyPurchaseSetup, validateConversions } from './purchase-setup'
import { supportsExpiry } from './fabric'
import { inventoryProductKeys } from './inventory-product'
import { isPackaging, selectPantryCategory } from './pantry-category'
import { prepareStockUnitBasis } from './ingredient-stock-unit'
import {
  barcodeText,
  barcodeFormats as scanFormats,
  barcodeMatches,
} from './barcodes'
import {
  convert,
  parseQuantity,
  ingredientUnits,
  number,
  validateDate,
  allergens,
  effectiveRecipeLines,
  type Item,
} from './domain'
export type IngredientPurchaseOffer = {
  id: string
  ingredientId: string
  vendorId: string
  vendor: string
  purchaseQuantity: number
  purchaseUnit: string
  packagePrice: number
  currency: string
  barcode: string
  brand: string
  productUrl: string
  priceCheckedAt: string
  offerExpiresAt?: string
  includesTax: boolean | null
  includesShipping: boolean | null
  preferred?: boolean
  source: 'manual' | 'receipt' | 'connected_provider'
  notes: string
  subingredients: string
  allergens: string[]
}
export const pantrySortKeys = [
  'name',
  'category',
  'quantity',
  'currentCost',
  'value',
  'status',
  'threshold',
  'vendor',
] as const
export type PantrySort = {
  key: (typeof pantrySortKeys)[number]
  direction: 'asc' | 'desc'
}
export function validPantrySort(value: any): PantrySort {
  return {
    key: pantrySortKeys.includes(value?.key) ? value.key : 'name',
    direction: value?.direction === 'desc' ? 'desc' : 'asc',
  }
}
export const precise = (n: number) =>
  Number.isFinite(n)
    ? n.toLocaleString('en-US', { maximumFractionDigits: 8 })
    : 'Unavailable'
/** A shelf preference cannot relabel saved stock without a verified conversion. */
export function pantryDisplayUnit(i: Item) {
  const unit = i.storageUnit || i.unit
  try {
    convert(1, unit, i.unit, i.conversions)
    return { unit, warning: '' }
  } catch (error) {
    // Only a missing shelf relationship has a valid saved-unit presentation.
    // Invalid units, conflicting conversions and other errors still propagate.
    if (
      !(error instanceof Error) ||
      error.message !==
        `A verified unit conversion from ${unit} to ${i.unit} is required.`
    )
      throw error
    return {
      unit: i.unit,
      warning: `${error.message} Showing saved quantities and costs in ${i.unit}.`,
    }
  }
}
export function stockStatus(i: Item) {
  const today = new Date().toISOString().slice(0, 10)
  const expires = supportsExpiry(i) && i.expires
  return expires && expires < today
    ? 'Expired'
    : i.trackInventory === false
      ? 'Not tracked'
      : i.quantity <= 0
        ? 'Out of stock'
        : i.quantity <= i.threshold
          ? 'Low stock'
          : expires &&
              expires <=
                new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
            ? 'Expiring soon'
            : 'In stock'
}
export function sortIngredients(items: Item[], sort: PantrySort) {
  const measurement = ['quantity', 'threshold', 'currentCost'].includes(
    sort.key,
  )
  function value(i: Item): string | number | null {
    if (sort.key === 'value')
      return i.quantity != null &&
        i.cost != null &&
        Number.isFinite(i.quantity * i.cost)
        ? i.quantity * i.cost
        : null
    if (sort.key === 'status') return stockStatus(i)
    if (measurement) {
      const registry = ingredientUnits(i.conversions),
        u = registry[i.unit]
      const base = { weight: 'g', volume: 'ml', count: 'each', length: 'm' }[
        u?.category as 'weight' | 'volume' | 'count' | 'length'
      ]
      try {
        const raw =
          sort.key === 'currentCost' ? (i.currentCost ?? i.cost) : i[sort.key]
        if (
          raw === '' ||
          raw === null ||
          raw === undefined ||
          !Number.isFinite(Number(raw))
        )
          return null
        return sort.key === 'currentCost'
          ? Number(raw) * convert(1, base, i.unit, i.conversions)
          : convert(Number(raw), i.unit, base, i.conversions)
      } catch {
        return null
      }
    }
    return i[sort.key] ? String(i[sort.key]) : null
  }
  return [...items].sort((a, b) => {
    const av = value(a),
      bv = value(b)
    if (av === null || bv === null)
      return av === bv ? a.name.localeCompare(b.name) : av === null ? 1 : -1
    if (measurement) {
      const groups = ['weight', 'volume', 'length', 'count']
      const group = (i: Item) =>
        groups.indexOf(ingredientUnits(i.conversions)[i.unit]?.category)
      if (group(a) !== group(b)) return group(a) - group(b)
    }
    const cmp =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true })
    return (
      (sort.direction === 'desc' ? -cmp : cmp) || a.name.localeCompare(b.name)
    )
  })
}
export function hasPurchasePackage(value: any) {
  const quantity = value.purchaseQuantity ?? value.packageQuantity
  return (
    quantity !== '' &&
    quantity != null &&
    Number.isFinite(parseQuantity(quantity)) &&
    parseQuantity(quantity) > 0 &&
    value.packagePrice !== '' &&
    value.packagePrice != null &&
    Number.isFinite(Number(value.packagePrice)) &&
    Number(value.packagePrice) >= 0 &&
    !!value.purchaseUnit
  )
}
function positivePackageQuantity(value: unknown) {
  const quantity = parseQuantity(value)
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error('Enter a package quantity greater than zero.')
  return quantity
}
export function packageCost(i: Item, offer: any = i) {
  const q = positivePackageQuantity(
    offer.purchaseQuantity ?? offer.packageQuantity,
  )
  if (
    offer.packagePrice === '' ||
    offer.packagePrice === null ||
    offer.packagePrice === undefined
  )
    throw new Error('Enter a package price.')
  const price = number(offer.packagePrice, 'Package price')
  const storage = i.storageUnit || i.unit
  const contents = convert(q, offer.purchaseUnit, storage, i.conversions)
  if (contents <= 0) throw new Error('Package contents must be positive.')
  return {
    contents,
    unit: storage,
    unitCost: price / contents,
    baseCost: price / convert(q, offer.purchaseUnit, i.unit, i.conversions),
  }
}
export function compareOffer(
  i: Item,
  offer: any,
): {
  contents: number
  unit: string
  unitCost: number
  baseCost: number
  warning?: string
  difference?: number
  percent?: number
  equivalent?: number
} {
  const alt = packageCost(i, offer)
  if (!hasPurchasePackage(i) || !(i.packagePrice > 0))
    return { ...alt, warning: 'Add a reference price to compare.' }
  if (
    [
      offer.includesTax,
      offer.includesShipping,
      i.includesTax,
      i.includesShipping,
    ].some((v) => typeof v !== 'boolean')
  )
    return {
      ...alt,
      warning:
        'Confirm tax and shipping inclusion for both prices before comparing.',
    }
  if (
    (offer.currency || 'USD') !== (i.currency || 'USD') ||
    (offer.includesTax ?? null) !== (i.includesTax ?? null) ||
    (offer.includesShipping ?? null) !== (i.includesShipping ?? null)
  )
    return {
      ...alt,
      warning:
        'Use the same currency and tax/shipping inclusion basis to compare.',
    }
  if (!hasPurchasePackage(i) || !(i.packagePrice > 0))
    return { ...alt, warning: 'Add a reference price to compare.' }
  const ref = packageCost(i),
    delta = alt.unitCost - ref.unitCost,
    difference =
      Math.abs(delta) <=
      Number.EPSILON *
        Math.max(1, Math.abs(alt.unitCost), Math.abs(ref.unitCost)) *
        4
        ? 0
        : delta
  return {
    ...alt,
    difference,
    percent: (difference / ref.unitCost) * 100,
    equivalent: difference * ref.contents,
  }
}
export function duplicateBarcodes(
  ingredients: Item[],
  barcode: string,
  ownId?: string,
  offerId?: string,
) {
  if (!barcode.trim()) return []
  try {
    return [
      ...new Set(
        barcodeMatches(ingredients, barcode)
          .filter(({ item, offer }) =>
            offer
              ? !(item.id === ownId && offer.id === offerId)
              : item.id !== ownId,
          )
          .map(({ item }) => item.name),
      ),
    ]
  } catch {
    return []
  }
}

const textFields = [
  'name',
  'brand',
  'category',
  'vendor',
  'imageAssetId',
  'barcode',
  'barcodeFormat',
  'sku',
  'storageLocation',
  'notes',
  'statement',
  'subingredients',
  'recipeUnit',
  ...inventoryProductKeys,
  'retailerSku',
  'sourceContains',
  'sourceMayContain',
  'productSourceUrl',
  'productRequestedUrl',
  'productCheckedAt',
  'packageSize',
  'productSourcePackageSize',
]
export function updateIngredient(
  existing: Item,
  input: any,
  options: { hasStockHistory: boolean } = { hasStockHistory: true },
) {
  const basis = prepareStockUnitBasis(existing, input, options.hasStockHistory)
  input = applyPurchaseSetup(existing, basis.input)
  const next = { ...existing }
  for (const key of ['purchaseSetup', 'legacyPurchaseBasis'])
    if (input[key] !== undefined) next[key] = input[key]
  if (input.catalogSource !== undefined)
    next.catalogSource = input.catalogSource
  if (input.listedOnlinePrice !== undefined)
    next.listedOnlinePrice = number(
      input.listedOnlinePrice,
      'Listed online price',
    )
  for (const key of textFields)
    if (input[key] !== undefined) next[key] = String(input[key]).trim()
  if (input.packCount !== undefined) {
    next.packCount = number(input.packCount, 'Pack count', 1)
    if (!Number.isSafeInteger(next.packCount))
      throw new Error('Pack count must be a positive whole number.')
  }
  if (String(next.packageSize || '').length > 200)
    throw new Error('Use at most 200 characters for the source package size.')
  if (input.categoryId)
    Object.assign(
      next,
      selectPantryCategory(next, String(input.categoryId), true),
    )
  if (!next.name)
    throw new Error(
      isPackaging(next)
        ? 'Packaging name is required.'
        : 'Ingredient name is required.',
    )
  if (next.barcode) next.barcode = barcodeText(next.barcode)
  if (next.barcodeFormat && !scanFormats.includes(next.barcodeFormat))
    throw new Error('Unsupported barcode format.')
  next.storageUnit = String(
    input.storageUnit || existing.storageUnit || existing.unit,
  )
  // A new canonical basis requires explicit confirmation and server-verified empty history.
  next.unit = basis.unit
  next.conversions = input.conversions ?? existing.conversions ?? []
  if (!Array.isArray(next.conversions) || next.conversions.length > 100)
    throw new Error('Use at most 100 conversions.')
  if (
    JSON.stringify(next.conversions) !==
    JSON.stringify(existing.conversions || [])
  )
    validateConversions(next.conversions)
  for (const c of next.conversions)
    if (c.verified) {
      number(c.amountFrom, 'Conversion quantity', 0.000001)
      number(c.amountTo, 'Conversion quantity', 0.000001)
      if (
        !ingredientUnits(next.conversions)[c.from] ||
        !ingredientUnits(next.conversions)[c.to]
      )
        throw new Error('Choose supported conversion units.')
    }
  convert(1, next.unit, next.storageUnit, next.conversions)
  // A missing recipe conversion is visible in the editor and still blocks recipe costing.
  if (next.recipeUnit && !ingredientUnits(next.conversions)[next.recipeUnit])
    throw new Error('Choose a supported recipe unit.')
  const quantity =
    input.purchaseQuantity ??
    existing.purchaseQuantity ??
    existing.packageQuantity
  const price = input.packagePrice ?? existing.packagePrice
  const empty = (value: any) =>
    value === '' || value === null || value === undefined
  const preserveMissingPackage =
    !hasPurchasePackage(existing) && empty(quantity) && empty(price)
  if (!preserveMissingPackage) {
    next.purchaseQuantity = positivePackageQuantity(quantity)
    next.purchaseUnit = String(
      input.purchaseUnit || existing.purchaseUnit || '',
    )
    if (empty(price)) throw new Error('Enter a total package price.')
    next.packagePrice = number(price, 'Package price')
  }
  next.currency = String(
    input.currency || existing.currency || 'USD',
  ).toUpperCase()
  if (!/^[A-Z]{3}$/.test(next.currency))
    throw new Error('Use a three-letter currency code.')
  for (const key of ['includesTax', 'includesShipping'])
    next[key] =
      input[key] === undefined
        ? existing[key]
        : typeof input[key] === 'boolean'
          ? input[key]
          : null
  next.referenceVendor = existing.referenceVendor || existing.vendor || ''
  if (!preserveMissingPackage) {
    const calculated = packageCost(next).baseCost
    const referenceChanged =
      next.purchaseQuantity !==
        parseQuantity(existing.purchaseQuantity ?? existing.packageQuantity) ||
      next.purchaseUnit !== existing.purchaseUnit ||
      next.packagePrice !== Number(existing.packagePrice) ||
      JSON.stringify(next.conversions) !==
        JSON.stringify(existing.conversions || [])
    if (
      referenceChanged ||
      basis.changed ||
      next.needsCostSetup ||
      next.currentCost == null
    ) {
      next.currentCost = calculated
    }
    next.needsCostSetup = false
    if (basis.changed) next.cost = calculated
  }
  if (basis.changed && preserveMissingPackage)
    throw new Error(
      'Enter verified package contents and price before changing the stock basis.',
    )
  if (input.threshold === '' || input.reorderQuantity === '')
    throw new Error(
      'Re-enter reorder threshold and quantity in the selected stock shelf unit.',
    )
  next.threshold = convert(
    number(input.threshold, 'Reorder threshold'),
    next.storageUnit,
    next.unit,
    next.conversions,
  )
  next.reorderQuantity = convert(
    number(input.reorderQuantity ?? 0, 'Reorder quantity'),
    next.storageUnit,
    next.unit,
    next.conversions,
  )
  if (
    Array.isArray(input.allergens) &&
    JSON.stringify(input.allergens) !== JSON.stringify(existing.allergens || [])
  )
    next.allergens = input.allergens.filter((a: string) =>
      allergens.includes(a),
    )
  next.reviewed =
    input.reviewed === undefined ? existing.reviewed : input.reviewed === true
  if (input.purchaseOffers !== undefined)
    throw new Error('Use store offer actions to update prices.')
  const changed = [
    'packagePrice',
    'purchaseQuantity',
    'purchaseUnit',
    'currentCost',
  ].some((k) => next[k] !== existing[k])
  if (changed) next.referenceOfferId = null
  if (changed)
    next.costReferenceHistory = [
      ...(existing.costReferenceHistory || []),
      {
        date: new Date().toISOString(),
        packagePrice: existing.packagePrice,
        purchaseQuantity: existing.purchaseQuantity,
        purchaseUnit: existing.purchaseUnit,
        currentCost: existing.currentCost ?? existing.cost,
        reason: 'Reference price changed; inventory valuation unchanged',
      },
    ]
  return next
}
export function validateOffer(i: Item, data: any, vendors: Item[]) {
  const vendor = vendors.find((v) => v.id === data.vendorId)
  if (!vendor) throw new Error('Choose a vendor in this oven.')
  const offer: any = {
    id: String(data.id),
    vendorId: vendor.id,
    vendor: vendor.name,
    ingredientId: i.id,
    source: 'manual',
  }
  for (const key of [
    'brand',
    'barcode',
    'productUrl',
    'notes',
    'subingredients',
  ])
    offer[key] = String(data[key] || '').trim()
  if (offer.barcode) offer.barcode = barcodeText(offer.barcode)
  if (data.barcodeFormat && !scanFormats.includes(data.barcodeFormat))
    throw new Error('Unsupported barcode format.')
  offer.barcodeFormat = data.barcodeFormat || undefined
  offer.purchaseQuantity = positivePackageQuantity(data.purchaseQuantity)
  offer.purchaseUnit = String(data.purchaseUnit)
  if (data.packagePrice === '') throw new Error('Enter a package price.')
  offer.packagePrice = number(data.packagePrice, 'Package price')
  offer.currency = String(data.currency || 'USD').toUpperCase()
  if (!/^[A-Z]{3}$/.test(offer.currency))
    throw new Error('Use a three-letter currency code.')
  offer.priceCheckedAt = validateDate(data.priceCheckedAt)
  if (data.offerExpiresAt)
    offer.offerExpiresAt = validateDate(data.offerExpiresAt)
  if (offer.productUrl && !/^https?:\/\//i.test(offer.productUrl))
    throw new Error('Use an http or https product URL.')
  for (const key of ['includesTax', 'includesShipping'])
    offer[key] = typeof data[key] === 'boolean' ? data[key] : null
  offer.allergens = (
    Array.isArray(data.allergens) ? data.allergens : []
  ).filter((a: string) => allergens.includes(a))
  // An offer can be recorded with a missing conversion, but cannot become the reference.
  if (!ingredientUnits(i.conversions)[offer.purchaseUnit])
    throw new Error('Choose a supported purchase unit.')
  return offer
}

export function affectedRecipes(
  ingredientId: string,
  ingredients: Item[],
  recipes: Item[],
) {
  const ids = new Set([ingredientId]),
    affected = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const r of recipes)
      if (
        !affected.has(r.id) &&
        effectiveRecipeLines(r, recipes).some((l: any) =>
          ids.has(l.ingredientId),
        )
      ) {
        affected.add(r.id)
        changed = true
        for (const i of ingredients)
          if (i.compoundRecipeId === r.id) ids.add(i.id)
      }
  }
  return recipes.filter((r) => affected.has(r.id))
}
