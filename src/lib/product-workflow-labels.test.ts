import { expect, it } from 'vitest'
import { demoData } from './demo'
import {
  blankLabel,
  checkLabel,
  newElement,
  resolveLabelData,
} from './label-studio'
import { dashboardData } from './dashboard'
it('keeps craft materials out of food declarations and allergen requirements without changing food labels', () => {
  const w = demoData()
  const foodBefore = resolveLabelData(w, {
    kind: 'product',
    id: w.products[0].id,
  })
  w.ingredients.push({
    id: 'fabric',
    name: 'Cotton fabric',
    usedAs: 'material',
    unit: 'm',
    quantity: 10,
    cost: 4,
    threshold: 2,
  })
  w.recipes.push({
    id: 'design',
    name: 'Blanket design',
    workflow: 'handmade',
    yield: 1,
    lines: [{ ingredientId: 'fabric', quantity: 1, unit: 'm' }],
  })
  w.products.push({
    id: 'blanket',
    name: 'Handmade blanket',
    workflow: 'handmade',
    recipeId: 'design',
  })
  const data = resolveLabelData(w, { kind: 'product', id: 'blanket' })
  expect(data.nonFood).toBe(true)
  expect(data.ingredientParts).toEqual([])
  expect(data.values['recipe.ingredients']).toBe('')
  expect(data.values['recipe.allergens']).toBe('')
  expect(data.values['business.disclaimer']).toBe('')
  expect(data.warnings.join(' ')).not.toMatch(/allergen|ingredient|weight/)
  const label = {
    ...blankLabel(),
    labelType: 'Cottage-food compliance label',
    elements: [newElement('text', '', 'product.name')],
  }
  expect(checkLabel(label, data).join(' ')).not.toMatch(
    /Ingredient statement|Cottage-food disclaimer|Net quantity/,
  )
  expect(
    resolveLabelData(w, { kind: 'product', id: w.products[0].id }),
  ).toEqual(foodBefore)
  expect(
    resolveLabelData(w, { kind: 'ingredient', id: 'fabric' }).nonFood,
  ).toBe(true)
  expect(dashboardData(w).ingredients.some((i) => i.id === 'fabric')).toBe(
    false,
  )
})
it('uses explicit resale category classification for food label review, independently of receiving workflow', () => {
  const w = demoData()
  w.settings[0].productCategories = [
    { id: 'food', name: 'Food', classification: 'food' },
    { id: 'nonfood', name: 'Homewares', classification: 'non_food' },
  ]
  w.products.push(
    {
      id: 'resale-food',
      name: 'Purchased jam',
      workflow: 'resale',
      productCategoryId: 'food',
    },
    {
      id: 'resale-towel',
      name: 'Purchased towel',
      workflow: 'resale',
      productCategoryId: 'nonfood',
    },
  )
  expect(
    resolveLabelData(w, { kind: 'product', id: 'resale-food' }).nonFood,
  ).toBe(false)
  expect(
    resolveLabelData(w, { kind: 'product', id: 'resale-towel' }).nonFood,
  ).toBe(true)
})
