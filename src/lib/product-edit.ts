import { barcodeText } from './barcodes'
import type { Item } from './domain'

/**
 * Creation-only request fields. Add Item stores these on new records, so an
 * editor that loads a stored record must remove them before Save; otherwise the
 * update would be mistaken for a repeated creation request.
 */
export const creationOnlyKeys = [
  'inventoryCreation',
  'initialDraft',
  'initialType',
  'stockChoice',
  'countMethod',
  'startingCount',
  'packCount',
  'unitsPerPack',
  'looseUnits',
  'costBasis',
  'costAmount',
  'costEstimated',
  'addPurchaseDetails',
  'initialStock',
  'stockAction',
  'packageContentsConfirmed',
  'referencePrice',
  'referenceQuantity',
  'existingProductId',
] as const

/**
 * Stock, cost-history and provenance fields that only explicit Receive Stock,
 * Adjust Stock, production or creation operations may change. Item editing
 * keeps the stored values, so saving details never posts or recalculates stock.
 */
export const stockHistoryKeys = [
  'quantity',
  'cost',
  'currentCost',
  'stockCostKnown',
  'needsCostSetup',
  'stockEntry',
  'purchaseCost',
  'lastReceivedUnitCost',
  'lastPurchaseDate',
  'purchaseQuantity',
  'purchaseUnit',
  'itemsPerUnit',
  'packagePrice',
  'receivedDate',
  'purchaseDate',
  'receiptReference',
  'sellUnit',
  'sellUnitLabel',
  'sellUnitPlural',
  'creationRequestId',
  'creationFingerprint',
  'createdBy',
  'workflow',
] as const

/** Draft for editing a stored product: same ID, no creation flags. */
export function productEditDraft(stored: Item): Item {
  const draft: Item = { ...stored }
  for (const key of creationOnlyKeys) delete draft[key]
  return draft
}

/** Server-side: rebuild an update from the stored record plus editable fields. */
export function preserveStoredProductFields(update: Item, stored: Item): Item {
  const item: Item = { ...update }
  for (const key of creationOnlyKeys) delete item[key]
  for (const key of stockHistoryKeys) {
    if (stored[key] === undefined) delete item[key]
    else item[key] = stored[key]
  }
  // The assigned label design changes only through explicit label assignment.
  if (update.labelAssignmentEdited !== true) {
    if (stored.labelDesignId) item.labelDesignId = stored.labelDesignId
    else delete item.labelDesignId
  }
  item.id = stored.id
  return item
}

const normalized = (key: 'sku' | 'barcode', value: unknown) => {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (key !== 'barcode') return text.toLowerCase()
  try {
    return barcodeText(text)
  } catch {
    return text
  }
}

export type ProductConflict = {
  field: 'sku' | 'barcode'
  label: string
  value: string
  other: Item
}

/**
 * Finds a genuine identity conflict with a DIFFERENT product. The record being
 * edited is excluded by ID, and an unchanged legacy value never blocks a save.
 */
export function productIdentityConflict(
  products: Item[],
  item: Item,
  previous?: Item,
): ProductConflict | null {
  for (const field of ['sku', 'barcode'] as const) {
    const value = normalized(field, item[field])
    if (!value) continue
    if (previous && normalized(field, previous[field]) === value) continue
    const other = products.find(
      (p) =>
        p.id !== item.id &&
        p.archived !== true &&
        normalized(field, p[field]) === value,
    )
    if (other)
      return {
        field,
        label: field === 'sku' ? 'SKU' : 'Barcode',
        value: String(item[field]).trim(),
        other,
      }
  }
  return null
}

export function conflictMessage(conflict: ProductConflict) {
  const name = `${conflict.other.name}${conflict.other.variant ? ` · ${conflict.other.variant}` : ''}`
  return `${conflict.label} “${conflict.value}” is already used by another product, “${name}”. Change the ${conflict.label} on this product, or open “${name}” to review it. Nothing was saved and your edits are still here.`
}
