import type { Item, Workspace } from './domain'
import { workflowOf } from './product-workflows'

export const deletableTables = ['ingredients', 'products', 'recipes'] as const
export type DeletableTable = (typeof deletableTables)[number]
export function itemType(table: DeletableTable, item: Item) {
  if (table === 'products')
    return item.workflow === 'kit' ? 'kit' : `${workflowOf(item)} product`
  if (table === 'recipes')
    return item.workflow === 'handmade' ? 'design / prep' : 'recipe / prep'
  return item.usedAs === 'packaging'
    ? 'packaging item'
    : item.usedAs === 'material'
      ? 'craft material'
      : item.usedAs === 'supply'
        ? 'supply'
        : 'ingredient'
}
// Exact stored references, including nested BOMs, kit components, snapshots and
// line arrays. Never match a name or substring of an ID.
export function referencesItem(value: unknown, id: string): boolean {
  if (value === id) return true
  if (Array.isArray(value)) return value.some((v) => referencesItem(v, id))
  return (
    !!value &&
    typeof value === 'object' &&
    Object.entries(value).some(([, child]) => referencesItem(child, id))
  )
}
export function itemDeletionBlockers(
  workspace: Workspace,
  table: DeletableTable,
  item: Item,
) {
  const blockers: string[] = []
  if (table !== 'recipes') {
    const stockFields = [
      'quantity',
      'reservedQuantity',
      'stockValue',
      'inventoryValue',
    ]
    if (
      stockFields.some(
        (key) =>
          item[key] != null &&
          (!Number.isFinite(Number(item[key])) || Number(item[key]) !== 0),
      )
    )
      blockers.push(
        'Stock or valuation remains. Resolve quantities and value through the stock workflow first; deletion never discards stock.',
      )
  }
  for (const [source, records] of Object.entries(workspace)) {
    // The immutable deletion audit remains, but is not a business dependency.
    if (source === 'activity') continue
    for (const record of records) {
      if (source === table && record.id === item.id) continue
      if (referencesItem({ ...record, id: undefined }, item.id))
        blockers.push(
          `${source.replaceAll('_', ' ')}: ${record.name || record.id}`,
        )
    }
  }
  return [...new Set(blockers)]
}
