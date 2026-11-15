import { pantryCategoryScope } from './category-details'
import type { Item, Workspace } from './domain'

// Deliberate aliases only. No punctuation, substring or fuzzy matching.
export const categoryAliases: Record<string, string> = {
  breads: 'Breads & Rolls',
  'breads & rolls': 'Breads & Rolls',
  cakes: 'Cakes & Cupcakes',
  'cakes & cupcakes': 'Cakes & Cupcakes',
  fillings: 'Preps, Fillings & Toppings',
  'preps & fillings': 'Preps, Fillings & Toppings',
  'preps, fillings & toppings': 'Preps, Fillings & Toppings',
}
export const exactCategoryKey = (name: string) => name.trim().toLowerCase()
export const canonicalCategoryName = (name: string) =>
  categoryAliases[exactCategoryKey(name)] || name.trim()

/** Mutates a single already-authorized workspace. Call under its business lock.
 * Keep destinations, scope and parent boundaries; never touch tax classifications.
 */
export function consolidateCategories(state: Workspace) {
  const settings = state.settings?.[0]
  const changes: { table: string; item: Item }[] = []
  const counts: Record<string, number> = {}
  if (!settings) return { changes, counts }
  for (const [field, table, reference, revision] of [
    [
      'recipeCategories',
      'recipes',
      'recipeCategoryId',
      'recipeCategoryRevision',
    ],
    [
      'pantryCategories',
      'ingredients',
      'sectionCategoryId',
      'pantryCategoryRevision',
    ],
    [
      'productCategories',
      'products',
      'productCategoryId',
      'categoryConfigRevision',
    ],
  ]) {
    const saved: Item[] = settings[field] || []
    const original = [...saved]
    // Older recipe dropdowns supplied deterministic IDs without saving their
    // default category definitions. Materialize only referenced implicit IDs.
    if (table === 'recipes') {
      const implicit = [
        ['Breads', 'bread'],
        ['Breads & Rolls', 'bread'],
        ['Cakes', 'cake'],
        ['Cakes & Cupcakes', 'cake'],
        ['Fillings', 'filling'],
        ['Preps & fillings', 'filling'],
        ['Preps, Fillings & Toppings', 'filling'],
      ]
      for (const [name, icon] of implicit) {
        const id = 'recipe-' + encodeURIComponent(exactCategoryKey(name))
        if (
          (state.recipes || []).some((r) => r.recipeCategoryId === id) &&
          !original.some((c) => c.id === id)
        )
          original.push({ id, name, icon, active: true, previousNames: [] })
      }
      for (const [name, icon] of implicit.filter(([n]) =>
        ['Breads & Rolls', 'Cakes & Cupcakes'].includes(n),
      )) {
        if (
          original.some((c) => canonicalCategoryName(c.name) === name) &&
          !original.some((c) => c.name === name)
        )
          original.push({
            id: 'recipe-' + encodeURIComponent(exactCategoryKey(name)),
            name,
            icon,
            active: true,
            previousNames: [],
          })
      }
    }
    if (table === 'ingredients') {
      for (const item of state.ingredients || []) {
        const name = item.category || ''
        const scope = pantryCategoryScope(item)
        if (
          categoryAliases[exactCategoryKey(name)] &&
          item.sectionCategoryId ===
            `pantry-${scope}-${encodeURIComponent(name)}` &&
          !original.some((c) => c.id === item.sectionCategoryId)
        )
          original.push({
            id: item.sectionCategoryId,
            name,
            scope,
            active: true,
            previousNames: [],
          })
      }
    }
    const groups = new Map<string, Item[]>()
    for (const c of original) {
      const name = canonicalCategoryName(c.name)
      const key = JSON.stringify([
        c.scope || '',
        c.parentId || '',
        exactCategoryKey(name),
      ])
      groups.set(key, [...(groups.get(key) || []), c])
    }
    const redirects = new Map<string, Item>()
    const categories: Item[] = []
    for (const group of groups.values()) {
      const name = canonicalCategoryName(group[0].name)
      const destination =
        group.find((c) => c.name === name) ||
        group.find(
          (c) => exactCategoryKey(c.name) === exactCategoryKey(name),
        ) ||
        group.find((c) => exactCategoryKey(c.name) === 'preps & fillings') ||
        group[0]
      const next = {
        ...destination,
        name,
        previousNames: [
          ...new Set(
            group
              .flatMap((c) => [c.name, ...(c.previousNames || [])])
              .filter((n) => n !== name),
          ),
        ],
      }
      categories.push(next)
      for (const c of group) redirects.set(c.id, next)
    }
    for (const c of categories) {
      if (c.parentId && redirects.has(c.parentId))
        c.parentId = redirects.get(c.parentId)!.id
    }
    for (const item of state[table] || []) {
      const oldName = item.category || ''
      const canonical = categoryAliases[exactCategoryKey(oldName)] || oldName
      const candidates = categoryAliases[exactCategoryKey(oldName)]
        ? categories.filter((c) =>
            [c.name, ...(c.previousNames || [])].some(
              (n) => canonicalCategoryName(n) === canonical,
            ),
          )
        : []
      const linked = redirects.get(item[reference])
      const originalCategory = original.find((c) => c.id === item[reference])
      const linkedChanged =
        linked &&
        (linked.id !== item[reference] ||
          (originalCategory &&
            canonicalCategoryName(originalCategory.name) !==
              originalCategory.name) ||
          (categoryAliases[exactCategoryKey(oldName)] &&
            categoryAliases[exactCategoryKey(linked.name)]))
      const category = item[reference]
        ? linkedChanged
          ? linked
          : undefined
        : candidates.length === 1
          ? candidates[0]
          : undefined
      // Unknown saved IDs are preserved rather than guessed from text.
      const name = category?.name || (!item[reference] ? canonical : oldName)
      if ((category && item[reference] !== category.id) || name !== oldName) {
        if (category) {
          if (table === 'ingredients' && item.categoryId === item[reference])
            item.categoryId = category.id
          item[reference] = category.id
        }
        if (
          table === 'ingredients' &&
          item.usedAs === 'material' &&
          (item.materialCategory === oldName ||
            categoryAliases[exactCategoryKey(item.materialCategory || '')])
        )
          item.materialCategory = name
        item.category = name
        changes.push({ table, item })
        const key = categoryAliases[exactCategoryKey(oldName)] || name
        counts[key] = (counts[key] || 0) + 1
      }
    }
    if (JSON.stringify(saved) !== JSON.stringify(categories)) {
      settings[field] = categories
      settings[revision] = Number(settings[revision] || 0) + 1
    }
  }
  return { changes, counts }
}
