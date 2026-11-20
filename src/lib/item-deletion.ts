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
      if (referencesItem({ ...record, id: undefined }, item.id)) {
        const name = `${record.name || record.id} (ID: ${record.id})`
        const relationship =
          source === 'ingredients' && record.compoundRecipeId === item.id
            ? `This prep is linked to inventory ingredient ${name}. The ingredient’s compoundRecipeId points to this recipe; review its stock and uses before removal.`
            : source === 'recipes' && table === 'ingredients'
              ? `Recipe ${name} uses this inventory ingredient. Review its ingredient/component lines; historical records must be retained.`
              : `${source.replaceAll('_', ' ')}: ${name} references this ${table === 'recipes' ? 'recipe/prep' : 'item'}. Review the current link; historical records must be retained.`
        blockers.push(relationship)
      }
    }
  }
  return [...new Set(blockers)]
}

/** Only the deterministic output created by the compound-prep save path is owned.
 * A same-named ingredient or a legacy link with another ID is never inferred to be owned. */
export function recipeDeletionPlan(workspace: Workspace, recipe: Item) {
  const visiting = new Set<string>(),
    visited = new Set<string>()
  function cyclic(id: string): boolean {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    const current = workspace.recipes.find((r) => r.id === id)
    if (!current) return false
    visiting.add(id)
    const children = [
      current.baseRecipeId,
      ...(current.lines || []).map(
        (line: { componentRecipeId?: string; ingredientId: string }) =>
          line.componentRecipeId ||
          workspace.ingredients.find((i) => i.id === line.ingredientId)
            ?.compoundRecipeId,
      ),
    ].filter(Boolean) as string[]
    if (children.some(cyclic)) return true
    visiting.delete(id)
    visited.add(id)
    return false
  }
  const cycleBlockers = cyclic(recipe.id)
    ? [
        'Circular reference detected in this prep’s recipe/component links. Review the linked recipes with support; no automatic repair is performed.',
      ]
    : []
  const linked = workspace.ingredients.filter(
    (i) => i.compoundRecipeId === recipe.id,
  )
  const output =
    recipe.compound === true &&
    linked.length === 1 &&
    linked[0].id === `prep-${recipe.id}`
      ? linked[0]
      : undefined
  if (!output)
    return {
      output: undefined,
      blockers: [
        ...cycleBlockers,
        ...itemDeletionBlockers(workspace, 'recipes', recipe),
      ],
    }
  const reduced = {
    ...workspace,
    ingredients: workspace.ingredients.filter((i) => i.id !== output.id),
  }
  const blockers = [
    ...cycleBlockers,
    ...itemDeletionBlockers(reduced, 'recipes', recipe),
  ]
  // Keep the recipe in this check: consuming its own output is a cycle, not ownership.
  blockers.push(
    ...itemDeletionBlockers(workspace, 'ingredients', output).map(
      (message) =>
        `Output ingredient ${output.name} (ID: ${output.id}): ${message}`,
    ),
  )
  if (
    referencesItem(recipe.lines || [], output.id) ||
    referencesItem(recipe.lines || [], recipe.id) ||
    recipe.baseRecipeId === recipe.id
  )
    blockers.push(
      'Circular reference detected: this prep consumes itself or its own output. Review the recipe component links with support; no automatic repair is performed.',
    )
  return { output, blockers: [...new Set(blockers)] }
}
