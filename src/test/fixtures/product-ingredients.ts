import type { Item } from '../../lib/domain'
import { mixedPackFixture } from './mixed-pack'
import { confirmFixtureAllergens } from './label-ingredient-review'

export function productIngredientsFixture() {
  const fixture = mixedPackFixture()
  const { workspace, recipes, ingredients, outputs, pack } = fixture
  const tea = workspace.products.find((product) => product.id === 'tea')!
  const basket = workspace.products.find(
    (product) => product.id === 'breakfast-fixture',
  )!
  const chocolate = workspace.products.find(
    (product) => product.id === 'chocolate',
  )!
  Object.assign(tea, {
    supplierLabelSource: {
      source: 'Tea tin manufacturer package, revision 2',
      declaration: 'Ingredients: black tea, milk powder',
      contains: 'Milk',
      advisory: 'May contain soy.',
      reviewed: true,
    },
  })
  basket.kitComponents.push({
    productId: chocolate.id,
    quantity: 1,
    basis: 'package',
  })
  ingredients[1].subingredients = 'blueberries, cane sugar'
  ingredients[1].requiresSubingredients = true
  workspace.ingredients.push({
    id: 'blueberry-prep-stock',
    name: 'Blueberry prep',
    unit: 'g',
    compoundRecipeId: 'blueberry-prep',
    cost: 0.03,
    quantity: 100,
  })
  workspace.recipes.push({
    id: 'blueberry-prep',
    name: 'Blueberry prep recipe',
    compound: true,
    yield: 100,
    yieldUnit: 'g',
    lines: [{ ingredientId: ingredients[1].id, quantity: 100, unit: 'g' }],
  })
  recipes[0].lines[1] = {
    ingredientId: 'blueberry-prep-stock',
    quantity: 60,
    unit: 'g',
  }
  confirmFixtureAllergens(workspace, outputs[0], ['Wheat'])
  confirmFixtureAllergens(workspace, fixture.wrapped, ['Wheat'])
  const missing: Item = {
    id: 'missing-recipe-fixture',
    name: 'Unlinked muffin',
    workflow: 'food',
    price: 4,
    quantity: 0,
  }
  workspace.products.push(missing)
  const foodBasket: Item = {
    ...basket,
    id: 'food-basket-fixture',
    name: 'Food-only picnic basket',
    kitComponents: [
      { productId: fixture.wrapped.id, quantity: 1, basis: 'package' },
      { productId: chocolate.id, quantity: 2, basis: 'package' },
    ],
  }
  const nested: Item = {
    ...basket,
    id: 'nested-fixture',
    name: 'Nested picnic basket',
    kitComponents: [
      { productId: pack.id, quantity: 2, basis: 'package' },
      { productId: 'tea-towel', quantity: 1, basis: 'package' },
    ],
  }
  workspace.products.push(nested, foodBasket)
  return {
    ...fixture,
    tea,
    basket,
    foodBasket,
    missing,
    nested,
    blueberry: outputs[0],
  }
}
