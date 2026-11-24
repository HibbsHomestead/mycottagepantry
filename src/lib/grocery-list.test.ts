import { describe, expect, it } from 'vitest'
import {
  emptyGrocerySources,
  generateGroceryList,
  groceryGroups,
  groceryText,
  type GrocerySources,
} from './grocery-list'
import { mergeGroceryMarks } from './grocery-sync'
import { productionDefinition } from './production'
import type { Workspace } from './domain'

const date = '2026-11-23T13:00:00.000Z'
const fixture = (): Workspace => ({
  ingredients: [
    {
      id: 'flour',
      name: 'Bread flour',
      unit: 'g',
      quantity: 180,
      amountPerPackage: 500,
      currentCost: 0.012,
      vendorId: 'market',
      category: 'Flour',
    },
    { id: 'salt', name: 'Sea salt', unit: 'g', quantity: 50 },
    {
      id: 'cream',
      name: 'Frozen cream portions',
      unit: 'g',
      quantity: 50,
      compoundRecipeId: 'creamRecipe',
    },
    {
      id: 'filling',
      name: 'Prepared filling',
      unit: 'g',
      quantity: 20,
      compoundRecipeId: 'fillingRecipe',
    },
    {
      id: 'oil',
      name: 'Oil',
      unit: 'g',
      quantity: 100,
      conversions: [
        { from: 'cup', to: 'g', amountFrom: 1, amountTo: 300, verified: false },
      ],
    },
    {
      id: 'tins',
      name: 'Paper tins',
      unit: 'each',
      quantity: 2,
      usedAs: 'packaging',
    },
    {
      id: 'liner',
      name: 'Baking liners',
      unit: 'each',
      quantity: 1,
      usedAs: 'supply',
    },
    {
      id: 'old',
      name: 'Archived spice',
      unit: 'g',
      quantity: 5,
      archived: true,
    },
  ],
  recipes: [
    {
      id: 'base',
      name: 'Dough base',
      yield: 10,
      yieldUnit: 'each',
      lines: [{ ingredientId: 'flour', quantity: 100, unit: 'g' }],
    },
    {
      id: 'buns',
      name: 'Buns',
      yield: 10,
      yieldUnit: 'each',
      baseRecipeId: 'base',
      baseMultiplier: 1,
      lines: [
        { ingredientId: 'filling', quantity: 100, unit: 'g' },
        { ingredientId: 'salt', quantity: 5, unit: 'g' },
      ],
      productionSupplies: [
        { ingredientId: 'liner', quantity: 1, unit: 'each' },
      ],
    },
    {
      id: 'rolls',
      name: 'Rolls',
      yield: 8,
      yieldUnit: 'each',
      lines: [
        { ingredientId: 'flour', quantity: 0.25, unit: 'kg' },
        { ingredientId: 'filling', quantity: 50, unit: 'g' },
        { ingredientId: 'oil', quantity: 1, unit: 'cup' },
        { ingredientId: 'old', quantity: 1, unit: 'g' },
        {
          ingredientId: 'missing',
          name: 'Removed beans',
          quantity: 4,
          unit: 'g',
        },
      ],
    },
    {
      id: 'fillingRecipe',
      name: 'Filling',
      yield: 100,
      yieldUnit: 'g',
      lines: [{ ingredientId: 'cream', quantity: 80, unit: 'g' }],
    },
    {
      id: 'creamRecipe',
      name: 'Cream',
      yield: 100,
      yieldUnit: 'g',
      lines: [{ ingredientId: 'flour', quantity: 200, unit: 'g' }],
    },
  ],
  products: [
    {
      id: 'boxed',
      name: 'Boxed buns',
      workflow: 'food',
      recipeId: 'buns',
      packagingLines: [{ ingredientId: 'tins', quantity: 1, unit: 'each' }],
    },
  ],
  vendors: [{ id: 'market', name: 'Mill Market' }],
  batches: [],
  events: [],
  event_batch_links: [],
})
const generate = (state: Workspace, patch: Partial<GrocerySources>) =>
  generateGroceryList(
    state,
    { ...emptyGrocerySources, ...patch },
    'snapshot',
    date,
  )
