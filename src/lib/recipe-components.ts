import {
  convert,
  parseQuantity,
  recipeCost,
  units,
  type Item,
  type Workspace,
} from './domain'

export function componentStock(source: Item, ingredients: Item[]): Item {
  if (!(Number(source.yield) > 0) || !units[source.yieldUnit]?.factor)
    throw new Error(
      'Set a positive finished yield in a supported pantry unit on the source recipe first. No loaf, weight or volume equivalence is assumed.',
    )
  const existing = ingredients.find((i) => i.compoundRecipeId === source.id)
  if (existing && existing.unit !== source.yieldUnit)
    throw new Error(
      'The source yield unit differs from its prepared stock unit. An explicit stock migration is required.',
    )
  return {
    ...existing,
    id: existing?.id || `prep-${source.id}`,
    name: source.name,
    unit: source.yieldUnit,
    quantity: existing?.quantity || 0,
    cost: existing?.cost ?? 0,
    currentCost: recipeCost(source, ingredients) / Number(source.yield),
    compoundRecipeId: source.id,
    usedAs: 'ingredient',
    category: 'Preps & fillings',
    threshold: existing?.threshold || 0,
    allergens: existing?.allergens || [],
    reviewed: existing?.reviewed || false,
  }
}

/** Normalizes legacy prep lines and rejects unsupported production modes/cycles before any save. */
export function validateRecipeComponents(recipe: Item, state: Workspace) {
  const recipes = [...state.recipes.filter((r) => r.id !== recipe.id), recipe]
  function sourceId(line: {
    ingredientId: string
    componentRecipeId?: string
  }) {
    const prep = state.ingredients.find((i) => i.id === line.ingredientId)
    if (
      line.componentRecipeId &&
      prep?.compoundRecipeId &&
      prep.compoundRecipeId !== line.componentRecipeId
    )
      throw new Error('Recipe component and prepared stock do not match.')
    return line.componentRecipeId || prep?.compoundRecipeId
  }
  const visiting = new Set<string>(),
    done = new Set<string>()
  function visit(id: string) {
    if (visiting.has(id))
      throw new Error(
        'A recipe cannot contain itself, directly or through another recipe.',
      )
    if (done.has(id)) return
    const r = recipes.find((r) => r.id === id)
    if (!r)
      throw new Error(
        'The component source recipe is unavailable in this oven.',
      )
    visiting.add(id)
    for (const line of r.lines || []) {
      const child = sourceId(line)
      if (child) visit(child)
    }
    visiting.delete(id)
    done.add(id)
  }
  visit(recipe.id)
  const stocks: Item[] = []
  for (const line of recipe.lines || []) {
    const id = sourceId(line)
    if (!id) continue
    if (line.productionMode && line.productionMode !== 'prepared_stock')
      throw new Error(
        'Recipe components currently require prepared stock. Make-with-parent production is not available.',
      )
    const source = recipes.find((r) => r.id === id)!,
      stock = componentStock(source, state.ingredients)
    // The ingredient FK remains authoritative; metadata cannot redirect another ingredient.
    if (line.ingredientId !== stock.id)
      throw new Error('Choose the prepared stock linked to this source recipe.')
    convert(
      parseQuantity(line.quantity),
      line.unit,
      source.yieldUnit,
      stock.conversions,
    )
    Object.assign(line, {
      componentRecipeId: id,
      productionMode: 'prepared_stock',
    })
    if (!stocks.some((i) => i.id === stock.id)) stocks.push(stock)
  }
  return stocks
}
