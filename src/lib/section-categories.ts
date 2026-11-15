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
  previousNames?: string[]
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
/** One classification, with legacy labels retained as compatibility mirrors.
 * Conflicts on untouched records remain visible until a deliberate selection. */
export function pantryCategoryConflict(item: Item, w: Workspace) {
  if (!item.sectionCategoryId) {
    const legacy = pantryCategories.find((c) => c.value === item.categoryId)
    return legacy && item.category && legacy.label !== item.category
      ? `Saved Category “${item.category}” differs from legacy classification “${legacy.label}”. Choose Category to confirm; saved assignments are preserved until then.`
      : ''
  }
  const current = sectionCategories(w, pantryCategoryScope(item)).find(
    (c) => c.id === item.sectionCategoryId,
  )
  const legacy =
    item.categoryId !== item.sectionCategoryId
      ? pantryCategories.find((c) => c.value === item.categoryId)?.label
      : undefined
  const labels = [item.category, legacy].filter(Boolean)
  return current &&
    labels.some(
      (label) =>
        label !== current.name && !current.previousNames?.includes(label),
    )
    ? `Saved Category “${current.name}” differs from legacy classification “${[...new Set(labels)].join(' / ')}”. Choose Category to confirm; saved assignments are preserved until then.`
    : ''
}
export function syncPantryCategory(item: Item, category?: SectionCategory) {
  item.sectionCategoryId = category?.id || ''
  item.category = category?.name || ''
  // Arbitrary scoped IDs are intentional: the fixed legacy list cannot express custom categories.
  item.categoryId = category?.id || ''
  if (item.usedAs === 'material') item.materialCategory = category?.name || ''
}
/** Resolve legacy labels at the read boundary; no database or stock write. */
export function pantryCategoryView(item: Item, w: Workspace): Item {
  if (pantryCategoryConflict(item, w)) return item
  const scope = pantryCategoryScope(item)
  const id = assignedCategoryId(item, w, scope)
  const category = sectionCategories(w, scope).find((c) => c.id === id)
  if (!category) return item
  const view = { ...item }
  syncPantryCategory(view, category)
  return view
}
export function workspaceCategorySettings(
  w: Workspace,
  patch: Partial<Item>,
): Workspace {
  const next: Workspace = {
    ...w,
    settings: w.settings.map((s, n) => (n === 0 ? { ...s, ...patch } : s)),
  }
  return patch.pantryCategories
    ? {
        ...next,
        ingredients: next.ingredients.map((i) => pantryCategoryView(i, next)),
      }
    : next
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
  // Resolve legacy writers through the same scoped list, without guessing conflicts.
  if (table === 'ingredients') {
    const selectedChanged =
      item.sectionCategoryId !== undefined &&
      item.sectionCategoryId !== previous?.sectionCategoryId
    const legacyChanged =
      previous &&
      (item.category !== previous.category ||
        item.categoryId !== previous.categoryId)
    const selected = sectionCategories(w, scope).find(
      (c) => c.id === item.sectionCategoryId,
    )
    const confirmed =
      selected &&
      item.categoryId === selected.id &&
      item.category === selected.name
    if (!selectedChanged && legacyChanged && !confirmed) {
      const label =
        item.categoryId !== previous.categoryId
          ? pantryCategories.find((c) => c.value === item.categoryId)?.label ||
            item.category
          : item.category
      const matches = sectionCategories(w, scope).filter(
        (c) => c.name === label && c.active !== false,
      )
      if (matches.length !== 1)
        throw new Error(
          'Category assignment needs review. Choose one Category in this section.',
        )
      syncPantryCategory(item, matches[0])
    }
  }
  // Older editors and stock operations must retain the saved assignment.
  if (previous && item[key] === undefined) item[key] = previous[key]
  if (table === 'ingredients' && item[key] === '' && previous?.[key])
    syncPantryCategory(item)
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
  if (table === 'ingredients') syncPantryCategory(item, category)
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
