import {
  convert,
  costBreakdown,
  effectiveRecipeLines,
  number,
  packagingLines,
  validateKit,
  units,
  type Item,
  type Workspace,
} from './domain'
import { workflowOf } from './product-workflows'

/** Yield labels such as “loaves” remain explicit recipe output bases, not generic each conversions. */
export function productionYieldConvert(
  quantity: number,
  from: string,
  to: string,
  conversions: Item[] = [],
) {
  const q = number(quantity, 'Recipe output', 0.000001)
  if (!from || !to) throw new Error('Choose an explicit recipe output unit.')
  if (from === to) return q
  if (!units[from] || !units[to]) {
    const c = conversions.find(
      (c) =>
        c.verified === true &&
        ((c.from === from && c.to === to) || (c.to === from && c.from === to)),
    )
    if (!c)
      throw new Error(
        `A verified yield conversion from ${from} to ${to} is required.`,
      )
    const x = number(c.amountFrom, 'Measured output', 0.000001),
      y = number(c.amountTo, 'Equivalent output', 0.000001)
    return c.from === from ? (q * y) / x : (q * x) / y
  }
  return convert(q, from, to, conversions)
}

function normalizedProductionLines(
  recipe: Item,
  ingredients: Item[],
  recipes: Item[],
) {
  const merged = new Map<string, Item>()
  for (const line of effectiveRecipeLines(recipe, recipes)) {
    const i = ingredients.find((i) => i.id === line.ingredientId)
    if (!i) throw new Error('Ingredient unavailable. Review the recipe inputs.')
    const quantity = convert(line.quantity, line.unit, i.unit, i.conversions)
    const prior = merged.get(i.id)
    if (prior) prior.quantity += quantity
    else
      merged.set(i.id, {
        ...line,
        id: i.id,
        name: i.name,
        quantity,
        unit: i.unit,
      })
  }
  return [...merged.values()]
}

export function productionDefinition(
  product: Item,
  state: Workspace,
  mapping: Item,
): Item {
  const workflow = workflowOf(product)
  if (!['food', 'kit', 'handmade'].includes(workflow))
    throw new Error(
      'Choose a recipe product or kit. Receive purchased products through stock receipts.',
    )
  if (workflow === 'kit') {
    validateKit(product, state)
    return {
      id: product.id,
      name: product.name,
      product: structuredClone(product),
      components: product.kitComponents.map((line: Item) => ({
        ...line,
        product: structuredClone(
          state.products.find((p) => p.id === line.productId),
        ),
      })),
      ingredients: structuredClone(
        state.ingredients.filter((i) =>
          packagingLines(product).some((l) => l.ingredientId === i.id),
        ),
      ),
    }
  }
  const recipe = state.recipes.find((r) => r.id === product.recipeId)
  if (!recipe)
    throw new Error('Missing recipe. Open Edit product and link a recipe.')
  if (
    recipe.compound ||
    state.ingredients.some((i) => i.compoundRecipeId === recipe.id)
  )
    throw new Error(
      'This recipe produces prepared pantry stock. Use the separate compound-prep workflow.',
    )
  number(recipe.yield, 'Recipe yield', 0.000001)
  if (!recipe.yieldUnit)
    throw new Error('Missing yield unit. Open Edit Recipe.')
  if (mapping.verified !== true)
    throw new Error(
      'Verify recipe output per selling package before scheduling.',
    )
  const unitsPerPackage = productionYieldConvert(
    number(mapping.quantity, 'Recipe output per package', 0.000001),
    mapping.unit,
    recipe.yieldUnit,
    mapping.conversions,
  )
  // The recipe snapshot keeps the original graph for allocations and a resolved input list.
  const included = new Set<string>()
  const collect = (r: Item) => {
    if (included.has(r.id))
      throw new Error('Recipe base cycle requires review.')
    included.add(r.id)
    if (r.baseRecipeId) {
      const parent = state.recipes.find(
        (source) => source.id === r.baseRecipeId,
      )
      if (!parent)
        throw new Error('Linked base is unavailable. Review the recipe.')
      collect(parent)
    }
  }
  collect(recipe)
  const recipes = structuredClone(
    state.recipes.filter((r) => included.has(r.id)),
  )
  const ids = new Set(
    [...effectiveRecipeLines(recipe, recipes), ...packagingLines(product)].map(
      (l) => l.ingredientId,
    ),
  )
  return {
    id: product.id,
    name: product.name,
    product: { ...structuredClone(product), unitsPerPackage },
    recipe: structuredClone(recipe),
    recipes,
    ingredients: structuredClone(
      state.ingredients.filter((i) => ids.has(i.id)),
    ),
    mapping: { ...mapping, unitsPerPackage },
  }
}

