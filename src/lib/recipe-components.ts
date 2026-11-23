import {
  convert,
  baseIngredientOverlap,
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
    category: 'Preps, Fillings & Toppings',
    threshold: existing?.threshold || 0,
    allergens: existing?.allergens || [],
    reviewed: existing?.reviewed || false,
  }
}

export function componentSourceId(
  line: { ingredientId: string; componentRecipeId?: string },
  ingredients: Item[],
) {
  const prep = ingredients.find((i) => i.id === line.ingredientId)
  if (
    line.componentRecipeId &&
    prep?.compoundRecipeId &&
    prep.compoundRecipeId !== line.componentRecipeId
  )
    throw new Error('Recipe component and prepared stock do not match.')
  return line.componentRecipeId || prep?.compoundRecipeId
}

export function assertRecipeComponentGraph(
  recipe: Item,
  state: Workspace,
  allowMissingComponents = false,
) {
  const recipes = [...state.recipes.filter((r) => r.id !== recipe.id), recipe]
  const visiting = new Set<string>(),
    done = new Set<string>()
  function visit(id: string) {
    if (visiting.has(id))
      throw new Error(
        'A recipe cannot contain itself, directly or through another recipe.',
      )
    if (done.has(id)) return
    const r = recipes.find((r) => r.id === id)
    if (!r && allowMissingComponents) return
    if (!r)
      throw new Error(
        'The component source recipe is unavailable in this oven.',
      )
    visiting.add(id)
    if (r.baseRecipeId) {
      if (r.baseRecipeId === r.id)
        throw new Error(
          'A recipe cannot contain itself, directly or through another recipe.',
        )
      const multiplier = parseQuantity(r.baseMultiplier)
      if (!Number.isFinite(multiplier) || multiplier <= 0)
        throw new Error('Enter a positive base batch multiplier.')
      const base = recipes.find((source) => source.id === r.baseRecipeId)
      if (!base || base.workflow === 'handmade')
        throw new Error('The linked base recipe is unavailable in this oven.')
      visit(r.baseRecipeId)
    }
    for (const line of r.lines || []) {
      const child = componentSourceId(line, state.ingredients)
      if (child) visit(child)
    }
    visiting.delete(id)
    done.add(id)
  }
  visit(recipe.id)
  return recipes
}

/** Normalizes legacy prep lines and rejects unsupported production modes/cycles before any save. */
export function validateRecipeComponents(recipe: Item, state: Workspace) {
  const recipes = assertRecipeComponentGraph(recipe, state)
  if (recipe.baseRecipeId)
    recipe.baseMultiplier = parseQuantity(recipe.baseMultiplier)
  const overlap = baseIngredientOverlap(recipe, recipes)
  if (overlap && recipe.baseOverlapApproval !== overlap.approval)
    throw new Error(
      'Some inclusions also occur in the base. Review and approve keeping both quantities before saving. No ingredients were removed.',
    )
  const stocks: Item[] = []
  for (const line of recipe.lines || []) {
    const id = componentSourceId(line, state.ingredients)
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
    try {
      convert(
        parseQuantity(line.quantity),
        line.unit,
        source.yieldUnit,
        stock.conversions,
      )
    } catch (cause) {
      throw new Error(
        `${cause instanceof Error ? cause.message : 'Conversion unavailable.'} Add a verified prep-specific equivalence on the inventory ingredient “${stock.name}” before consuming ${line.unit} against its ${source.yieldUnit} output. No weight/volume density or count equivalence is assumed.`,
        { cause },
      )
    }
    Object.assign(line, {
      componentRecipeId: id,
      productionMode: 'prepared_stock',
    })
    if (!stocks.some((i) => i.id === stock.id)) stocks.push(stock)
  }
  return stocks
}
