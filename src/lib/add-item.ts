import { units, type Item } from './domain'
export const itemTypes = [
  ['ingredient', 'Ingredient'],
  ['packaging', 'Packaging'],
  ['material', 'Craft Material'],
  ['supply', 'Supply'],
  ['resale', 'Resale Merchandise'],
] as const
export function defaultItemType(tab: string) {
  return (
    (
      {
        Ingredients: 'ingredient',
        Packaging: 'packaging',
        'Craft Materials': 'material',
        Supplies: 'supply',
        'Resale Merchandise': 'resale',
      } as Record<string, string>
    )[tab] || ''
  )
}
export function itemUnitOptions(type: string, subtype?: string) {
  if (['packaging', 'resale'].includes(type))
    return ['each', 'pack', 'case', 'box', 'roll', 'bundle']
  if (type === 'material' && subtype === 'fabric')
    return ['yd', 'ft', 'in', 'm', 'cm', 'each', 'bolt', 'roll']
  return Object.keys(units).filter((u) =>
    type === 'ingredient'
      ? units[u].category !== 'length'
      : type === 'supply' || units[u].category !== 'volume',
  )
}
/** Submit only the active draft; hidden drafts remain in the form for switching back. */
export function activeItemDraft(
  shared: Record<string, Item[string]>,
  specific: Record<string, Item[string]>,
) {
  return { ...shared, ...specific, inventoryCreation: true }
}
