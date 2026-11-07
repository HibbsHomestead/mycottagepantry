import { roundMoney, type Item, type Workspace } from './domain'

/**
 * Resale starting stock: one sellable unit is defined first, and every count,
 * cost and preview is expressed in that unit. The same pure calculation runs
 * in the browser (preview) and on the server (authoritative posting).
 */
export const sellUnitOptions = [
  ['bottle', 'Individual bottle', 'bottle', 'bottles'],
  ['item', 'Individual item', 'item', 'items'],
  ['jar', 'Individual jar', 'jar', 'jars'],
  ['can', 'Individual can', 'can', 'cans'],
  ['bag', 'Individual bag', 'bag', 'bags'],
  ['bar', 'Individual bar', 'bar', 'bars'],
  ['sealed pack', 'Sealed pack (sold unopened)', 'sealed pack', 'sealed packs'],
  ['other', 'Other unit…', '', ''],
] as const
export type StockChoice = 'none' | 'existing' | 'purchase'
export const stockChoices: [StockChoice, string, string][] = [
  ['none', 'No stock yet', 'Create the item now and add stock later.'],
  [
    'existing',
    'Enter items I already have',
    'Adds stock you already own without recording a new purchase.',
  ],
  [
    'purchase',
    'Record a new purchase',
    'Adds stock you just bought and records what you paid.',
  ],
]
export const resalePurchaseUnits = ['each', 'pack', 'case', 'box', 'bundle']

export function sellUnitNames(data: Item) {
  const key = data.sellUnit || 'item'
  const known = sellUnitOptions.find(([k]) => k === key)
  if (key === 'other' || !known) {
    const singular = String(data.sellUnitLabel || '').trim()
    const plural = String(data.sellUnitPlural || '').trim()
    return {
      singular: singular || 'item',
      plural: plural || (singular ? singular + 's' : 'items'),
    }
  }
  return { singular: known[2], plural: known[3] }
}
export const unitWord = (
  names: { singular: string; plural: string },
  n: number,
) => (n === 1 ? names.singular : names.plural)

function present(v: unknown) {
  return v !== '' && v != null
}
function num(v: unknown, label: string, min = 0) {
  const n = Number(v)
  if (!present(v) || !Number.isFinite(n) || n < min)
    throw new Error(`Enter ${label}.`)
  return n
}
function whole(v: unknown, label: string, min = 0) {
  const n = num(v, label, min)
  if (!Number.isSafeInteger(n))
    throw new Error(
      `${label[0].toUpperCase() + label.slice(1)} must be a whole number.`,
    )
  return n
}

export type ResaleStockPlan = {
  choice: StockChoice
  quantity: number
  totalCost: number
  unitCost: number
  costBasis: string
  costEstimated: boolean
  names: { singular: string; plural: string }
  /** Normalized entry stored on the item and ledger; only active-method fields. */
  entry: Record<string, Item[string]>
}

/** Throws a plain-language error when the active choice is incomplete. */
export function resaleStockPlan(data: Item): ResaleStockPlan {
  const choice = (data.stockChoice || 'none') as StockChoice
  if (!['none', 'existing', 'purchase'].includes(choice))
    throw new Error('Choose how to add stock.')
  if (choice !== 'none' && !data.sellUnit)
    throw new Error('Choose the sellable unit for this item first.')
  const key = data.sellUnit || 'item'
  if (!sellUnitOptions.some(([k]) => k === key))
    throw new Error('Choose a supported sellable unit.')
  if (key === 'other' && !String(data.sellUnitLabel || '').trim())
    throw new Error('Enter the sellable unit name.')
  const names = sellUnitNames({ ...data, sellUnit: key })
  const base = {
    choice,
    sellUnit: key,
    sellUnitSingular: names.singular,
    sellUnitPlural: names.plural,
    ...(present(data.packContents)
      ? { packContents: String(data.packContents).slice(0, 120) }
      : {}),
  }
  if (choice === 'none')
    return {
      choice,
      quantity: 0,
      totalCost: 0,
      unitCost: 0,
      costBasis: '',
      costEstimated: false,
      names,
      entry: base,
    }
  let quantity: number,
    packs = 0,
    perPack = 0
  const entry: Record<string, Item[string]> = { ...base }
  if (choice === 'existing') {
    const method = data.countMethod === 'packs' ? 'packs' : 'direct'
    entry.countMethod = method
    if (method === 'direct') {
      quantity = whole(
        data.startingCount,
        `how many ${names.plural} you currently have`,
        1,
      )
      entry.startingCount = quantity
    } else {
      packs = whole(data.packCount, 'the number of packs/cases', 0)
      perPack = whole(data.unitsPerPack, `${names.plural} per pack/case`, 1)
      const loose = present(data.looseUnits)
        ? whole(data.looseUnits, `loose ${names.plural}`, 0)
        : 0
      quantity = packs * perPack + loose
      if (quantity < 1)
        throw new Error(`Starting stock must be at least 1 ${names.singular}.`)
      Object.assign(entry, {
        packCount: packs,
        unitsPerPack: perPack,
        looseUnits: loose,
      })
    }
  } else {
    const unit = data.purchaseUnit || 'each'
    if (!resalePurchaseUnits.includes(unit))
      throw new Error('Choose a purchase unit.')
    packs = whole(data.purchaseQuantity, 'the quantity purchased', 1)
    if (unit === 'each') perPack = 1
    else {
      perPack = whole(data.itemsPerUnit, `${names.plural} in each ${unit}`, 1)
      if (data.packageContentsConfirmed !== true)
        throw new Error(`Confirm the ${names.plural} in each ${unit}.`)
    }
    quantity = packs * perPack
    Object.assign(entry, {
      purchaseQuantity: packs,
      purchaseUnit: unit,
      itemsPerUnit: perPack,
    })
  }
  if (!Number.isSafeInteger(quantity))
    throw new Error('Starting stock is too large.')
  const packBasis =
    (choice === 'existing' && entry.countMethod === 'packs') ||
    (choice === 'purchase' && entry.purchaseUnit !== 'each')
  const basis = data.costBasis || 'unit'
  if (basis === 'unknown')
    throw new Error(
      choice === 'purchase'
        ? 'Enter what you paid for this purchase.'
        : 'Starting stock needs an acquisition cost so inventory value and profit stay accurate. Enter your best estimate, or choose “No stock yet” and add stock once you know the cost.',
    )
  if (
    !['unit', 'total', 'pack'].includes(basis) ||
    (basis === 'pack' && !packBasis)
  )
    throw new Error('Choose how you are entering the cost.')
  if (basis === 'pack' && !packs)
    throw new Error(
      'Cost per pack/case needs at least one pack/case; use cost per unit or total cost instead.',
    )
  const amount = num(
    data.costAmount,
    'the acquisition cost (use 0 only if the stock was free)',
  )
  const totalCost = roundMoney(
    basis === 'total'
      ? amount
      : basis === 'unit'
        ? amount * quantity
        : choice === 'existing'
          ? amount * packs + (amount / perPack) * (quantity - packs * perPack)
          : amount * packs,
  )
  const costEstimated = choice === 'existing' && data.costEstimated === true
  Object.assign(entry, {
    quantity,
    costBasis: basis,
    costAmount: amount,
    totalCost,
    unitCost: totalCost / quantity,
    ...(costEstimated ? { costEstimated: true } : {}),
  })
  return {
    choice,
    quantity,
    totalCost,
    unitCost: totalCost / quantity,
    costBasis: basis,
    costEstimated,
    names,
    entry,
  }
}

