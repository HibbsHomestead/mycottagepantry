import { expect, it } from 'vitest'
import { componentStock, validateRecipeComponents } from './recipe-components'
import { recipeCost, type Item, type Workspace } from './domain'
import { rollup } from './demo'
import { resolveLabelData } from './label-studio'
const raw: Item = {
  id: 'sugar',
  name: 'Sugar',
  unit: 'g',
  quantity: 500,
  cost: 0.02,
  currentCost: 0.02,
  usedAs: 'ingredient',
  allergens: ['Milk'],
  reviewed: true,
  statement: 'Sugar',
  conversions: [],
}
const source: Item = {
  id: 'frosting',
  name: 'Frosting',
  yield: 100,
  yieldUnit: 'g',
  lines: [{ ingredientId: 'sugar', quantity: 150, unit: 'g' }],
  laborMinutes: 30,
  laborRate: 10,
  overhead: 2,
}
const parent = (): Item => ({
  id: 'cake',
  name: 'Cake',
  yield: 1,
  yieldUnit: 'each',
  lines: [
    {
      ingredientId: 'prep-frosting',
      componentRecipeId: 'frosting',
      quantity: 25,
      unit: 'g',
    },
  ],
})
const state = (): Workspace => ({
  recipes: [source],
  ingredients: [raw],
  settings: [{ id: 'business', name: 'Test' }],
  products: [],
  batches: [],
  brand_kits: [],
  graphic_assets: [],
})
it('uses finished yield instead of raw quantity and includes source labor/overhead once', () => {
  const w = state(),
    recipe = parent(),
    prep = componentStock(source, w.ingredients)
  expect(prep.currentCost).toBe(0.1)
  expect(prep.quantity).toBe(0)
  w.ingredients.push(prep)
  validateRecipeComponents(recipe, w)
  expect(recipe.lines[0].productionMode).toBe('prepared_stock')
  expect(recipeCost(recipe, w.ingredients)).toBe(2.5)
  expect(w.ingredients[0].quantity).toBe(500)
})
it('requires supported yields and measured conversions without inventing density', () => {
  expect(() =>
    componentStock({ ...source, yieldUnit: 'loaves' }, [raw]),
  ).toThrow('No loaf')
  const w = state(),
    recipe = parent(),
    prep = componentStock(source, w.ingredients)
  w.ingredients.push(prep)
  recipe.lines[0].unit = 'oz'
  expect(() => validateRecipeComponents(recipe, w)).not.toThrow()
  recipe.lines[0].unit = 'cup'
  expect(() => validateRecipeComponents(recipe, w)).toThrow('conversion')
  prep.conversions = [
    { from: 'cup', to: 'g', amountFrom: 1, amountTo: 100, verified: true },
  ]
  expect(() => validateRecipeComponents(recipe, w)).not.toThrow()
})
it('rejects direct/transitive cycles, unavailable sources, mismatched links and make-with-parent requests', () => {
  const w = state(),
    r = parent()
  r.lines[0].componentRecipeId = r.id
  expect(() => validateRecipeComponents(r, w)).toThrow('itself')
  r.lines[0].componentRecipeId = 'frosting'
  w.recipes = [
    {
      ...source,
      lines: [
        {
          ingredientId: 'prep-cake',
          componentRecipeId: 'cake',
          quantity: 1,
          unit: 'each',
        },
      ],
    },
  ]
  expect(() => validateRecipeComponents(r, w)).toThrow('itself')
  expect(() =>
    validateRecipeComponents(parent(), { ...state(), recipes: [] }),
  ).toThrow('unavailable')
  const mode = parent()
  mode.lines[0].productionMode = 'make_with_parent'
  expect(() => validateRecipeComponents(mode, state())).toThrow(
    'prepared stock',
  )
})
it('normalizes legacy linked prep lines and derives transitive allergen provenance while retaining completed snapshots', () => {
  const w = state(),
    prep = componentStock(source, w.ingredients),
    recipe = parent()
  delete recipe.lines[0].componentRecipeId
  w.ingredients.push(prep)
  w.recipes.push(recipe)
  w.batches = [
    {
      id: 'done',
      name: 'Done',
      status: 'completed',
      historicalCost: 44,
      costSnapshot: { total: 44 },
    },
  ]
  validateRecipeComponents(recipe, w)
  const before = structuredClone(w.batches)
  rollup(w)
  expect(prep.componentAllergens).toEqual(['Milk'])
  expect(resolveLabelData(w, { kind: 'product', id: '' }).allergens).toEqual([])
  w.products = [
    {
      id: 'cake-product',
      name: 'Cake',
      recipeId: recipe.id,
      unitsPerPackage: 1,
    },
  ]
  expect(
    resolveLabelData(w, { kind: 'product', id: 'cake-product' }).allergens,
  ).toEqual(['Milk'])
  w.recipes[0] = { ...source, laborMinutes: 60 }
  rollup(w)
  expect(recipeCost(recipe, w.ingredients)).toBe(3.75)
  expect(w.batches).toEqual(before)
})

it('retains manual prep declarations and statements while refreshing derived source allergens', () => {
  const w = state()
  w.ingredients = [structuredClone(raw)]
  const prep: Item = {
    ...componentStock(source, w.ingredients),
    allergens: ['Egg'],
    reviewed: true,
    statement: 'House frosting',
    subingredients: 'Retained declaration',
  }
  w.ingredients.push(prep)
  rollup(w)
  expect(prep.componentAllergens).toEqual(['Milk'])
  expect(prep.componentReviewed).toBe(true)
  w.ingredients[0].allergens = ['Soy']
  w.ingredients[0].reviewed = false
  rollup(w)
  expect(prep.componentAllergens).toEqual(['Soy'])
  expect(prep.componentReviewed).toBe(false)
  expect(componentStock(source, w.ingredients)).toMatchObject({
    allergens: ['Egg'],
    reviewed: true,
    statement: 'House frosting',
    subingredients: 'Retained declaration',
  })
})
