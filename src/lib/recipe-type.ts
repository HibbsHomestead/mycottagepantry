import type { Item, Workspace } from './domain'

export const recipeTypeFilters = [
  { value: 'all', label: 'All' },
  { value: 'recipe', label: 'Recipes' },
  { value: 'prep', label: 'Compound & Prep' },
] as const

export type RecipeTypeFilter = (typeof recipeTypeFilters)[number]['value']

export const recipeTypeLabel = (recipe: Item) =>
  recipe.compound === true ? 'Compound / Prep' : 'Recipe'

export function matchesRecipeType(recipe: Item, filter: RecipeTypeFilter) {
  if (recipe.workflow === 'handmade') return false
  return filter === 'all' || (recipe.compound === true) === (filter === 'prep')
}

/** Count distinct direct consumers, including older ingredient-only links. */
export function recipeComponentUsage(workspace: Workspace) {
  const ingredients = new Map<string, string>()
  for (const item of workspace.ingredients || [])
    if (item.compoundRecipeId) ingredients.set(item.id, item.compoundRecipeId)
  const consumers = new Map<string, Item[]>()
  for (const recipe of workspace.recipes) {
    const inputs = new Set<string>()
    for (const line of recipe.lines || []) {
      const linked = ingredients.get(line.ingredientId)
      if (line.componentRecipeId) inputs.add(line.componentRecipeId)
      if (linked) inputs.add(linked)
    }
    for (const id of inputs) {
      const usedIn = consumers.get(id) || []
      usedIn.push(recipe)
      consumers.set(id, usedIn)
    }
  }
  return consumers
}
