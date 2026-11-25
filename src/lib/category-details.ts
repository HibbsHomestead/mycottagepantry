import { z } from 'zod'

export const categoryScopes = {
  'food-products': 'Food products',
  'food-ingredients': 'Food ingredients & supplies',
  packaging: 'Packaging',
  recipes: 'Recipes',
  'handmade-products': 'Handmade products',
  'handmade-materials': 'Handmade materials & supplies',
  'resale-products': 'Resale products',
  kits: 'Baskets',
} as const
export type CategoryScope = keyof typeof categoryScopes
export const categoryScopeSchema = z.enum(
  Object.keys(categoryScopes) as [CategoryScope, ...CategoryScope[]],
)
export const categoryDetailsShape = {
  description: z.string().trim().max(1000).optional(),
  parentId: z.string().max(1200).nullable().optional(),
  displayOrder: z.number().int().min(0).max(100000).optional(),
}
export function categoryOrder<
  T extends { name: string; displayOrder?: number },
>(categories: T[]): T[] {
  return [...categories].sort(
    (a, b) =>
      (a.displayOrder ?? 0) - (b.displayOrder ?? 0) ||
      a.name.localeCompare(b.name),
  )
}
export function validateCategoryTree(
  categories: { id: string; parentId?: string | null; scope?: string }[],
) {
  for (const category of categories) {
    const visited = new Set([category.id])
    let parentId = category.parentId
    while (parentId) {
      if (visited.has(parentId))
        throw new Error(
          'A category cannot be its own parent or contain a parent cycle.',
        )
      visited.add(parentId)
      const parent = categories.find((c) => c.id === parentId)
      if (!parent || parent.scope !== category.scope)
        throw new Error('Choose a parent category in the same section.')
      parentId = parent.parentId
    }
  }
}
export function productCategoryScope(
  product: Record<string, any> = {},
): CategoryScope {
  return product.workflow === 'handmade'
    ? 'handmade-products'
    : product.workflow === 'resale'
      ? 'resale-products'
      : product.workflow === 'kit'
        ? 'kits'
        : 'food-products'
}
export function pantryCategoryScope(
  item: Record<string, any> = {},
): CategoryScope {
  return item.usedAs === 'material'
    ? 'handmade-materials'
    : item.usedAs === 'packaging'
      ? 'packaging'
      : 'food-ingredients'
}

/** Unscoped records predate section-specific product categories and belonged to
 * the shared product list. Keep them usable without assigning a guessed scope.
 * Call only on the business's productCategories, never pantry categories. */
export function productCategoryEligible(
  category: { scope?: CategoryScope },
  scope: CategoryScope,
) {
  return (
    (scope.endsWith('products') || scope === 'kits') &&
    (!category.scope || category.scope === scope)
  )
}
