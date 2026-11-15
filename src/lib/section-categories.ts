import { z } from 'zod'
import type { Item, Workspace } from './domain'
import {
  categoryDetailsShape,
  categoryScopeSchema,
  categoryOrder,
  pantryCategoryScope,
  productCategoryScope,
  type CategoryScope,
} from './category-details'
import { pantryCategories } from './pantry-category'
import { recipeCategories, recipeCategory } from './recipe-categories'

export const pantrySectionCategorySchema = z.object({
  id: z.string().min(1).max(1200),
  name: z.string().trim().min(1).max(100),
  ...categoryDetailsShape,
  scope: categoryScopeSchema,
  active: z.boolean().optional(),
  previousNames: z.array(z.string().max(100)).optional(),
  needsReview: z.boolean().optional(),
})
export type SectionCategory = {
  id: string
  name: string
  description?: string
  scope?: CategoryScope
  parentId?: string | null
  displayOrder?: number
  active?: boolean
  classification?: 'food' | 'non_food' | null
  icon?: string
  needsReview?: boolean
}
const legacyId = (scope: string, name: string) =>
  'pantry-' + scope + '-' + encodeURIComponent(name)
export function pantrySectionCategories(w: Workspace): SectionCategory[] {
  const saved = z
    .array(pantrySectionCategorySchema)
    .max(1000)
    .parse(w.settings[0]?.pantryCategories || [])
  const result: SectionCategory[] = [...saved]
  const add = (
    scope: CategoryScope,
    name: string,
    id: string,
    needsReview = false,
  ) => {
    if (!name || result.some((c) => c.id === id)) return
    result.push({ id, name, scope, active: true, needsReview })
  }
  for (const c of pantryCategories)
    add(
      c.value === 'packaging'
        ? 'packaging'
        : c.value === 'craft-materials'
          ? 'handmade-materials'
          : 'food-ingredients',
      c.label,
      c.value,
    )
  for (const i of w.ingredients || []) {
    if (i.sectionCategoryId) continue
    const scope = pantryCategoryScope(i)
    const label = String(
      scope === 'handmade-materials'
        ? i.materialCategory || ''
        : i.category || '',
    )
    if (!label) continue
    const seed = pantryCategories.find(
      (c) =>
        c.label === label &&
        result.some((r) => r.id === c.value && r.scope === scope),
    )
    if (!seed) add(scope, label, legacyId(scope, label), true)
  }
  return categoryOrder(result)
}
export function sectionCategories(
  w: Workspace,
  scope: CategoryScope,
): SectionCategory[] {
  if (scope === 'recipes') return recipeCategories(w)
  if (scope.endsWith('products') || scope === 'kits')
    return categoryOrder<SectionCategory>(
      w.settings[0]?.productCategories || [],
    ).filter((c: SectionCategory) => c.scope === scope)
  return pantrySectionCategories(w).filter((c) => c.scope === scope)
}
export function assignedCategoryId(
  item: Item,
  w: Workspace,
  scope: CategoryScope,
): string {
  if (scope === 'recipes')
    return recipeCategory(item, recipeCategories(w))?.id || ''
  if (scope.endsWith('products') || scope === 'kits')
    return item.productCategoryId || ''
  if (item.sectionCategoryId) return item.sectionCategoryId
  const label = String(
    scope === 'handmade-materials'
      ? item.materialCategory || ''
      : item.category || '',
  )
  const seed = pantryCategories.find(
    (c) =>
      c.label === label &&
      sectionCategories(w, scope).some((r) => r.id === c.value),
  )
  return seed?.value || (label ? legacyId(scope, label) : '')
}
export function recordsInScope(w: Workspace, scope: CategoryScope) {
  return scope === 'recipes'
    ? w.recipes.filter((r) => r.workflow !== 'handmade')
    : scope.endsWith('products') || scope === 'kits'
      ? w.products.filter((p) => productCategoryScope(p) === scope)
      : w.ingredients.filter((i) => pantryCategoryScope(i) === scope)
}
export function assertSectionCategoryAssignment(
  item: Item,
  previous: Item | undefined,
  w: Workspace,
  table: string,
) {
  if (!['ingredients', 'products'].includes(table)) return
  const scope =
    table === 'products'
      ? productCategoryScope(item)
      : pantryCategoryScope(item)
  const key = table === 'products' ? 'productCategoryId' : 'sectionCategoryId'
  // Older editors and stock operations must retain the saved assignment.
  if (previous && item[key] === undefined) item[key] = previous[key]
  if (
    !item[key] ||
    (item[key] === previous?.[key] &&
      scope ===
        (table === 'products'
          ? productCategoryScope(previous)
          : pantryCategoryScope(previous)))
  )
    return
  const category = sectionCategories(w, scope).find((c) => c.id === item[key])
  if (!category || category.active === false)
    throw new Error('Choose an active category from this section and business.')
}
export function categorySettingsPatch(
  scope: CategoryScope,
  data: any,
): Partial<Item> {
  return scope === 'recipes'
    ? {
        recipeCategories: data.categories,
        recipeCategoryRevision: data.revision,
      }
    : scope.endsWith('products') || scope === 'kits'
      ? {
          productCategories: data.categories,
          categoryConfigRevision: data.revision,
        }
      : {
          pantryCategories: data.categories,
          pantryCategoryRevision: data.revision,
        }
}
export function categoryEndpointFor(scope: CategoryScope) {
  return scope === 'recipes'
    ? '/api/workspace?recipeCategories=1'
    : scope.endsWith('products') || scope === 'kits'
      ? '/api/workspace?productCategories=1'
      : '/api/workspace?pantryCategories=1'
}
