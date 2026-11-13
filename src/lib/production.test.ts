import { describe, expect, it } from 'vitest'
import { productionDefinition, productionRequirements } from './production'
import type { Item, Workspace } from './domain'
const flour: Item = {
  id: 'flour',
  name: 'Flour',
  unit: 'g',
  quantity: 1000,
  cost: 0.01,
}
const prep: Item = {
  id: 'prep',
  name: 'Prepared dough',
  unit: 'g',
  quantity: 500,
  cost: 0.03,
  compoundRecipeId: 'prep-recipe',
}
const base: Item = {
  id: 'base',
  name: 'Base',
  yield: 4,
  yieldUnit: 'each',
  laborMinutes: 5,
  laborRate: 12,
  lines: [{ ingredientId: 'flour', quantity: 100, unit: 'g' }],
}
const recipe: Item = {
  id: 'bread',
  name: 'Bread',
  yield: 4,
  yieldUnit: 'each',
  laborMinutes: 10,
  laborRate: 12,
  baseRecipeId: 'base',
  baseMultiplier: 1,
  lines: [
    { ingredientId: 'flour', quantity: 0.1, unit: 'kg' },
    { ingredientId: 'prep', quantity: 20, unit: 'g' },
  ],
}
const product: Item = {
  id: 'loaf',
  name: 'Loaf',
  recipeId: 'bread',
  workflow: 'food',
  price: 100,
  unitsPerPackage: 1,
}
const state: Workspace = {
  products: [product],
  recipes: [recipe, base],
  ingredients: [flour, prep],
}
const mapping: Item = {
  id: '',
  name: '',
  quantity: 1,
  unit: 'each',
  verified: true,
}
describe('product requirements', () => {
  it('aggregates shared base inputs across units and consumes prepared stock without expanding its recipe', () => {
    const d = productionDefinition(product, state, mapping)
    const r = productionRequirements(d, 3)
    expect(r.multiplier).toBe(0.75)
    expect(r.requirements.find((l) => l.itemId === 'flour')?.quantity).toBe(150)
    expect(r.requirements.find((l) => l.itemId === 'prep')?.quantity).toBe(15)
    expect(r.cost.labor).toBe(1.5)
  })
  it('pins definitions against later recipe/product edits', () => {
    const copy = structuredClone(state)
    const d = productionDefinition(copy.products[0], copy, mapping)
    copy.recipes[0].yield = 100
    copy.products[0].price = 200
    expect(productionRequirements(d, 3).multiplier).toBe(0.75)
    expect(d.product.price).toBe(100)
  })
  it('uses verified cross-category conversion and rejects absent or conflicting relationships', () => {
    const weighted = { ...recipe, yield: 1000, yieldUnit: 'g' }
    const s = { ...state, recipes: [weighted, base] }
    expect(() => productionDefinition(product, s, mapping)).toThrow(
      'verified unit conversion',
    )
    const d = productionDefinition(product, s, {
      ...mapping,
      conversions: [
        { from: 'each', to: 'g', amountFrom: 1, amountTo: 250, verified: true },
      ],
    })
    expect(productionRequirements(d, 3).multiplier).toBe(0.75)
    expect(() =>
      productionDefinition(product, s, { ...mapping, verified: false }),
    ).toThrow('Verify')
  })
  it('blocks missing recipe/yield and never rounds recipe scale into extra output', () => {
    expect(() =>
      productionDefinition({ ...product, recipeId: null }, state, mapping),
    ).toThrow('Missing recipe')
    expect(() =>
      productionDefinition(
        product,
        { ...state, recipes: [{ ...recipe, yield: 0 }, base] },
        mapping,
      ),
    ).toThrow('Recipe yield')
    expect(
      productionRequirements(productionDefinition(product, state, mapping), 1)
        .output,
    ).toBe(1)
    expect(() =>
      productionRequirements(
        productionDefinition(product, state, mapping),
        1.2,
      ),
    ).toThrow('whole')
  })
})
it('aggregates repeated ingredient lines even without a linked base before actual overrides', () => {
  const r = {
    ...recipe,
    baseRecipeId: undefined,
    lines: [
      { ingredientId: 'flour', quantity: 100, unit: 'g' },
      { ingredientId: 'flour', quantity: 0.1, unit: 'kg' },
    ],
  }
  const s = { ...state, recipes: [r] }
  const d = productionDefinition(product, s, mapping)
  const result = productionRequirements(d, 1, {
    id: '',
    name: '',
    usage: { flour: 70 },
  })
  expect(result.requirements).toHaveLength(1)
  expect(result.requirements[0].quantity).toBe(70)
  expect(result.cost.labor).toBe(0.5)
})
it('supports an explicitly verified named recipe yield without treating a loaf as each', () => {
  const r = { ...recipe, yieldUnit: 'loaves' }
  const s = { ...state, recipes: [r, base] }
  expect(() => productionDefinition(product, s, mapping)).toThrow(
    'verified yield conversion',
  )
  const d = productionDefinition(product, s, {
    ...mapping,
    unit: 'loaves',
    quantity: 1,
  })
  expect(productionRequirements(d, 3).multiplier).toBe(0.75)
})
it('counts actual material use and separately recorded material waste once', () => {
  const d = productionDefinition(product, state, mapping)
  const result = productionRequirements(d, 1, {
    id: '',
    name: '',
    usage: { flour: 60 },
    materialWaste: { flour: 5 },
  })
  expect(result.requirements.find((r) => r.itemId === 'flour')?.quantity).toBe(
    65,
  )
})
