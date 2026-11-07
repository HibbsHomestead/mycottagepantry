import { convert, parseQuantity, type Item, type Workspace } from './domain'
import { fabricReceipt, isFabric } from './fabric'
import { stockStatus } from './ingredients'

export type InventoryEntry = {
  key: string
  item: Item
  table: 'ingredients' | 'products'
  type: string
}
export const inventoryTypes = [
  ['ingredient', 'Ingredients'],
  ['packaging', 'Packaging'],
  ['material', 'Craft materials'],
  ['supply', 'Supplies'],
  ['resale', 'Resale'],
] as const
export function inventoryEntries(w: Workspace): InventoryEntry[] {
  return [
    ...w.ingredients.map((item) => ({
      key: `ingredients:${item.id}`,
      item,
      table: 'ingredients' as const,
      type: item.usedAs || 'ingredient',
    })),
    ...w.products
      .filter((i) => i.workflow === 'resale')
      .map((item) => ({
        key: `products:${item.id}`,
        item,
        table: 'products' as const,
        type: 'resale',
      })),
  ]
}
const display = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 3 })
const known = (n: unknown) =>
  n !== '' && n != null && Number.isFinite(Number(n))
export const inventoryLocation = (i: Item) =>
  String(i.storageLocation || i.location || '')
export const inventoryTypeLabel = (type: string) =>
  inventoryTypes.find(([key]) => key === type)?.[1] || type
export function inventoryStatus(i: Item) {
  const status = stockStatus(i)
  return status === 'In stock' && !known(i.quantity)
    ? 'Stock not recorded'
    : status
}
export function onHandText(i: Item) {
  if (i.trackInventory === false) return 'Stock not tracked'
  if (!known(i.quantity)) return 'Quantity not recorded'
  const base = i.workflow === 'resale' ? 'each' : i.unit,
    unit = i.workflow === 'resale' ? 'each' : i.storageUnit || i.unit
  if (!unit) return 'Stock unit not recorded'
  try {
    const q = convert(Number(i.quantity), base, unit, i.conversions)
    return `${q > 0 && q < 0.001 ? '<0.001' : display(q)} ${unit}${unit === 'each' ? '' : ' remaining'}`
  } catch {
    return `${display(Number(i.quantity))} ${base} · display conversion unavailable`
  }
}
export function packageText(i: Item) {
  if (i.workflow === 'resale')
    return known(i.itemsPerUnit) && i.itemsPerUnit > 0 && i.purchaseUnit
      ? `${display(Number(i.itemsPerUnit))} each / ${i.purchaseUnit}`
      : ''
  const q = parseQuantity(i.purchaseQuantity ?? i.packageQuantity)
  return Number.isFinite(q) && q > 0 && i.purchaseUnit
    ? `${display(q)} ${i.purchaseUnit} / purchase package`
    : ''
}
export function entryAction(
  entry: InventoryEntry,
  action: 'edit' | 'receive' | 'adjust',
) {
  if (entry.table === 'products')
    return action === 'receive'
      ? 'trade-receive'
      : action === 'adjust'
        ? 'trade-adjust'
        : 'trade-product'
  if (isFabric(entry.item)) return `fabric-${action}`
  return action === 'edit' ? 'ingredient-edit' : action
}
/** Display only; authoritative validation and stock posting remain in existing services. */
export function stockReceiptPreview(
  item: Item,
  quantity: unknown,
  unit: string,
  details?: Record<string, unknown>,
) {
  const amount = parseQuantity(quantity)
  if (!Number.isFinite(amount) || amount <= 0 || !unit || !known(item.quantity))
    return ''
  try {
    const base = item.workflow === 'resale' ? 'each' : item.unit,
      target =
        item.workflow === 'resale' ? 'each' : item.storageUnit || item.unit
    let added: number
    if (item.workflow === 'resale' && details) {
      const contents = Number(details.itemsPerUnit)
      if (
        !['each', 'pack', 'case', 'box'].includes(unit) ||
        !Number.isFinite(contents) ||
        contents <= 0 ||
        (unit === 'each' && contents !== 1)
      )
        return 'Confirm the sellable items per purchase unit before receiving.'
      added = amount * contents
    } else if (isFabric(item))
      added = convert(
        fabricReceipt(item, { ...details, quantity: amount, unit }),
        base,
        target,
      )
    else added = convert(amount, unit, target, item.conversions)
    const current = convert(
      Number(item.quantity),
      base,
      target,
      item.conversions,
    )
    return `${display(current + added)} ${target} after receiving (${display(added)} ${target} added)`
  } catch {
    return isFabric(item)
      ? 'Confirm the fabric unit and usable length per bolt/roll before receiving.'
      : 'A verified package conversion is required before receiving.'
  }
}
