import {
  convert,
  ingredientUnits,
  number,
  parseQuantity,
  type Item,
} from './domain'

export type PurchaseSetup = {
  packageUnit: string
  price: number | string
  stockUnits: number | string
}
export type SavedConversion = {
  from: string
  to: string
  amountFrom: number | string
  amountTo: number | string
  verified?: boolean
  [key: string]: unknown
}
const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))

/** Validate every graph edge, including alternate paths bypassed by convert's direct lookup. */
export function validateConversions(conversions: SavedConversion[]) {
  if (!Array.isArray(conversions) || conversions.length > 100)
    throw new Error('Use at most 100 conversions.')
  const registry = ingredientUnits(conversions),
    accepted: SavedConversion[] = [],
    pairs = new Set<string>()
  for (const c of conversions) {
    if (!c.verified) continue
    const x = number(c.amountFrom, 'Conversion quantity', 0.000001),
      y = number(c.amountTo, 'Conversion quantity', 0.000001)
    if (!registry[c.from] || !registry[c.to])
      throw new Error('Choose supported conversion units.')
    const pair = [c.from, c.to].sort().join('|')
    if (pairs.has(pair))
      throw new Error(
        `Duplicate conversion for ${c.from} and ${c.to}. Review the saved relationships.`,
      )
    pairs.add(pair)
    let expected: number | undefined
    try {
      expected = convert(x, c.from, c.to, accepted)
    } catch {
      /* An explicit new relationship is allowed. */
    }
    if (expected !== undefined) {
      if (!close(expected, y))
        throw new Error(
          `Conflicting conversion: ${c.from} to ${c.to}. Review the saved relationships.`,
        )
      throw new Error(
        `Duplicate conversion: ${c.from} to ${c.to} is already supported automatically or by saved relationships.`,
      )
    }
    accepted.push(c)
  }
}

export function purchaseSetupView(i: Item): {
  setup: PurchaseSetup
  review?: string
} {
  if (
    i.purchaseSetup &&
    i.purchaseSetup.packageUnit === i.purchaseUnit &&
    Number(i.purchaseSetup.price) ===
      Number(i.packagePrice) /
        parseQuantity(i.purchaseQuantity ?? i.packageQuantity)
  ) {
    let stockUnits: number | string = ''
    try {
      stockUnits = convert(
        1,
        i.purchaseUnit,
        i.storageUnit || i.unit,
        i.conversions,
      )
    } catch {
      /* review below */
    }
    if (stockUnits !== '') return { setup: { ...i.purchaseSetup, stockUnits } }
  }
  const q = parseQuantity(i.purchaseQuantity ?? i.packageQuantity),
    p = Number(i.packagePrice)
  const blank: PurchaseSetup = { packageUnit: '', price: '', stockUnits: '' }
  if (
    !(q > 0) ||
    i.packagePrice == null ||
    i.packagePrice === '' ||
    !Number.isFinite(p)
  )
    return {
      setup: blank,
      review:
        'Choose the package and enter its price and contents. Existing purchase details remain unchanged until confirmed.',
    }
  const registry = ingredientUnits(i.conversions),
    u = registry[i.purchaseUnit]
  if (
    !u ||
    (u.factor > 0 && u.category !== 'count' && q !== 1) ||
    (q > 1 &&
      (i.conversions || []).some(
        (c: SavedConversion) =>
          c.verified &&
          c.from === i.purchaseUnit &&
          parseQuantity(c.amountFrom) === 1 &&
          parseQuantity(c.amountTo) === q,
      ))
  )
    return {
      setup: blank,
      review: `Review the saved purchase basis: ${q} ${i.purchaseUnit} for ${p}. The physical package grouping is unknown; enter one package explicitly.`,
    }
  try {
    return {
      setup: {
        packageUnit: i.purchaseUnit,
        price: p / q,
        stockUnits: convert(
          1,
          i.purchaseUnit,
          i.storageUnit || i.unit,
          i.conversions,
        ),
      },
    }
  } catch {
    return {
      setup: { ...blank, packageUnit: i.purchaseUnit, price: p / q },
      review:
        'Package contents need a verified relationship. Review one package before saving.',
    }
  }
}

