import { number, packagingLines, type Item, type Workspace } from './domain'
export function singularYield(unit = 'item') {
  const known: Record<string, string> = {
    loaves: 'loaf',
    leaves: 'leaf',
    cookies: 'cookie',
    batches: 'batch',
    boxes: 'box',
    slices: 'slice',
    pieces: 'piece',
    servings: 'serving',
    muffins: 'muffin',
    cakes: 'cake',
    rolls: 'roll',
    units: 'unit',
    items: 'item',
    packs: 'pack',
    portions: 'portion',
    pastries: 'pastry',
    brownies: 'brownie',
    cupcakes: 'cupcake',
    pies: 'pie',
    jars: 'jar',
    bottles: 'bottle',
    bags: 'bag',
    bars: 'bar',
    dozens: 'dozen',
    grams: 'gram',
    kilograms: 'kilogram',
    pounds: 'pound',
    ounces: 'ounce',
    liters: 'liter',
    milliliters: 'milliliter',
  }
  return unit.replace(/\S+$/, (word) => known[word.toLowerCase()] || word)
}
// Products have one source recipe; many products may reference that recipe.
// unitsPerPackage is the existing amount of recipe output consumed per sellable package.
export function updateProductRecipe(w: Workspace, data: any): Item {
  const product = w.products.find((p) => p.id === data.productId)
  const recipe = w.recipes.find((r) => r.id === data.recipeId)
  if (!product || !recipe)
    throw new Error('Choose a product and recipe from this oven.')
  if (data.operation === 'unlink' && !product.recipeId) return product
  const sameLink =
    product.recipeId === recipe.id &&
    data.operation === 'link' &&
    product.unitsPerPackage === Number(data.outputQuantity) &&
    product.sellingUnit === data.sellingUnit?.trim()
  if (sameLink) return product
  if ((product.recipeId || '') !== data.expectedRecipeId)
    throw new Error(
      'The product’s recipe connection changed. Reopen the link review.',
    )
  if (data.operation === 'unlink') {
    if (product.recipeId !== recipe.id || data.confirm !== true)
      throw new Error('Confirm removal of this recipe connection.')
    return { ...product, recipeId: null, recipeMapping: null }
  }
  if (
    data.operation !== 'link' ||
    product.archived ||
    product.status === 'archived'
  )
    throw new Error('Choose an active product to link.')
  number(recipe.yield, 'Recipe yield', 0.000001)
  if (typeof recipe.yieldUnit !== 'string' || !recipe.yieldUnit.trim())
    throw new Error('Set the recipe output unit before linking a product.')
  if (data.confirm !== true || data.mappingConfirmed !== true)
    throw new Error('Review and confirm the recipe output mapping.')
  if (
    product.recipeId &&
    product.recipeId !== recipe.id &&
    data.replaceConfirmed !== true
  )
    throw new Error('Confirm replacement of the current source recipe.')
  const sellingUnit = String(data.sellingUnit || '').trim()
  if (!sellingUnit || sellingUnit.length > 80)
    throw new Error(
      'Enter the product selling unit, such as loaf, box or pack.',
    )
  const quantity = number(
    data.outputQuantity,
    'Recipe output per sellable product',
    0.000001,
  )
  if (data.outputUnit !== recipe.yieldUnit)
    throw new Error('The recipe output unit changed. Review the mapping again.')
  if (
    Number(recipe.packagingCost) > 0 &&
    packagingLines(product).length &&
    data.packagingConfirmed !== true
  )
    throw new Error(
      'Confirm recipe packaging and product packaging are distinct costs before linking.',
    )
  return {
    ...product,
    recipeId: recipe.id,
    unitsPerPackage: quantity,
    sellingUnit,
    recipeMapping: {
      outputUnit: recipe.yieldUnit,
      confirmed: true,
      packagingReviewed: data.packagingConfirmed === true,
    },
  }
}
