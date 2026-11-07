/** Stable category IDs are saved alongside the legacy display label in item data. */
export const pantryCategories = [
  { value: 'flour-grains', label: 'Flour & grains' },
  { value: 'sugar-sweeteners', label: 'Sugar & sweeteners' },
  { value: 'dairy-eggs', label: 'Dairy & eggs' },
  { value: 'baking-essentials', label: 'Baking essentials' },
  { value: 'spices-flavorings', label: 'Spices & flavorings' },
  { value: 'chocolate-add-ins', label: 'Chocolate & add-ins' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'craft-materials', label: 'Craft materials' },
] as const

export function pantryCategoryId(item: Record<string, unknown>) {
  if (item.categoryId) return String(item.categoryId)
  // Compatibility boundary for records saved before stable category IDs existed.
  if (item.usedAs === 'material') return 'craft-materials'
  if (item.usedAs === 'packaging') return 'packaging'
  return pantryCategories.find((c) => c.label === item.category)?.value || ''
}

export const isPackaging = (item: Record<string, unknown>) =>
  pantryCategoryId(item) === 'packaging'

export function selectPantryCategory(
  draft: Record<string, unknown>,
  categoryId: string,
  existing: boolean,
  deliberateUnits: ReadonlySet<string> = new Set(),
) {
  const category = pantryCategories.find((c) => c.value === categoryId)
  if (!category) return draft
  const next: Record<string, unknown> = {
    ...draft,
    categoryId,
    category: category.label,
    usedAs:
      categoryId === 'craft-materials'
        ? 'material'
        : categoryId === 'packaging'
          ? 'packaging'
          : categoryId === 'supplies'
            ? 'supply'
            : 'ingredient',
  }
  if (!existing && categoryId === 'packaging') {
    if (!draft.recipeUnit) next.recipeUnit = 'each'
    for (const key of ['purchaseUnit', 'unit']) {
      if (!draft[key] || !deliberateUnits.has(key)) next[key] = 'each'
    }
  }
  return next
}
