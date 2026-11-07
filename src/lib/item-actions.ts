import { pantryCategoryId } from './pantry-category'

type Record_ = Record<string, unknown>

/** Pantry-table item kind used for naming its full editor action. */
export function pantryItemKind(
  item: Record_,
): 'ingredient' | 'packaging' | 'material' | 'supply' {
  const category = pantryCategoryId(item)
  if (category === 'packaging' || item.usedAs === 'packaging')
    return 'packaging'
  if (category === 'craft-materials' || item.usedAs === 'material')
    return 'material'
  if (category === 'supplies' || item.usedAs === 'supply') return 'supply'
  return 'ingredient'
}

const pantryEditLabels = {
  ingredient: 'Edit Ingredient',
  packaging: 'Edit Packaging',
  material: 'Edit Material',
  supply: 'Edit Supply',
} as const

/**
 * Name of the action that opens the full editor for an existing record.
 * Products (food, handmade and resale) share one product editor.
 */
export function editActionLabel(
  item: Record_,
  table: 'ingredients' | 'products' | 'recipes',
) {
  if (table === 'products') return 'Edit Product'
  if (table === 'recipes') return 'Edit Recipe'
  return pantryEditLabels[pantryItemKind(item)]
}
