import { expect, it } from 'vitest'
import { demoData } from './demo'
import {
  sectionCategories,
  assignedCategoryId,
  assertSectionCategoryAssignment,
} from './section-categories'
import { validateCategoryTree } from './category-details'
import { calculateTax, validateTaxRates, applicableTaxes } from './domain'

it('retains exact legacy pantry labels for review without reassigning any record', () => {
  const w = demoData()
  w.ingredients.push({
    id: 'cotton',
    name: 'Cotton',
    usedAs: 'material',
    materialCategory: 'Original label',
    category: 'Craft materials',
  })
  const before = structuredClone(w.ingredients)
  const options = sectionCategories(w, 'handmade-materials')
  const legacy = options.find((c) => c.name === 'Original label')!
  expect(legacy.needsReview).toBe(true)
  expect(
    assignedCategoryId(w.ingredients.at(-1)!, w, 'handmade-materials'),
  ).toBe(legacy.id)
  expect(
    sectionCategories(w, 'food-ingredients').some((c) => c.id === legacy.id),
  ).toBe(false)
  expect(w.ingredients).toEqual(before)
})
it('preserves archived assignments and legacy product scope while preventing new ones', () => {
  const w = demoData()
  w.settings[0].productCategories = [
    {
      id: 'archived',
      name: 'Old',
      scope: 'food-products',
      classification: 'food',
      active: false,
    },
    { id: 'legacy', name: 'Unreviewed', classification: null },
  ]
  const previous = { id: 'p', name: 'P', productCategoryId: 'archived' }
  expect(() =>
    assertSectionCategoryAssignment({ ...previous }, previous, w, 'products'),
  ).not.toThrow()
  expect(() =>
    assertSectionCategoryAssignment(
      { id: 'new', name: 'New', productCategoryId: 'archived' },
      undefined,
      w,
      'products',
    ),
  ).toThrow(/active category/)
  expect(
    sectionCategories(w, 'food-products').some((c) => c.id === 'legacy'),
  ).toBe(false)
  expect(() =>
    assertSectionCategoryAssignment(
      { id: 'new', name: 'New', productCategoryId: 'legacy' },
      undefined,
      w,
      'products',
    ),
  ).toThrow(/active category/)
})
it('rejects parent cycles and cross-section trees', () => {
  expect(() =>
    validateCategoryTree([
      { id: 'a', parentId: 'b', scope: 'packaging' },
      { id: 'b', parentId: 'a', scope: 'packaging' },
    ]),
  ).toThrow(/cycle/)
  expect(() =>
    validateCategoryTree([
      { id: 'a', parentId: 'b', scope: 'packaging' },
      { id: 'b', scope: 'food-ingredients' },
    ]),
  ).toThrow(/same section/)
})
it('keeps percent storage, compound/inclusive calculations and explicit zero distinct from blank', () => {
  const rate = {
    id: 'state',
    name: 'State',
    jurisdiction: 'Test',
    ratePercent: 8.25,
    behavior: 'exclusive' as const,
  }
  expect(validateTaxRates([{ ...rate, ratePercent: 0 }])[0].ratePercent).toBe(0)
  expect(() => validateTaxRates([{ ...rate, ratePercent: '' as any }])).toThrow(
    /enter 0 explicitly/i,
  )
  expect(calculateTax(100, [rate]).tax).toBe(8.25)
  expect(
    calculateTax(108.25, [{ ...rate, behavior: 'inclusive' }]).revenue,
  ).toBe(100)
  expect(
    calculateTax(100, [
      { ...rate, ratePercent: 5, order: 0 },
      { ...rate, id: 'city', ratePercent: 2, order: 1, compound: true },
    ]).tax,
  ).toBe(7.1)
  expect(
    applicableTaxes(
      { id: 'p', name: 'P' },
      { id: 'b', name: 'B', taxRates: [] },
    ),
  ).toEqual([])
})
