import { expect, it } from 'vitest'
import { demoData } from './demo'
import {
  blankLabel,
  elementText,
  newElement,
  resolveLabelData,
  type LabelDocument,
} from './label-studio'
import { labelLayout, labelSide } from './label-sets'
import { defaultSheet } from './label-print-layout'
import {
  assertSavedLabelOutput,
  duplicateSavedLabel,
  labelsForProduct,
  labelSource,
  manualLabelFields,
  sourceKey,
  validateSavedLabelContext,
} from './saved-labels'
function fixture() {
  const w = demoData()
  w.ingredients = [
    {
      id: 'milk',
      name: 'Milk',
      statement: 'Milk',
      allergens: ['Milk'],
      reviewed: true,
      unit: 'g',
    },
    {
      id: 'almond',
      name: 'Almond',
      statement: 'Almond',
      allergens: ['Tree nuts'],
      reviewed: true,
      unit: 'g',
    },
  ]
  w.recipes = [
    {
      id: 'dairy',
      name: 'Dairy',
      yield: 1,
      yieldUnit: 'each',
      lines: [{ ingredientId: 'milk', quantity: 100, unit: 'g' }],
    },
    {
      id: 'nuts',
      name: 'Nuts',
      yield: 1,
      yieldUnit: 'each',
      lines: [{ ingredientId: 'almond', quantity: 100, unit: 'g' }],
    },
  ]
  w.products = [
    {
      id: 'p1',
      name: 'Dairy loaf',
      recipeId: 'dairy',
      labelMainName: ' Custom loaf ',
    },
    { id: 'p2', name: 'Almond loaf', recipeId: 'nuts', labelMainName: ' \t ' },
  ]
  const source = { kind: 'product' as const, id: 'p1' }
  const document: LabelDocument = {
    ...blankLabel(),
    id: crypto.randomUUID(),
    name: 'Loaf',
    recordKind: 'label',
    workflowVersion: 1,
    source,
    productId: 'p1',
    revision: 7,
    renderVersion: 2,
    elements: [
      {
        ...newElement('text', '', 'product.displayName'),
        rotation: 83,
        font: 'Lora',
        color: '#abcdef',
      },
    ],
    format: 'front-back',
    back: {
      ...labelLayout(blankLabel()),
      width: 216,
      height: 144,
      elements: [
        newElement('text', '', 'recipe.ingredients'),
        newElement('text', '', 'recipe.allergens'),
        newElement('text', 'Keep refrigerated'),
      ],
    },
    manualTextReviewedFor: sourceKey(source),
    printSettings: {
      copies: 6,
      layout: defaultSheet,
      parts: 'both',
      order: 'paired',
      printingMethod: 'browser',
    },
  }
  w.label_templates = [document]
  return { w, document }
}
it('preserves the complete design, both sides, bindings and print context without sharing editable state', () => {
  const { document } = fixture()
  const before = structuredClone(document)
  const copy = duplicateSavedLabel(document, document.source!)
  expect(copy.id).not.toBe(document.id)
  expect(copy.revision).toBe(0)
  expect(copy.name).toBe('Loaf — Copy')
  expect(copy.elements).toEqual(document.elements)
  expect(copy.back).toEqual(document.back)
  expect(copy.printSettings).toEqual(document.printSettings)
  copy.elements[0].font = 'DM Sans'
  copy.back!.elements[0].rotation = 35
  copy.printSettings!.copies = 1
  expect(document).toEqual(before)
})
it('resolves both sides from the new product, preserves manual text and applies the optional-name fallback without storing it', () => {
  const { w, document } = fixture()
  const old = resolveLabelData(w, document.source!)
  const source = { kind: 'product' as const, id: 'p2' },
    copy = duplicateSavedLabel(document, source)
  const data = resolveLabelData(w, source)
  expect(old.values['recipe.ingredients']).toContain('Milk')
  expect(data.values['recipe.ingredients']).toContain('Almond')
  expect(data.values['recipe.ingredients']).not.toContain('Milk')
  expect(old.values['recipe.allergens']).toContain('MILK')
  expect(data.values['recipe.allergens']).not.toContain('MILK')
  expect(data.values['recipe.allergens']).toContain('TREE NUTS')
  expect(elementText(copy.elements[0], data)).toBe('Almond loaf')
  expect(elementText(labelSide(copy, 'back').elements[0], data)).toBe(
    data.values['recipe.ingredients'],
  )
  expect(w.products[1].labelMainName).toBe(' \t ')
  expect(copy.back!.elements[2].text).toBe('Keep refrigerated')
  expect(manualLabelFields(copy)).toEqual([
    {
      id: `back:${copy.back!.elements[2].id}`,
      side: 'back',
      text: 'Keep refrigerated',
    },
  ])
  expect(() => validateSavedLabelContext(w, copy)).toThrow(/manually entered/)
  copy.manualTextReviewedFor = sourceKey(source)
  expect(() => validateSavedLabelContext(w, copy)).not.toThrow()
})
it('preserves multiple explicit links and legacy assignments without guessing a source for shared or unlinked designs', () => {
  const { w, document } = fixture()
  const copy = duplicateSavedLabel(document, document.source!)
  w.label_templates.push(copy)
  expect(labelsForProduct(w, w.products[0]).map((d) => d.id)).toEqual([
    document.id,
    copy.id,
  ])
  const legacy = { ...blankLabel(), id: 'shared' }
  for (const p of w.products) p.labelDesignId = legacy.id
  expect(labelSource(w, legacy)).toEqual({ kind: 'product', id: '' })
  expect(labelSource(w, legacy, 'p2')).toEqual({ kind: 'product', id: 'p2' })
  expect(labelSource(w, { ...legacy, id: 'unlinked' })).toEqual({
    kind: 'product',
    id: '',
  })
  expect(labelsForProduct(w, w.products[1])).toEqual([])
})
it('rejects mismatched product/brand output and incompatible batch context rather than printing the old recipe', () => {
  const { w, document } = fixture()
  expect(() =>
    assertSavedLabelOutput(document, { kind: 'product', id: 'p2' }),
  ).toThrow(/Save this label/)
  expect(() =>
    assertSavedLabelOutput(document, document.source!, 'other-brand'),
  ).toThrow(/brand/)
  w.batches = [{ id: 'old-batch', name: 'Old batch', recipeId: 'dairy' }]
  const bad = {
    ...document,
    source: { kind: 'batch' as const, id: 'old-batch', productId: 'p2' },
    productId: 'p2',
  }
  expect(() => validateSavedLabelContext(w, bad)).toThrow(/batch recipe/)
})
