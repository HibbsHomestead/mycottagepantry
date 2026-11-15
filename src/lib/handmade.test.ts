import { expect, it } from 'vitest'
import { handmadeEstimate, handmadeBom, handmadeRequirements } from './handmade'
import { convert, productCosting, type Item, type Workspace } from './domain'
const bom = {
  id: 'bom',
  name: 'BOM',
  output: 4,
  laborMinutes: 30,
  laborRate: 12,
  overhead: 2,
  scrapPercent: 10,
  lines: [
    { ingredientId: 'cord', quantity: 1, unit: 'yd' },
    { ingredientId: 'beads', quantity: 4, unit: 'each' },
    { ingredientId: 'box', quantity: 4, unit: 'each' },
  ],
}
const product: Item = {
  id: 'ornament',
  name: 'Ornament',
  workflow: 'handmade',
  bom,
}
const state: Workspace = {
  ingredients: [
    { id: 'cord', name: 'Cord', usedAs: 'material', unit: 'ft', cost: 1 },
    { id: 'beads', name: 'Beads', usedAs: 'material', unit: 'each', cost: 0.5 },
    { id: 'box', name: 'Box', usedAs: 'packaging', unit: 'each', cost: 0.2 },
  ],
  recipes: [],
}
it('separates material, packaging, labor and overhead and costs actual lower yield', () => {
  const c = handmadeEstimate(product, state)
  expect(c.materials).toBeCloseTo(5.5)
  expect(c.packaging).toBeCloseTo(0.88)
  expect(c.labor).toBe(6)
  expect(c.overhead).toBe(2)
  expect(c.unit).toBeCloseTo(3.595)
  const actual = handmadeRequirements(bom, state.ingredients, 4, {
    id: '',
    name: '',
    output: 3,
    waste: 1,
    usage: { cord: 4, beads: 4, box: 3 },
    laborMinutes: 40,
  })
  expect(actual.requirements.map((l) => l.quantity)).toEqual([4, 4, 3])
  expect(actual.output).toBe(3)
  expect(actual.cost.labor).toBe(8)
})
it('does not manufacture costs, density or sheet-to-piece conversions', () => {
  expect(() =>
    handmadeEstimate(product, {
      ...state,
      ingredients: state.ingredients.map((i) =>
        i.id === 'cord' ? { ...i, cost: undefined } : i,
      ),
    }),
  ).toThrow('cost missing')
  expect(() => convert(1, 'ml', 'g')).toThrow()
  expect(() => convert(1, 'sheet', 'each')).toThrow()
  expect(convert(2, 'sheet', 'sheet')).toBe(2)
  expect(convert(1, 'yd', 'ft')).toBeCloseTo(3)
})
it('keeps legacy designs intact and does not classify food by name', () => {
  const legacy = {
    ...bom,
    id: 'legacy-design',
    workflow: 'handmade',
    yield: 4,
  }
  const s = {
    ...state,
    recipes: [legacy, { id: 'food', name: 'Handmade bread', workflow: 'food' }],
  }
  const before = structuredClone(s)
  expect(
    handmadeBom(
      { id: 'old-product', name: 'Old item', recipeId: legacy.id },
      s,
    ),
  ).toMatchObject({ output: 4, legacy: true })
  expect(
    handmadeBom({ id: 'bread', name: 'Handmade bread', recipeId: 'food' }, s),
  ).toBeUndefined()
  expect(s).toEqual(before)
})

it('exposes the same complete breakdown in shared catalog costing', () => {
  const c = productCosting(product, state)
  expect(c.packages).toBe(4)
  expect(c.ingredient).toBeCloseTo(5.5)
  expect(c.packagingCost).toBeCloseTo(0.88)
  expect(c.labor).toBe(6)
  expect(c.overhead).toBe(2)
  expect(c.perPackage).toBeCloseTo(3.595)
})
it('retains legacy fabric width and precut restrictions on BOM adoption', () => {
  const fabric = {
    ...state.ingredients[0],
    materialType: 'fabric',
    fabricTracking: 'length',
    fabricWidth: 24,
    widthUnit: 'in',
  }
  expect(() =>
    handmadeEstimate(
      {
        ...product,
        bom: {
          ...bom,
          lines: [
            {
              ingredientId: 'cord',
              quantity: 1,
              unit: 'yd',
              minimumWidth: 36,
              widthUnit: 'in',
            },
          ],
        },
      },
      { ...state, ingredients: [fabric] },
    ),
  ).toThrow('narrower')
  expect(() =>
    handmadeEstimate(product, {
      ...state,
      ingredients: state.ingredients.map((i) =>
        i.id === 'cord'
          ? { ...i, materialType: 'fabric', fabricTracking: 'precut' }
          : i,
      ),
    }),
  ).toThrow('count')
})
