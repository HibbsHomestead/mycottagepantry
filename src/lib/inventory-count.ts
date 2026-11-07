import type { Item } from './domain'
import { convert, parseQuantity } from './domain'
export function countQuantity(raw: unknown, unit: string, item: Item) {
  if (
    raw === '' ||
    raw == null ||
    !Number.isFinite(parseQuantity(raw)) ||
    parseQuantity(raw) < 0
  )
    throw new Error(
      'Enter the actual quantity on hand, including partial units.',
    )
  if (item.trackInventory === false)
    throw new Error('Enable stock tracking before counting this item.')
  const quantity = convert(
    parseQuantity(raw),
    unit,
    item.unit,
    item.conversions,
  )
  if (!Number.isFinite(quantity) || quantity < 0)
    throw new Error('A verified unit conversion is required.')
  return quantity
}
export function assertCountUnchanged(
  lines: Item[],
  items: Item[],
  revision: (item: Item) => string,
) {
  for (const line of lines) {
    const item = items.find((i) => i.id === line.ingredientId)
    if (!item || revision(item) !== line.inventoryRevision)
      throw new Error(
        'Stock moved during this count. Refresh, review movement history and recount affected items before applying adjustments.',
      )
  }
}
