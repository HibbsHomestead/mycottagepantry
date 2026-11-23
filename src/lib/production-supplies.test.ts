import { descriptionSource } from './product-description'
import { expect, it } from 'vitest'
import {
  costBreakdown,
  effectiveRecipeLines,
  recipeProductionLines,
  type Item,
  type Workspace,
} from './domain'
import { productionDefinition, productionRequirements } from './production'
import { resolveLabelData } from './label-studio'
const flour: Item = {
  id: 'food',
  name: 'Flour',
  unit: 'g',
  cost: 0.01,
  usedAs: 'ingredient',
  quantity: 1000,
  statement: 'Wheat flour',
  allergens: ['Wheat'],
  reviewed: true,
}
const liner: Item = {
  id: 'liner',
  name: 'Parchment liner',
  unit: 'each',
  cost: 0.025,
  currentCost: 0.025,
  usedAs: 'supply',
  quantity: 100,
}
const recipe: Item = {
  id: 'recipe',
  name: 'Muffins',
  yield: 12,
  yieldUnit: 'each',
  laborRate: 0,
  lines: [{ ingredientId: 'food', quantity: 120, unit: 'g' }],
  productionSupplies: [{ ingredientId: 'liner', quantity: 12, unit: 'each' }],
}
const product: Item = {
  id: 'product',
  name: 'Muffin',
  recipeId: 'recipe',
  workflow: 'food',
  unitsPerPackage: 1,
}
const workspace = (): Workspace =>
  ({
    settings: [{ id: 'business', name: 'Isolated test' }],
    recipes: [recipe],
    ingredients: [flour, liner],
    products: [product],
  }) as Workspace
it.each([
  [12, 12, 0.3, 0.025],
  [2, 2, 0.05, 0.025],
  [24, 3, 0.075, 0.003125],
])(
  'costs yield %s using %s supplies per batch without food contamination',
  (yieldCount, quantity, cost, perYield) => {
    const r: Item = {
      ...recipe,
      yield: yieldCount,
      productionSupplies: [{ ingredientId: liner.id, quantity, unit: 'each' }],
    }
    const c = costBreakdown(r, [flour, liner])
    expect(c.suppliesCost).toBeCloseTo(cost)
    expect(c.suppliesCost / c.actualYield).toBeCloseTo(perYield)
    expect(c.total).toBeCloseTo(1.2 + cost)
    expect(c.lines.map((l) => l.ingredientId)).toEqual(['food'])
    expect(effectiveRecipeLines(r)).toEqual(r.lines)
  },
)
it('scales stock requirements without mutating stock and consumes no supplies when assembling finished kits', () => {
  const w = workspace(),
    before = structuredClone(w)
  const d = productionDefinition(product, w, {
    quantity: 1,
    unit: 'each',
    verified: true,
  })
  const r = productionRequirements(d, 24)
  expect(r.requirements.find((l) => l.itemId === 'liner')).toMatchObject({
    quantity: 24,
    kind: 'ingredient',
    tracked: true,
  })
  expect(w).toEqual(before)
  expect(
    recipeProductionLines(recipe, w.ingredients).find(
      (l) => l.ingredientId === 'liner',
    ),
  ).toMatchObject({ quantity: 12, productionSupply: true })
  const kit = {
    id: 'kit',
    name: 'Kit',
    workflow: 'kit',
    kitComponents: [{ productId: 'product', quantity: 2, basis: 'package' }],
  }
  w.products.push(kit)
  const requirements = productionRequirements(
    productionDefinition(kit, w, {} as Item),
    1,
  ).requirements
  expect(requirements.some((l) => l.itemId === 'liner')).toBe(false)
})
it('distinguishes missing supply cost from genuine zero and respects non-tracked supplies', () => {
  expect(() =>
    costBreakdown(recipe, [
      flour,
      { ...liner, cost: '', currentCost: undefined },
    ]),
  ).toThrow('cost is missing')
  expect(
    costBreakdown(recipe, [flour, { ...liner, cost: 0, currentCost: 0 }])
      .suppliesCost,
  ).toBe(0)
  const w = workspace()
  w.ingredients = [flour, { ...liner, trackInventory: false }]
  expect(
    productionRequirements(
      productionDefinition(product, w, {
        quantity: 1,
        unit: 'each',
        verified: true,
      }),
      12,
    ).requirements.find((l) => l.itemId === 'liner')?.tracked,
  ).toBe(false)
})
it('rolls base supplies forward and restores separate food and supply costs without adding consumable waste', () => {
  const base = { ...recipe, id: 'base' }
  const variation = {
    ...recipe,
    id: 'variation',
    baseRecipeId: 'base',
    baseMultiplier: 2,
    productionSupplies: [],
    lines: [],
    wastePercent: 10,
  }
  const c = costBreakdown(variation, [flour, liner], {
    recipes: [base, variation],
  })
  expect(c.suppliesCost).toBeCloseTo(0.6)
  expect(c.waste).toBeCloseTo(0.24)
  expect(c.lines.every((l) => l.ingredientId === 'food')).toBe(true)
})
it('excludes non-edible supply names from recipe-linked label ingredients and allergens', () => {
  const w = workspace()
  const data = resolveLabelData(w, { kind: 'product', id: 'product' })
  expect(JSON.stringify(data)).not.toContain('Parchment liner')
  expect(JSON.stringify(data)).toContain('Wheat')
})

it('keeps separate cost allocations when the same packaging item has intentional production and package usage', () => {
  const w = workspace()
  w.ingredients = [flour, { ...liner, usedAs: 'packaging' }]
  const p = { ...product, packagingLines: [{ ingredientId: liner.id, quantity: 1, unit: 'each' }] }
  const c = costBreakdown(recipe, w.ingredients, { product: p })
  expect(c.suppliesCost).toBeCloseTo(.3)
  expect(c.packagingCost).toBeCloseTo(.3)
  expect(c.total).toBeCloseTo(1.8)
  const r = productionRequirements(productionDefinition(p, w, { quantity: 1, unit: 'each', verified: true }), 12)
  expect(r.requirements.find(line => line.itemId === liner.id)).toMatchObject({ quantity: 24, supplyQuantity: 12, packagingQuantity: 12 })
})
it('uses supported count conversions and excludes supplies from description-generation food context', () => {
  const r = { ...recipe, productionSupplies: [{ ingredientId: liner.id, quantity: 1, unit: 'dozen' }] }
  expect(costBreakdown(r, [flour, liner]).suppliesCost).toBeCloseTo(.3)
  expect(descriptionSource(product, workspace()).ingredients).toEqual(['Flour'])
})
