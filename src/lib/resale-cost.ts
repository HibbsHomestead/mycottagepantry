import type { Item, Workspace } from './domain'

const amount = (v: unknown): number | undefined =>
  v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0
    ? Number(v)
    : undefined

/** Defaults are estimates only. They never change inventory valuation or receipts. */
export function purchaseEstimate(product: Item) {
  const defaults = product.purchaseDefaults
  const price = amount(defaults?.packPrice)
  const count = amount(defaults?.itemsPerPack)
  return price !== undefined && count !== undefined && count > 0
    ? price / count
    : undefined
}
export function resaleCostBasis(product: Item) {
  const received = amount(product.cost)
  if (product.stockCostKnown === true && received !== undefined)
    return {
      cost: received,
      label: product.stockEntry?.costEstimated
        ? 'Estimated inventory cost'
        : 'Average inventory cost',
    }
  const estimated = purchaseEstimate(product)
  if (estimated !== undefined)
    return { cost: estimated, label: 'Estimated cost' }
  return { cost: undefined, label: 'Purchase cost not recorded' }
}

/** Explain recorded evidence without guessing allocations or deriving units from titles. */
export function resaleCostEvidence(product: Item, workspace: Workspace) {
  const receipts = (workspace.ledger || []).filter(
    (row) => row.productId === product.id && row.type === 'purchase_receipt',
  )
  const entry = product.stockEntry
  return {
    receipts,
    entry,
    basis: resaleCostBasis(product),
    lastUnitCost: amount(product.lastReceivedUnitCost),
  }
}
export function validatePurchaseDefaults(value: unknown) {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Review purchase defaults.')
  const v = value as Record<string, unknown>
  const price = amount(v.packPrice)
  const count = amount(v.itemsPerPack)
  if (
    price === undefined ||
    count === undefined ||
    !Number.isSafeInteger(count) ||
    count < 1
  )
    throw new Error(
      'Enter a non-negative purchase pack price and a whole sellable item count of at least one.',
    )
  const unit = String(v.unit || 'pack')
  if (
    !['each', 'pack', 'case', 'box'].includes(unit) ||
    (unit === 'each' && count !== 1)
  )
    throw new Error('Each contains one sellable item.')
  return { packPrice: price, itemsPerPack: count, unit }
}