export function resaleStockPreview(data: Item) {
  try {
    return { plan: resaleStockPlan(data), error: '' }
  } catch (e) {
    return { plan: null, error: (e as Error).message }
  }
}

/** “15 pack”, “12-ct”, “6 count”, “24pk” in a title describe package contents. */
export function titlePackSize(name: unknown) {
  const match = String(name || '').match(
    /\b(\d{1,4})\s*-?\s*(?:pack|pk|ct|count|pc|pcs|piece)\b/i,
  )
  const n = match ? Number(match[1]) : 0
  return n > 1 ? n : 0
}

export function stockUnitLabel(product: Item, n: number) {
  return unitWord(sellUnitNames(product.stockEntry || product), n)
}

/**
 * Flags resale stock whose count looks like pack contents were multiplied
 * twice (e.g. “15 pack” entered as 15 packs × 15). Proposals only; the owner
 * approves any correction through the audited stock-adjustment flow.
 */
export function suspiciousResaleCounts(w: Workspace) {
  const out: {
    product: Item
    reason: string
    current: number
    proposed: number
  }[] = []
  for (const p of w.products || []) {
    if (p.workflow !== 'resale' || p.trackInventory === false) continue
    const current = Number(p.quantity || 0)
    const size = titlePackSize(p.name)
    const q = Number(p.purchaseQuantity),
      per = Number(p.itemsPerUnit)
    if (
      !p.stockEntry &&
      p.purchaseUnit &&
      p.purchaseUnit !== 'each' &&
      q > 1 &&
      q === per &&
      current >= q * per
    )
      out.push({
        product: p,
        reason: `Recorded as ${q} ${p.purchaseUnit}s × ${per} each. The same number appears twice, which often means a count was multiplied again.`,
        current,
        proposed: current - q * per + q,
      })
    else if (
      !p.stockEntry &&
      size &&
      current >= size * size &&
      current % (size * size) === 0
    )
      out.push({
        product: p,
        reason: `The name mentions a ${size} pack and ${current} on hand is ${current / size} full packs. “${size} pack” describes what's inside one package, not how many you own.`,
        current,
        proposed: current / size,
      })
  }
  return out
}

const basisLabels: Record<string, string> = {
  unit: 'cost entered per unit',
  total: 'cost entered as a total',
  pack: 'cost entered per pack/case',
}
/** Human summary of a saved starting-stock entry, for reopening the item. */
export function stockEntrySummary(entry: Item[string]) {
  if (!entry || !entry.quantity) return ''
  const names = {
    singular: entry.sellUnitSingular || 'item',
    plural: entry.sellUnitPlural || 'items',
  }
  const total = `${entry.quantity} ${unitWord(names, entry.quantity)}`
  const how =
    entry.countMethod === 'packs'
      ? `${entry.packCount} × ${entry.unitsPerPack}${entry.looseUnits ? ` + ${entry.looseUnits} loose` : ''} = ${total}`
      : entry.choice === 'purchase' && entry.purchaseUnit !== 'each'
        ? `${entry.purchaseQuantity} ${entry.purchaseUnit} × ${entry.itemsPerUnit} = ${total}`
        : total
  return `${how} · ${basisLabels[entry.costBasis] || ''}${entry.costEstimated ? ' (estimate)' : ''}`
}
