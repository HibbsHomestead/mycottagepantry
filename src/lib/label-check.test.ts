// @vitest-environment node
import { expect, it } from 'vitest'
import {
  blankLabel,
  newElement,
  resolveLabelData,
  type LabelDocument,
} from './label-studio'
import { labelLayout } from './label-sets'
import { checkLabelSet } from './label-check'
import type { Workspace } from './domain'
import { confirmFixtureAllergens } from '../test/fixtures/label-ingredient-review'

function fixture() {
  const w = {
    settings: [
      {
        id: 'business',
        name: 'Bakery',
        address: '12 Mill Rd',
        disclaimer: 'Home kitchen',
      },
    ],
    products: [{ id: 'p', name: 'Loaf', recipeId: 'r', netQuantity: '18 oz' }],
    recipes: [
      {
        id: 'r',
        name: 'Bread',
        reviewed: true,
        yield: 1,
        yieldUnit: 'g',
        lines: [{ ingredientId: 'flour', quantity: 100, unit: 'g' }],
      },
    ],
    ingredients: [
      {
        id: 'flour',
        name: 'Flour',
        unit: 'g',
        reviewed: true,
        allergens: ['Wheat'],
        subingredients: 'wheat, malt',
      },
    ],
    batches: [],
  } as unknown as Workspace
  confirmFixtureAllergens(w, w.products[0], ['Wheat'])
  const doc: LabelDocument = {
    ...blankLabel(),
    format: 'front-back',
    width: 432,
    height: 432,
    labelType: 'Finished-product front label',
    elements: ['product.name', 'product.netQuantity'].map((key) =>
      newElement('text', '', key),
    ),
  }
  doc.back = {
    ...labelLayout(doc),
    labelType: 'Finished-product full compliance label',
    elements: [
      'recipe.ingredients',
      'recipe.allergens',
      'business.name',
      'business.address',
      'business.disclaimer',
    ].map((key) => newElement('text', '', key)),
  }
  const data = () => resolveLabelData(w, { kind: 'product', id: 'p' })
  const issues = () => checkLabelSet(doc, data())
  return { w, doc, data, issues }
}
it('checks a verified front/back set with declarations only on Back and preserves source wording', () => {
  const { data, issues } = fixture()
  expect(data().values['recipe.ingredients']).toBe(
    'Ingredients: Flour (wheat, malt)',
  )
  expect(issues()).toEqual([])
})
it('uses exact ingredient IDs, deduplicates source issues, and respects saved review after unrelated edits', () => {
  const { w, issues } = fixture()
  w.ingredients.push({ id: 'duplicate-name', name: 'Flour', reviewed: false })
  w.ingredients[0].cost = 90
  expect(issues()).toEqual([])
  w.ingredients[0].reviewed = false
  const source = issues().filter((i) => i.group === 'Source data')
  const ingredientIssues = source.filter(
    (issue) => issue.record?.kind === 'ingredient',
  )
  expect(ingredientIssues).toHaveLength(1)
  expect(ingredientIssues[0].record).toEqual({
    kind: 'ingredient',
    id: 'flour',
  })
  expect(ingredientIssues[0].side).toBeUndefined()
  expect(
    source.some((issue) => /source changes need re-review/.test(issue.message)),
  ).toBe(true)
})
it('keeps genuinely missing names and required subingredients visible despite saved review', () => {
  const { w, issues } = fixture()
  Object.assign(w.ingredients[0], {
    name: '',
    statement: '',
    requiresSubingredients: true,
    subingredients: '',
  })
  expect(
    issues()
      .filter((i) => i.group === 'Source data')
      .map((i) => i.message)
      .join(' '),
  ).toMatch(/ingredient statement name/)
  expect(
    issues()
      .map((i) => i.message)
      .join(' '),
  ).toMatch(/saved review does not supply/)
})
it('expands a generated subrecipe stock record without demanding redundant wrapper verification', () => {
  const { w, data, issues } = fixture()
  w.recipes.push({
    id: 'prep',
    name: 'Prep',
    yield: 100,
    yieldUnit: 'g',
    lines: [{ ingredientId: 'flour', quantity: 100, unit: 'g' }],
  })
  w.ingredients.push({
    id: 'prep-stock',
    name: 'Prep',
    unit: 'g',
    compoundRecipeId: 'prep',
    reviewed: false,
  })
  w.recipes[0].lines = [
    { ingredientId: 'prep-stock', quantity: 100, unit: 'g' },
  ]
  confirmFixtureAllergens(w, w.products[0], ['Wheat'])
  expect(data().values['recipe.ingredients']).toBe(
    'Ingredients: Flour (wheat, malt)',
  )
  expect(issues()).toEqual([])
})
it('identifies unresolved bindings and stale manual statements on their actual side', () => {
  const { doc, data, issues } = fixture()
  doc.back!.elements[0].binding = 'recipe.retiredIngredients'
  expect(
    issues().find((i) => /cannot be resolved/.test(i.message)),
  ).toMatchObject({ side: 'back', elementId: doc.back!.elements[0].id })
  doc.back!.elements[0].binding = undefined
  doc.back!.elements[0].text = 'Ingredients: obsolete flour'
  expect(
    issues().some((i) => /manually entered ingredient/.test(i.message)),
  ).toBe(true)
  doc.back!.elements[0].text = data().values['recipe.ingredients']
  expect(issues()).toEqual([])
})
it('is independent of side selection, survives save/reopen serialization, and never mutates artwork or source', () => {
  const { doc, w, data, issues } = fixture()
  w.ingredients[0].reviewed = false
  const before = JSON.stringify({ doc, w })
  const first = issues()
  expect(checkLabelSet(JSON.parse(JSON.stringify(doc)), data())).toEqual(first)
  expect(issues()).toEqual(first)
  expect(JSON.stringify({ doc, w })).toBe(before)
})