const batches = (id: string, amount = 1) => ({
  id,
  amount,
  basis: 'batches' as const,
})

describe('grocery snapshot', () => {
  it('rolls across recipe batches, linked bases and nested prep without spending the same stock twice', () => {
    const state = fixture()
    const before = structuredClone(state)
    const list = generate(state, {
      recipes: [batches('buns', 2), { id: 'rolls', amount: 8, basis: 'yield' }],
    })
    expect(list.prep).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'filling',
          needed: 250,
          onHand: 20,
          toMake: 230,
        }),
        expect.objectContaining({
          id: 'cream',
          needed: 184,
          onHand: 50,
          toMake: 134,
        }),
      ]),
    )
    const flour = list.lines.find((line) => line.name === 'Bread flour')!
    expect(flour).toMatchObject({
      needed: 718,
      onHand: 180,
      toBuy: 538,
      packages: 2,
      leftover: 462,
      estimate: 12,
      vendor: 'Mill Market',
    })
    expect(flour.sources).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Dough base'),
        expect.stringContaining('Rolls'),
        expect.stringContaining('Filling → Cream'),
      ]),
    )
    expect(list.lines.find((line) => line.name === 'Sea salt')).toMatchObject({
      needed: 10,
      onHand: 50,
      toBuy: 0,
    })
    expect(
      list.lines.find((line) => line.name === 'Baking liners')?.estimate,
    ).toBeUndefined()
    expect(list.lines.find((line) => line.name === 'Oil')).toMatchObject({
      needed: 1,
      unit: 'cup',
      onHand: 100,
      onHandUnit: 'g',
      review: expect.stringContaining('Needs unit review'),
    })
    expect(
      list.lines.find((line) => line.name === 'Oil')?.toBuy,
    ).toBeUndefined()
    expect(
      list.lines.find((line) => line.name === 'Archived spice')?.review,
    ).toContain('reference only')
    expect(
      list.lines.find((line) => line.name === 'Removed beans')?.review,
    ).toContain('reference only')
    expect(
      groceryGroups(list.lines, 'vendor').map((group) => group.label),
    ).toContain('Ingredients · No vendor')
    expect(
      groceryGroups(list.lines, 'category').map((group) => group.label),
    ).toContain('Ingredients · Flour')
    expect(groceryText(list, 'vendor')).toContain('make 134 g; 50 g on hand')
    expect(state).toEqual(before)
  })

  it('uses saved run yield and event allocations without counting a run twice', () => {
    const state = fixture()
    const mapping = { quantity: 2, unit: 'each', verified: true }
    const definition = productionDefinition(state.products[0], state, mapping)
    const line = {
      id: 'line',
      name: 'Boxed buns',
      productId: 'boxed',
      quantity: 10,
      definition,
      mapping,
    }
    state.batches = [
      {
        id: 'run',
        name: 'Market bake',
        date: '2026-11-24',
        status: 'scheduled',
        productionVersion: 3,
        lines: [line],
      },
      {
        id: 'completed',
        name: 'Earlier bake',
        date: '2026-11-24',
        status: 'completed',
        productionVersion: 3,
        lines: [line],
      },
    ]
    state.events = [{ id: 'event', name: 'Saturday Market' }]
    state.event_batch_links = [
      {
        id: 'link',
        name: 'Market bake',
        eventId: 'event',
        recordId: 'run',
        allocations: [{ lineId: 'line', productId: 'boxed', quantity: 3 }],
      },
    ]
    state.recipes.find((recipe) => recipe.id === 'buns')!.yield = 20
    const event = generate(state, { events: ['event'] })
    expect(event.lines.find((row) => row.kind === 'Packaging')).toMatchObject({
      needed: 3,
      onHand: 2,
      toBuy: 1,
    })
    expect(event.lines.find((row) => row.name === 'Sea salt')).toMatchObject({
      needed: 3,
      sources: [expect.stringContaining('Saturday Market')],
    })
    const full = generate(state, {
      runs: ['run'],
      from: '2026-11-24',
      to: '2026-11-24',
      events: ['event'],
    })
    expect(full.lines.find((row) => row.kind === 'Packaging')?.needed).toBe(10)
    expect(full.lines.find((row) => row.name === 'Sea salt')?.needed).toBe(10)
    expect(full.labels).not.toContain('Earlier bake')
    state.event_batch_links[0].allocations[0].quantity = 0.5
    const partial = generate(state, { events: ['event'] })
    expect(partial.lines.find((row) => row.kind === 'Packaging')?.needed).toBe(
      0.5,
    )
  })

  it('rounds only known packages in the canonical stock unit and prefers newer known prices', () => {
    const state = fixture()
    const flour = state.ingredients[0]
    Object.assign(flour, {
      purchaseUnit: 'lb',
      purchaseQuantity: 25,
      amountPerPackage: undefined,
      lastPurchaseDate: '2026-11-19',
    })
    const selected = { recipes: [batches('rolls', 3)] }
    const flourRow = () =>
      generate(state, selected).lines.find(
        (line) => line.id && line.name === flour.name,
      )!
    expect(flourRow().packages).toBeUndefined()
    Object.assign(flour, {
      purchaseUnit: 'bag',
      storageUnit: 'kg',
      amountPerPackage: 0.5,
      conversions: [
        { from: 'bag', to: 'kg', amountFrom: 1, amountTo: 0.5, verified: true },
      ],
      purchaseOffers: [
        {
          preferred: true,
          vendor: 'Mill Market',
          currency: 'USD',
          purchaseQuantity: 1,
          purchaseUnit: 'bag',
          packagePrice: 4,
          priceCheckedAt: '2026-11-18',
        },
      ],
    })
    expect(flourRow()).toMatchObject({ packages: 2, estimate: 12 })
    flour.purchaseOffers[0].priceCheckedAt = '2026-11-20'
    expect(flourRow()).toMatchObject({ packages: 2, estimate: 8 })
  })

  it('keeps fully covered prepared stock out of purchases and reports empty and circular recipes', () => {
    const state = fixture()
    state.ingredients.find((item) => item.id === 'filling')!.quantity = 999
    const covered = generate(state, { recipes: [batches('buns')] })
    expect(covered.prep[0]).toMatchObject({ onHand: 999, toMake: 0 })
    expect(covered.lines.every((line) => line.toBuy === 0)).toBe(true)
    state.recipes.find((recipe) => recipe.id === 'fillingRecipe')!.lines = [
      { ingredientId: 'filling', quantity: 10, unit: 'g' },
    ]
    expect(generate(state, { recipes: [batches('buns')] }).warnings[0]).toMatch(
      /cannot contain itself/,
    )
    state.recipes.push({
      id: 'empty',
      name: 'Empty loaf',
      yield: 1,
      yieldUnit: 'each',
    })
    expect(
      generate(state, { recipes: [batches('empty')] }).warnings[0],
    ).toMatch(/no recipe ingredients/)
    expect(() => generate(state, {})).toThrow(/select at least one/i)
  })

  it('merges reordered and repeated check changes without adding rows', () => {
    const early = { row: 'flour', checked: true, at: 10, token: 'first' }
    const latest = { row: 'flour', checked: false, at: 11, token: 'second' }
    expect(mergeGroceryMarks({}, [latest, early, latest])).toEqual({
      flour: latest,
    })
    expect(mergeGroceryMarks({}, [{ ...early, at: 11 }, latest])).toEqual({
      flour: latest,
    })
  })
})
