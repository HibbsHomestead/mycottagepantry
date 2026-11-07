import { convert, parseQuantity, type Item } from './domain'

export type InventoryAdjustmentInput = {
  quantity?: unknown
  unit?: string
  adjustmentMode?: string
}

/** Quantities and costs on the ingredient remain in their original ledger unit. */
export function inventoryAdjustmentPlan(
  item: Item,
  data: InventoryAdjustmentInput,
) {
  const mode = data.adjustmentMode ?? 'change'
  if (!['change', 'total'].includes(mode))
    throw new Error('Choose quantity change or opening count / set total.')
  if (item.trackInventory === false)
    throw new Error('Enable stock tracking before adjusting this item.')
  if (data.quantity === '' || data.quantity == null)
    throw new Error('Enter a quantity.')
  const enteredQuantity = parseQuantity(data.quantity)
  if (!Number.isFinite(enteredQuantity))
    throw new Error('Enter a valid quantity.')
  if (mode === 'total' && enteredQuantity < 0)
    throw new Error('The total on hand cannot be negative.')
  if (mode === 'change' && enteredQuantity === 0)
    throw new Error('Enter a non-zero quantity change.')
  const inventoryUnit = item.storageUnit || item.unit
  // Only legacy quantity-change requests may omit the unit: those used the ledger unit.
  const enteredUnit = data.unit || (mode === 'change' ? item.unit : '')
  if (!enteredUnit || !inventoryUnit || !item.unit)
    throw new Error('A saved inventory unit is required.')
  const previousQuantity = Number(item.quantity)
  if (
    item.quantity == null ||
    item.quantity === '' ||
    !Number.isFinite(previousQuantity)
  )
    throw new Error(
      'The current stock balance is unavailable. Refresh before adjusting.',
    )
  const normalized =
    Math.sign(enteredQuantity) *
    convert(Math.abs(enteredQuantity), enteredUnit, item.unit, item.conversions)
  const resultingQuantity =
    mode === 'total' ? normalized : previousQuantity + normalized
  const change = mode === 'total' ? normalized - previousQuantity : normalized
  if (!Number.isFinite(resultingQuantity) || !Number.isFinite(change))
    throw new Error('The stock quantity is too large.')
  if (resultingQuantity < 0)
    throw new Error(
      'Insufficient stock. Reduce the adjustment or receive stock first.',
    )
  // Never relabel canonical quantities. A cross-category display needs a saved conversion.
  return {
    mode,
    enteredQuantity,
    enteredUnit,
    previousQuantity,
    resultingQuantity,
    change,
    inventoryUnit,
    inventoryQuantity:
      Math.sign(change) *
      convert(Math.abs(change), item.unit, inventoryUnit, item.conversions),
    previousInventoryQuantity: convert(
      previousQuantity,
      item.unit,
      inventoryUnit,
      item.conversions,
    ),
    resultingInventoryQuantity: convert(
      resultingQuantity,
      item.unit,
      inventoryUnit,
      item.conversions,
    ),
  }
}

/** Use a saved posting-time display snapshot; never reinterpret old ledger entries. */
export function inventoryMovementView(entry: Item): Item {
  if (
    entry.inventoryUnit &&
    typeof entry.inventoryQuantity === 'number' &&
    Number.isFinite(entry.inventoryQuantity)
  )
    return {
      ...entry,
      quantity: entry.inventoryQuantity,
      unit: entry.inventoryUnit,
    }
  return entry
}