/** Presentation adapter only. Never changes canonical stock, valuation or posted history. */
export function applyPurchaseSetup(
  existing: Item,
  input: Record<string, Item[string]>,
) {
  input = { ...input, legacyPurchaseBasis: existing.legacyPurchaseBasis }
  if (!input.purchaseSetup) return input
  const view = purchaseSetupView(existing),
    s = input.purchaseSetup as PurchaseSetup
  const storage = input.storageUnit || existing.storageUnit || existing.unit
  if (
    view.review &&
    !s.packageUnit &&
    s.price === '' &&
    s.stockUnits === '' &&
    !input.purchaseSetupConfirmed
  )
    return { ...input, purchaseSetup: undefined }
  const unchanged =
    !view.review &&
    s.packageUnit === view.setup.packageUnit &&
    Number(s.price) === Number(view.setup.price) &&
    Number(s.stockUnits) === Number(view.setup.stockUnits) &&
    storage === (existing.storageUnit || existing.unit)
  if (
    unchanged &&
    JSON.stringify(input.conversions ?? existing.conversions ?? []) !==
      JSON.stringify(existing.conversions || [])
  ) {
    validateConversions(input.conversions)
    if (
      !close(
        convert(1, s.packageUnit, storage, input.conversions),
        Number(s.stockUnits),
      )
    )
      throw new Error(
        'The primary relationship must be edited in Details & Costing.',
      )
  }
  if (unchanged)
    return {
      ...input,
      purchaseQuantity: existing.purchaseQuantity ?? existing.packageQuantity,
      purchaseUnit: existing.purchaseUnit,
      packagePrice: existing.packagePrice,
      purchaseSetup: {
        ...s,
        price: Number(s.price),
        stockUnits: Number(s.stockUnits),
      },
    }
  if (view.review && !input.purchaseSetupConfirmed)
    throw new Error(
      'Confirm the reviewed one-package setup before replacing the saved purchase basis.',
    )
  const registry = ingredientUnits(input.conversions ?? existing.conversions)
  if (!registry[s.packageUnit] || !registry[storage])
    throw new Error('Choose purchasing package and stock shelf units.')
  if (s.price === '' || s.stockUnits === '')
    throw new Error(
      'Enter the price and stock units for one purchasing package.',
    )
  const price = number(s.price, 'Purchasing price'),
    stockUnits = number(s.stockUnits, 'Stock units per package', 0.000001)
  if (s.packageUnit === storage && stockUnits !== 1)
    throw new Error(
      'Matching package and stock units must contain exactly 1 stock unit.',
    )
  let conversions = [...(input.conversions ?? existing.conversions ?? [])]
  // The direct primary relationship has exactly one editor: Details & Costing.
  conversions = conversions.filter(
    (c: SavedConversion) =>
      !(
        (c.from === s.packageUnit && c.to === storage) ||
        (c.to === s.packageUnit && c.from === storage)
      ),
  )
  let automatic: number | undefined
  try {
    automatic = convert(1, s.packageUnit, storage, conversions)
  } catch {
    /* explicit package contents */
  }
  if (automatic !== undefined && !close(automatic, stockUnits))
    throw new Error(
      'Package contents conflict with an existing or standard conversion. Review Unit Conversions first.',
    )
  if (s.packageUnit !== storage && automatic === undefined)
    conversions.push({
      from: s.packageUnit,
      to: storage,
      amountFrom: 1,
      amountTo: stockUnits,
      verified: true,
      source: 'user_entered',
      primaryPurchase: true,
    })
  validateConversions(conversions)
  const incomingCount = parseQuantity(
    input.purchaseQuantity ?? input.packageQuantity,
  )
  const keepIncomingBasis =
    incomingCount > 0 &&
    input.purchaseUnit === s.packageUnit &&
    Number(input.packagePrice) / incomingCount === price
  return {
    ...input,
    purchaseSetup: { packageUnit: s.packageUnit, price, stockUnits },
    conversions,
    purchaseQuantity: keepIncomingBasis ? incomingCount : 1,
    purchaseUnit: s.packageUnit,
    packagePrice: keepIncomingBasis ? Number(input.packagePrice) : price,
    legacyPurchaseBasis: existing.legacyPurchaseBasis || {
      purchaseQuantity: existing.purchaseQuantity ?? existing.packageQuantity,
      purchaseUnit: existing.purchaseUnit,
      packagePrice: existing.packagePrice,
      conversions: existing.conversions || [],
    },
  }
}
