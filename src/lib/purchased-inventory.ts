import { number, type Item, type Workspace } from './domain'
export const inventoryGroups = [
  { kind: 'ingredient', label: 'Ingredients' },
  { kind: 'material', label: 'Craft Materials' },
  { kind: 'packaging', label: 'Packaging' },
  { kind: 'supply', label: 'Supplies' },
  { kind: 'resale', label: 'Resale Merchandise' },
]
export function purchasableInventory(w: Workspace) {
  return [
    ...(w.ingredients || [])
      .filter((i) => !i.compoundRecipeId)
      .map((i) => ({
        ...i,
        itemTable: 'ingredients',
        inventoryKind: i.usedAs || 'ingredient',
      })),
    ...(w.products || [])
      .filter((p) => p.workflow === 'resale' && p.trackInventory !== false)
      .map((p) => ({
        ...p,
        itemTable: 'products',
        inventoryKind: 'resale',
        unit: 'each',
      })),
  ] as Item[]
}
export function resaleReceivedQuantity(data: Record<string, any>) {
  const count = number(data.quantity, 'Purchase quantity', 0.000001)
  if (!['each', 'pack', 'case', 'box', 'bundle'].includes(data.unit))
    throw new Error('Choose an appropriate resale purchase unit.')
  const contents =
    data.unit === 'each'
      ? 1
      : number(data.itemsPerUnit, 'Confirmed items per package', 1)
  if (data.unit !== 'each' && data.packageContentsConfirmed !== true)
    throw new Error('Confirm items per package before receiving resale stock.')
  if (!Number.isInteger(contents) || !Number.isSafeInteger(count * contents))
    throw new Error(
      'Receive a whole number of sellable items with confirmed package contents.',
    )
  return count * contents
}
