import { expect, it } from 'vitest'
import { updateProductRecipe, singularYield } from './product-recipe-links'
import { productCosting, type Workspace } from './domain'
const recipe = {
  id: 'r',
  name: 'Bread',
  yield: 4,
  yieldUnit: 'loaves',
  lines: [{ ingredientId: 'flour', quantity: 100, unit: 'g' }],
  laborMinutes: 10,
  laborRate: 12,
  overhead: 1,
}
function workspace(): Workspace {
  return {
    recipes: [recipe, { ...recipe, id: 'other', name: 'Other recipe' }],
    ingredients: [{ id: 'flour', name: 'Flour', unit: 'g', cost: 0.01 }],
    products: [
      {
        id: 'p',
        name: 'Bread box',
        price: 15,
        sku: '001',
        quantity: 8,
        imageAssetId: 'photo',
        unpacked: true,
        unitsPerPackage: 1,
      },
    ],
    sales: [{ id: 'sale', name: 'Sale', historicalCogs: 7 }],
    batches: [{ id: 'b', name: 'Batch', costSnapshot: { total: 7 } }],
    ledger: [],
  }
}
const input = {
  operation: 'link',
  productId: 'p',
  recipeId: 'r',
  expectedRecipeId: '',
  outputQuantity: 2,
  outputUnit: 'loaves',
  sellingUnit: 'box',
  confirm: true,
  mappingConfirmed: true,
}
it('uses stable IDs and the existing package mapping without changing business fields or histories', () => {
  const w = workspace(),
    before = structuredClone(w),
    next = updateProductRecipe(w, input)
  expect(next).toEqual({
    ...before.products[0],
    recipeId: 'r',
    unitsPerPackage: 2,
    sellingUnit: 'box',
    recipeMapping: {
      outputUnit: 'loaves',
      confirmed: true,
      packagingReviewed: false,
    },
  })
  expect(w).toEqual(before)
  w.products = [next]
  const cost = productCosting(next, w)
  expect(cost.perPackage).toBe(2)
  expect(cost.total).toBe(4)
  expect(next.price).toBe(15)
})
it('requires confirmation for replacing another source recipe and rejects stale connections', () => {
  const w = workspace()
  w.products[0].recipeId = 'other'
  expect(() => updateProductRecipe(w, input)).toThrow(/changed/)
  expect(() =>
    updateProductRecipe(w, { ...input, expectedRecipeId: 'other' }),
  ).toThrow(/replacement/)
  expect(
    updateProductRecipe(w, {
      ...input,
      expectedRecipeId: 'other',
      replaceConfirmed: true,
    }).recipeId,
  ).toBe('r')
})
it('requires an explicit output quantity and mapping, never guessing conversions or batch equivalence', () => {
  for (const patch of [
    { outputQuantity: '' },
    { outputQuantity: -1 },
    { mappingConfirmed: false },
    { outputUnit: 'g' },
    { sellingUnit: '' },
  ])
    expect(() =>
      updateProductRecipe(workspace(), { ...input, ...patch }),
    ).toThrow()
})
it('prevents duplicate links and duplicate unlinks while preserving records', () => {
  const w = workspace()
  w.products[0] = updateProductRecipe(w, input)
  expect(updateProductRecipe(w, input)).toBe(w.products[0])
  const removed = updateProductRecipe(w, {
    ...input,
    operation: 'unlink',
    expectedRecipeId: 'r',
  })
  expect(removed.recipeId).toBeNull()
  expect(removed.price).toBe(15)
  w.products[0] = removed
  expect(updateProductRecipe(w, { ...input, operation: 'unlink' })).toBe(
    removed,
  )
  expect(w.products).toHaveLength(1)
  expect(w.recipes).toHaveLength(2)
  expect(w.sales[0].historicalCogs).toBe(7)
})
it('rejects records outside the oven and archived products', () => {
  expect(() =>
    updateProductRecipe(workspace(), { ...input, recipeId: 'outside' }),
  ).toThrow(/oven/)
  const w = workspace()
  w.products[0].archived = true
  expect(() => updateProductRecipe(w, input)).toThrow(/active/)
})
it('requires explicit review where both recipe and product packaging are present', () => {
  const w = workspace()
  w.recipes[0] = { ...recipe, packagingCost: 2 }
  w.products[0].packagingLines = [{ ingredientId: 'bag', quantity: 1 }]
  expect(() => updateProductRecipe(w, input)).toThrow(/distinct costs/)
  expect(
    updateProductRecipe(w, { ...input, packagingConfirmed: true }).recipeMapping
      .packagingReviewed,
  ).toBe(true)
})
it('singularizes supported yield labels without changing unknown measurement labels', () => {
  expect(singularYield('loaves')).toBe('loaf')
  expect(singularYield('cookies')).toBe('cookie')
  expect(singularYield('boxes')).toBe('box')
  expect(singularYield('kg')).toBe('kg')
})
