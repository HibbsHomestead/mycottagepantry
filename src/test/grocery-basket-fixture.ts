import type { Workspace } from '../lib/domain'
import { productionDefinition } from '../lib/production'

export function groceryBasketFixture(): Workspace {
  const state: Workspace = {
    ingredients: [
      {
        id: 'flour',
        name: 'Bread flour',
        unit: 'g',
        quantity: 100,
        cost: 0.01,
      },
      { id: 'fruit', name: 'Strawberries', unit: 'g', quantity: 0, cost: 0.02 },
      {
        id: 'jam',
        name: 'Prepared jam',
        unit: 'g',
        quantity: 30,
        cost: 0.03,
        compoundRecipeId: 'jam-prep',
      },
      {
        id: 'tin',
        name: 'Bun tins',
        unit: 'each',
        quantity: 1,
        cost: 0.4,
        usedAs: 'packaging',
      },
      {
        id: 'sleeve',
        name: 'Cookie sleeves',
        unit: 'each',
        quantity: 0,
        cost: 0.2,
        usedAs: 'packaging',
      },
      {
        id: 'box',
        name: 'Outer basket boxes',
        unit: 'each',
        quantity: 1,
        cost: 0.8,
        usedAs: 'packaging',
      },
    ],
    recipes: [
      {
        id: 'bun-recipe',
        name: 'Jam buns',
        yield: 12,
        yieldUnit: 'each',
        lines: [
          { ingredientId: 'flour', unit: 'g', quantity: 180 },
          { ingredientId: 'jam', unit: 'g', quantity: 60 },
        ],
      },
      {
        id: 'cookie-recipe',
        name: 'Shortbread',
        yield: 6,
        yieldUnit: 'each',
        lines: [{ ingredientId: 'flour', unit: 'g', quantity: 120 }],
      },
      {
        id: 'jam-prep',
        name: 'Jam prep',
        yield: 60,
        yieldUnit: 'g',
        lines: [{ ingredientId: 'fruit', unit: 'g', quantity: 90 }],
      },
    ],
    products: [
      {
        id: 'bun',
        name: 'Jam buns · 2-pack',
        workflow: 'food',
        recipeId: 'bun-recipe',
        unitsPerPackage: 2,
        quantity: 0,
        packagingLines: [{ ingredientId: 'tin', quantity: 1, unit: 'each' }],
      },
      {
        id: 'cookie',
        name: 'Shortbread · single',
        workflow: 'food',
        recipeId: 'cookie-recipe',
        unitsPerPackage: 1,
        quantity: 0,
        packagingLines: [{ ingredientId: 'sleeve', quantity: 1, unit: 'each' }],
      },
      {
        id: 'tea',
        name: 'Breakfast tea',
        workflow: 'resale',
        quantity: 1,
        purchaseDefaults: { itemsPerPack: 4, packPrice: 12, unit: 'box' },
      },
      {
        id: 'basket',
        name: 'Breakfast Basket',
        workflow: 'kit',
        kitComponents: [
          { productId: 'bun', quantity: 2, basis: 'package' },
          { productId: 'cookie', quantity: 1, basis: 'package' },
          { productId: 'tea', quantity: 1, basis: 'package' },
        ],
        packagingLines: [{ ingredientId: 'box', quantity: 1, unit: 'each' }],
      },
    ],
    batches: [],
    events: [{ id: 'market', name: 'Saturday Market' }],
    event_batch_links: [],
  }
  const definition = productionDefinition(state.products[3], state, {})
  state.batches.push({
    id: 'basket-run',
    name: 'Breakfast Basket',
    status: 'scheduled',
    eventId: 'market',
    date: '2026-11-25',
    lines: [
      {
        id: 'basket-line',
        name: 'Breakfast Basket',
        productId: 'basket',
        quantity: 3,
        definition,
        basketPlan: { bun: { stock: 0, wholeBatch: true }, tea: { stock: 1 } },
      },
    ],
  })
  return state
}

export function linkGroceryBasketBatch(state: Workspace) {
  const mapping = { quantity: 2, unit: 'each', verified: true }
  state.batches.push({
    id: 'shared-run',
    name: 'Shared market buns',
    status: 'scheduled',
    eventId: 'market',
    lines: [
      {
        id: 'bun-line',
        name: 'Jam buns · 2-pack',
        productId: 'bun',
        quantity: 12,
        mapping,
        definition: productionDefinition(state.products[0], state, mapping),
        basketAssignments: [{ runId: 'basket-run', quantity: 6 }],
      },
    ],
  })
}
