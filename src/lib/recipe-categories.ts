import { z } from 'zod'
import type { Item, Workspace } from './domain'

export const recipeIconNames = [
  'bread',
  'cookie',
  'cake',
  'muffin',
  'pie',
  'pastry',
  'bars',
  'cheesecake',
  'candy',
  'frosting',
  'filling',
  'spread',
  'jam',
  'seasoning',
  'savory',
  'drink',
  'other',
] as const
export type RecipeIconName = (typeof recipeIconNames)[number]
export const recipeCategorySchema = z.object({
  id: z.string().min(1).max(1200),
  name: z.string().trim().min(1).max(100),
  icon: z.enum(recipeIconNames),
  active: z.boolean().default(true),
  previousNames: z.array(z.string().max(100)).max(500).default([]),
})
export type RecipeCategory = z.infer<typeof recipeCategorySchema>
export const recipeCategoryListSchema = z.array(recipeCategorySchema).max(500)
export const recipeCategoryKey = (name: string) =>
  name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
const defaults: [string, RecipeIconName][] = [
  ['Breads & Rolls', 'bread'],
  ['Cookies', 'cookie'],
  ['Cakes & Cupcakes', 'cake'],
  ['Muffins & Quick Breads', 'muffin'],
  ['Pies & Tarts', 'pie'],
  ['Pastries', 'pastry'],
  ['Brownies & Bars', 'bars'],
  ['Cheesecakes', 'cheesecake'],
  ['Candy & Confections', 'candy'],
  ['Frostings, Icings & Glazes', 'frosting'],
  ['Fillings', 'filling'],
  ['Sauces & Spreads', 'spread'],
  ['Jams & Preserves', 'jam'],
  ['Seasonings & Dry Mixes', 'seasoning'],
  ['Snacks & Savory', 'savory'],
  ['Beverages', 'drink'],
  ['Other', 'other'],
  // Keep the original options and their existing assignments.
  ['Breads', 'bread'],
  ['Cakes', 'cake'],
  ['Preps & fillings', 'filling'],
]
const legacyId = (name: string) =>
  'recipe-' + encodeURIComponent(recipeCategoryKey(name))
export function recipeCategories(workspace: Workspace): RecipeCategory[] {
  const saved = recipeCategoryListSchema.parse(
    workspace.settings?.[0]?.recipeCategories || [],
  )
  const result = [...saved]
  const add = (name: string, icon: RecipeIconName) => {
    const key = recipeCategoryKey(name)
    if (
      !key ||
      result.some((c) =>
        [c.name, ...c.previousNames].some((n) => recipeCategoryKey(n) === key),
      )
    )
      return
    result.push({
      id: legacyId(name),
      name,
      icon,
      active: true,
      previousNames: [],
    })
  }
  defaults.forEach(([name, icon]) => add(name, icon))
  for (const recipe of workspace.recipes || []) {
    if (!recipe.recipeCategoryId && typeof recipe.category === 'string')
      add(recipe.category, 'other')
  }
  return result
}
export function recipeCategory(recipe: Item, categories: RecipeCategory[]) {
  if (recipe.recipeCategoryId)
    return categories.find((c) => c.id === recipe.recipeCategoryId)
  const key = recipeCategoryKey(recipe.category || '')
  return categories.find((c) =>
    [c.name, ...c.previousNames].some((n) => recipeCategoryKey(n) === key),
  )
}
export function recipeCategoryLabel(
  recipe: Item,
  categories: RecipeCategory[],
) {
  const category = recipeCategory(recipe, categories)
  return category
    ? category.name + (category.active ? '' : ' (archived)')
    : recipe.category || 'Uncategorized'
}
/** Validate assignment independently of the browser; old archived links remain editable. */
export function assignRecipeCategory(
  item: Item,
  previous: Item | undefined,
  categories: RecipeCategory[],
) {
  const category = recipeCategory(item, categories)
  const unchanged =
    previous &&
    recipeCategory(previous, categories)?.id === category?.id &&
    item.recipeCategoryId === previous.recipeCategoryId &&
    item.category === previous.category
  if (!category && (item.recipeCategoryId || item.category) && !unchanged)
    throw new Error(
      'Select a recipe category from this oven, or leave it uncategorized.',
    )
  if (category && !category.active && !unchanged)
    throw new Error(
      'Archived recipe categories cannot be assigned to new recipes.',
    )
  if (category) {
    item.recipeCategoryId = category.id
    // Keep historical free-text labels until a deliberate reassignment.
    if (!unchanged) item.category = category.name
  } else if (!item.recipeCategoryId && !item.category) {
    item.recipeCategoryId = ''
    item.category = ''
  }
  return item
}
