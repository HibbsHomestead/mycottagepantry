import { expect, test } from 'vitest'
import { productIngredientsFixture } from '../test/fixtures/product-ingredients'
import { productIngredients } from './product-ingredients'
import { resolveLabelData } from './label-studio'
import {
  assortmentJobCurrent,
  assortmentLabel,
  fixedAssortmentContents,
} from './assortment-labels'

test('uses the Label Studio statement for compound recipes and identifies missing reviews', () => {
  const { workspace, blueberry, ingredients, missing } =
    productIngredientsFixture()
  const section = productIngredients(workspace, blueberry)
  expect(section.data).toEqual(
    resolveLabelData(workspace, { kind: 'product', id: blueberry.id }),
  )
  expect(section.data?.values['recipe.ingredients']).toBe(
    'Ingredients: Muffin flour, blueberry fruit (blueberries, cane sugar)',
  )
  expect(section.issues).toEqual([])
  ingredients[1].subingredients = ''
  ingredients[1].reviewed = false
  expect(productIngredients(workspace, blueberry).issues).toEqual(
    expect.arrayContaining([
      'Subingredients missing for blueberry fruit.',
      'Ingredient statement not reviewed.',
      'Allergen information not confirmed.',
    ]),
  )
  expect(productIngredients(workspace, missing).issues).toContain(
    'No recipe linked.',
  )
})

test('keeps quantities, product statements and non-food contents separate, even in nested packs', () => {
  const { workspace, nested, pack, foodBasket } = productIngredientsFixture()
  const sections = productIngredients(workspace, nested).children!
  expect(sections[0].quantity).toBe('×2 · packaged')
  expect(
    sections[0].children?.map(({ name, quantity }) => [name, quantity]),
  ).toEqual([
    ['Blueberry muffins', '×3 · muffin'],
    ['Cranberry muffins', '×3 · muffin'],
  ])
  expect(sections[1].data?.nonFood).toBe(true)
  expect(
    productIngredients(workspace, foodBasket).children?.every(
      (child) => !!child.data?.values['recipe.ingredients'],
    ),
  ).toBe(true)
  pack.kitComponents.push({
    productId: nested.id,
    quantity: 1,
    basis: 'package',
  })
  expect(
    productIngredients(workspace, nested).children?.[0].children?.[2].issues[0],
  ).toMatch(/Circular contents/)
})

test('shares reviewed manufacturer wording and invalidates older review without rewriting snapshots', () => {
  const { workspace, tea, basket, ingredients } = productIngredientsFixture()
  const definition = fixedAssortmentContents(basket)
  const spec = {
    ...definition,
    name: basket.name,
    productId: basket.id,
    templateId: 'larger-stock',
    packagingId: 'stock',
    mode: 'fixed' as const,
    batchId: '',
    group: '',
    containers: 1,
    copies: 1,
    componentId: '',
  }
  const snapshot = assortmentLabel(workspace, spec).snapshot
  expect(snapshot.warnings).toEqual([])
  const supplierSection = snapshot.sections.find(
    (entry) => entry.productId === tea.id,
  )!
  expect(supplierSection.declaration).toBe(
    productIngredients(workspace, tea).data?.values['recipe.ingredients'],
  )
  expect(supplierSection.contains).toBe('Contains: Milk')
  expect(supplierSection.advisory).toBe('May contain soy.')
  const job = {
    id: 'job',
    name: basket.name,
    assortmentSpec: spec,
    assortmentSnapshot: structuredClone(snapshot),
  }
  expect(assortmentJobCurrent(workspace, job)).toBe(true)
  tea.supplierLabelSource = {
    ...tea.supplierLabelSource,
    source: 'Manufacturer package revision 3',
  }
  expect(assortmentJobCurrent(workspace, job)).toBe(false)
  expect(job.assortmentSnapshot).toEqual(snapshot)
  tea.supplierLabelSource = {
    ...tea.supplierLabelSource,
    source: 'New manufacturer package',
    reviewed: false,
  }
  expect(productIngredients(workspace, tea).issues).toContain(
    'Allergen information not confirmed.',
  )
  expect(assortmentJobCurrent(workspace, job)).toBe(false)
  expect(job.assortmentSnapshot).toEqual(snapshot)
  expect(ingredients[1].subingredients).toBe('blueberries, cane sugar')
})

test('uses updated recipe wording without modifying the previous label snapshot', () => {
  const { workspace, pack, blueberry, flour } = productIngredientsFixture()
  const spec = {
    ...fixedAssortmentContents(pack),
    name: pack.name,
    productId: pack.id,
    templateId: 'larger-stock',
    packagingId: pack.mixedLabelStockId,
    mode: 'fixed' as const,
    batchId: '',
    group: '',
    containers: 1,
    copies: 1,
    componentId: '',
  }
  const snapshot = assortmentLabel(workspace, spec).snapshot
  const job = {
    id: 'old-label',
    name: pack.name,
    assortmentSpec: spec,
    assortmentSnapshot: structuredClone(snapshot),
  }
  expect(assortmentJobCurrent(workspace, job)).toBe(true)
  flour.statement = 'Unbleached wheat flour'
  flour.reviewed = false
  const current = productIngredients(workspace, blueberry)
  expect(current.data?.ingredientStatementOverrides).toContainEqual({
    id: flour.id,
    name: flour.name,
  })
  expect(current.data?.values['recipe.ingredients']).toMatch(
    /Unbleached wheat flour/,
  )
  expect(current.issues).toContain('Ingredient statement not reviewed.')
  expect(assortmentJobCurrent(workspace, job)).toBe(false)
  expect(job.assortmentSnapshot.sections[0].declaration).toContain(
    'Muffin flour',
  )
})
