import { expect, it } from 'vitest'
import { consolidateCategories } from './category-consolidation'
import { recipeCategories, assignRecipeCategory } from './recipe-categories'
import type { Item, Workspace } from './domain'
it('preserves destinations, references, custom categories and repeat safety', () => {
  const state: Workspace = {
    settings: [
      {
        id: 'settings',
        name: 'Settings',
        recipeCategories: [
          {
            id: 'old',
            name: 'Breads',
            icon: 'bread',
            active: true,
            previousNames: [],
          },
          {
            id: 'dest',
            name: 'Breads & Rolls',
            icon: 'bread',
            active: true,
            previousNames: [],
          },
          {
            id: 'fill',
            name: 'Fillings',
            icon: 'filling',
            active: true,
            previousNames: [],
          },
          {
            id: 'prep',
            name: 'Preps & fillings',
            icon: 'filling',
            active: true,
            previousNames: [],
          },
          {
            id: 'frost',
            name: 'Frostings, Icings & Glazes',
            icon: 'frosting',
            active: true,
            previousNames: [],
          },
          {
            id: 'custom',
            name: 'Bread specials',
            icon: 'bread',
            active: true,
            previousNames: [],
          },
        ],
        productCategories: [
          { id: 'cake', name: 'Cakes', classification: 'food' },
          { id: 'cake-dest', name: 'Cakes & Cupcakes', classification: 'food' },
        ],
      },
    ],
    recipes: [
      { id: 'a', name: 'A', category: 'Breads', recipeCategoryId: 'old' },
      { id: 'b', name: 'B', category: ' FILLINGS ' },
      {
        id: 'c',
        name: 'C',
        category: 'Preps & fillings',
        recipeCategoryId: 'prep',
      },
    ],
    products: [
      { id: 'p', name: 'P', productCategoryId: 'cake', category: 'Cakes' },
    ],
  }
  const result = consolidateCategories(state)
  expect(state.recipes[0].recipeCategoryId).toBe('dest')
  expect(state.products[0].productCategoryId).toBe('cake-dest')
  expect(state.recipes.slice(1).map((r) => r.category)).toEqual([
    'Preps, Fillings & Toppings',
    'Preps, Fillings & Toppings',
  ])
  expect(
    state.settings[0].recipeCategories.find((c: any) => c.id === 'frost').name,
  ).toBe('Frostings, Icings & Glazes')
  expect(
    state.settings[0].recipeCategories.find((c: any) => c.id === 'custom').name,
  ).toBe('Bread specials')
  expect(result.counts).toEqual({
    'Breads & Rolls': 1,
    'Preps, Fillings & Toppings': 2,
    'Cakes & Cupcakes': 1,
  })
  const snapshot = JSON.stringify(state)
  expect(consolidateCategories(state).changes).toHaveLength(0)
  expect(JSON.stringify(state)).toBe(snapshot)
  expect(state.recipes).toHaveLength(3)
  expect(
    assignRecipeCategory(
      { ...state.recipes[0] },
      state.recipes[0],
      recipeCategories(state),
    ).recipeCategoryId,
  ).toBe('dest')
})
it('keeps businesses and scopes separate and initializes only canonical defaults', () => {
  const state: Workspace = {
    settings: [
      {
        id: 's',
        name: 'Settings',
        productCategories: [
          { id: 'food', name: 'Breads', scope: 'food', classification: 'food' },
          {
            id: 'craft',
            name: 'Breads & Rolls',
            scope: 'handmade',
            classification: 'non_food',
          },
        ],
      },
    ],
    products: [],
    recipes: [],
  }
  consolidateCategories(state)
  expect(state.settings[0].productCategories).toHaveLength(2)
  const names = recipeCategories({ settings: [], recipes: [] }).map(
    (c) => c.name,
  )
  expect(names).toContain('Preps, Fillings & Toppings')
  for (const name of ['Breads', 'Cakes', 'Fillings', 'Preps & fillings'])
    expect(names).not.toContain(name)
})

it('recovers referenced implicit default IDs from older recipe dropdowns', () => {
  const state: Workspace = {
    settings: [{ id: 's', name: 'Settings' }],
    recipes: [
      {
        id: 'legacy',
        name: 'Legacy loaf',
        category: 'Breads',
        recipeCategoryId: 'recipe-breads',
      },
    ],
    products: [],
  }
  consolidateCategories(state)
  expect(state.recipes[0].recipeCategoryId).toBe('recipe-breads%20%26%20rolls')
  expect(
    state.settings[0].recipeCategories.some(
      (c: Item) => c.id === state.recipes[0].recipeCategoryId,
    ),
  ).toBe(true)
})

it('does not synchronize unrelated historical category text during cleanup', () => {
  const state: Workspace = {
    settings: [
      {
        id: 's',
        name: 'Settings',
        productCategories: [
          {
            id: 'custom',
            name: 'Holiday Boxes',
            classification: 'food',
            previousNames: ['Market boxes'],
          },
        ],
      },
    ],
    products: [
      {
        id: 'p',
        name: 'Box',
        category: 'Market boxes',
        productCategoryId: 'custom',
      },
    ],
    recipes: [],
  }
  expect(consolidateCategories(state).changes).toHaveLength(0)
  expect(state.products[0].category).toBe('Market boxes')
})

it('redirects inventory category mirrors without changing stock or cost', () => {
  const state: Workspace = {
    settings: [
      {
        id: 's',
        name: 'Settings',
        pantryCategories: [
          { id: 'old', name: 'Fillings', scope: 'food-ingredients' },
          {
            id: 'dest',
            name: 'Preps, Fillings & Toppings',
            scope: 'food-ingredients',
          },
        ],
      },
    ],
    recipes: [],
    products: [],
    ingredients: [
      {
        id: 'prep',
        name: 'Prep',
        category: 'Fillings',
        sectionCategoryId: 'old',
        categoryId: 'old',
        quantity: 7,
        cost: 0.34,
      },
    ],
  }
  consolidateCategories(state)
  expect(state.ingredients[0]).toMatchObject({
    category: 'Preps, Fillings & Toppings',
    sectionCategoryId: 'dest',
    categoryId: 'dest',
    quantity: 7,
    cost: 0.34,
  })
  expect(consolidateCategories(state).changes).toHaveLength(0)
})