export function productionRequirements(
  definition: Item,
  quantity: number,
  actual: Item = { id: '', name: '' },
) {
  number(quantity, 'Selling packages', 1)
  if (!Number.isInteger(quantity))
    throw new Error('Enter a whole number of selling packages.')
  const p = definition.product
  const inputs = definition.ingredients as Item[]
  const requirements: Item[] = []
  const add = (kind: string, item: Item, q: number, source: Item) => {
    const key = kind + ':' + item.id
    const prior = requirements.find((r) => r.id === key)
    if (prior) prior.quantity += q
    else
      requirements.push({
        id: key,
        name: item.name,
        kind,
        itemId: item.id,
        unit: kind === 'product' ? 'package' : item.unit,
        quantity: q,
        tracked:
          kind === 'product' ||
          item.usedAs !== 'packaging' ||
          item.trackInventory !== false,
        source,
      })
  }
  let cost: {
    laborMinutes: number
    laborRate: number
    labor: number
    overhead: number
    waste: number
  }
  let multiplier = 0
  const good = number(actual.output ?? quantity, 'Actual output', 1)
  if (!Number.isInteger(good))
    throw new Error('Actual output must be whole selling packages.')
  const waste = number(actual.waste ?? 0, 'Output waste')
  if (!Number.isInteger(waste))
    throw new Error('Waste must be whole selling packages.')
  if (p.workflow === 'kit') {
    for (const line of definition.components)
      add('product', line.product, line.quantity * (good + waste), line)
    for (const line of packagingLines(p)) {
      const i = inputs.find((i) => i.id === line.ingredientId)!
      add(
        'ingredient',
        i,
        convert(line.quantity, line.unit || i.unit, i.unit, i.conversions) *
          (good + waste),
        line,
      )
    }
    const laborMinutes = number(
      actual.laborMinutes ?? Number(p.assemblyMinutes || 0) * (good + waste),
      'Assembly minutes',
    )
    cost = {
      laborMinutes,
      laborRate: Number(p.assemblyRate || 0),
      labor: (laborMinutes / 60) * Number(p.assemblyRate || 0),
      overhead: 0,
      waste: 0,
    }
  } else {
    const r = definition.recipe
    multiplier =
      (quantity * p.unitsPerPackage) / number(r.yield, 'Recipe yield', 0.000001)
    for (const line of normalizedProductionLines(
      r,
      inputs,
      definition.recipes,
    )) {
      const i = inputs.find((i) => i.id === line.ingredientId)!
      const q =
        actual.usage?.[i.id] == null
          ? convert(
              line.quantity * multiplier,
              line.unit,
              i.unit,
              i.conversions,
            )
          : number(actual.usage[i.id], 'Actual use')
      const materialWaste = number(
        actual.materialWaste?.[i.id] || 0,
        'Material waste',
      )
      add('ingredient', i, q + materialWaste, line)
    }
    for (const line of packagingLines(p)) {
      const i = inputs.find((i) => i.id === line.ingredientId)!
      add(
        'ingredient',
        i,
        convert(line.quantity, line.unit || 'each', i.unit, i.conversions) *
          good,
        line,
      )
    }
    const actualRecipe = {
      ...r,
      baseRecipeId: undefined,
      baseRecipe: undefined,
      lines: normalizedProductionLines(r, inputs, definition.recipes).map(
        (line) => {
          const i = inputs.find((i) => i.id === line.ingredientId)!
          return {
            ...line,
            unit: i.unit,
            quantity:
              (actual.usage?.[i.id] == null
                ? convert(
                    line.quantity * multiplier,
                    line.unit,
                    i.unit,
                    i.conversions,
                  )
                : number(actual.usage[i.id], 'Actual use')) /
                multiplier +
              number(actual.materialWaste?.[i.id] || 0, 'Material waste') /
                multiplier,
          }
        },
      ),
    }
    // Expand inputs once, while preserving the existing base allocation policy.
    cost = costBreakdown(actualRecipe, inputs, {
      recipes: definition.recipes,
      product: p,
      multiplier,
      actualYield: good * p.unitsPerPackage,
      laborMinutes: actual.laborMinutes,
      wasteCost: actual.wasteCost,
      historical: true,
      baseCostOverride: r.baseRecipeId
        ? costBreakdown(
            definition.recipes.find((base: Item) => base.id === r.baseRecipeId),
            inputs,
            {
              recipes: definition.recipes,
              reusableBase: true,
              multiplier: multiplier * r.baseMultiplier,
              historical: true,
            },
          )
        : undefined,
    })
  }
  return { requirements, cost, multiplier, output: good, waste }
}
