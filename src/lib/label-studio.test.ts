// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import {
  blankLabel,
  newElement,
  resolveLabelData,
  validateLabelDocument,
  checkLabel,
  elementVisible,
  systemLabelTemplates,
  measureLabelText,
  wrapLabelText,
  type LabelData,
} from './label-studio'
import { exportLabelPdf, defaultSheet, validateSheet } from './label-export'
import type { Workspace } from './domain'
const workspace = (): Workspace => ({
  settings: [
    {
      id: 'business',
      name: 'Mallow & Grain',
      address: '11 Orchard Lane',
      disclaimer: 'Made in a home kitchen',
    },
  ],
  products: [
    {
      id: 'loaf',
      name: 'Country loaf',
      recipeId: 'bread',
      price: 8,
      netQuantity: 'Net Wt. 18 oz',
    },
  ],
  recipes: [
    {
      id: 'bread',
      name: 'Bread',
      yield: 1,
      yieldUnit: 'loaf',
      lines: [
        { ingredientId: 'sugar', quantity: 20, unit: 'g' },
        { ingredientId: 'flour', quantity: 1, unit: 'lb' },
      ],
    },
  ],
  ingredients: [
    {
      id: 'sugar',
      name: 'Sugar',
      statement: 'Cane sugar',
      unit: 'g',
      reviewed: true,
      allergens: [],
    },
    {
      id: 'flour',
      name: 'Flour',
      statement: 'Bread flour',
      subingredients: 'wheat flour, malt',
      unit: 'g',
      reviewed: true,
      allergens: ['Wheat'],
    },
  ],
  batches: [],
})
it('orders verified weights and preserves subingredients without making an allergen-free claim', () => {
  const w = workspace(),
    data = resolveLabelData(w, { kind: 'product', id: 'loaf' })
  expect(data.values['recipe.ingredients']).toBe(
    'Ingredients: Bread flour (wheat flour, malt), Cane sugar',
  )
  expect(data.values['recipe.allergens']).toBe('CONTAINS: WHEAT')
  expect(data.weightsVerified).toBe(true)
  w.ingredients[1].allergens = []
  expect(
    resolveLabelData(w, { kind: 'product', id: 'loaf' }).values[
      'recipe.allergens'
    ],
  ).toBe('')
  expect(data.warnings.join(' ')).toContain('finished-product order')
})
it('uses actual normalized batch usage with its matching unit', () => {
  const w = workspace()
  w.batches = [
    {
      id: 'run',
      name: 'Actual bake',
      recipeId: 'bread',
      date: '2026-10-28',
      costSnapshot: {
        lines: [
          {
            ingredientId: 'flour',
            quantity: 1,
            unit: 'lb',
            normalized: 453.59237,
            storageUnit: 'g',
          },
          {
            ingredientId: 'sugar',
            quantity: 20,
            unit: 'g',
            normalized: 20,
            storageUnit: 'g',
          },
        ],
      },
    },
  ]
  const data = resolveLabelData(w, {
    kind: 'batch',
    id: 'run',
    productId: 'loaf',
  })
  expect(data.ingredientParts[0].weight).toBeCloseTo(453.59237)
  expect(data.values['batch.number']).toBe('run')
})
it('never invents density, missing declarations, or allergen review', () => {
  const w = workspace()
  w.recipes[0].lines[1].unit = 'cup'
  w.ingredients[1].reviewed = false
  w.ingredients[1].statement = ''
  w.ingredients[1].requiresSubingredients = true
  w.ingredients[1].subingredients = ''
  const data = resolveLabelData(w, { kind: 'product', id: 'loaf' })
  expect(data.weightsVerified).toBe(false)
  expect(data.warnings.join(' ')).toMatch(/verified weight conversion/)
  expect(data.warnings.join(' ')).toContain('verify allergens')
  expect(data.warnings.join(' ')).toContain('subingredients')
})
it('expands compound ingredients and prevents cycles', () => {
  const w = workspace()
  w.ingredients.push({
    id: 'prep',
    name: 'Filling',
    unit: 'g',
    statement: 'Filling',
    compoundRecipeId: 'filling',
    reviewed: true,
  })
  w.recipes.push({
    id: 'filling',
    name: 'Filling',
    yield: 100,
    yieldUnit: 'g',
    lines: [{ ingredientId: 'sugar', quantity: 100, unit: 'g' }],
  })
  w.recipes[0].lines = [{ ingredientId: 'prep', quantity: 50, unit: 'g' }]
  expect(
    resolveLabelData(w, { kind: 'product', id: 'loaf' }).ingredientParts[0],
  ).toMatchObject({ name: 'Cane sugar', weight: 50 })
  w.recipes[1].lines = [{ ingredientId: 'prep', quantity: 100, unit: 'g' }]
  expect(
    resolveLabelData(w, { kind: 'product', id: 'loaf' }).warnings.join(' '),
  ).toContain('cyclic')
})
it('validates editable structure and flags print risks', () => {
  const d = blankLabel()
  d.name = 'Small label'
  const e = newElement('text', 'Long text '.repeat(30))
  e.x = -3
  e.fontSize = 6
  e.height = 8
  d.elements = [e]
  expect(validateLabelDocument(d).isSystem).toBe(false)
  const data = resolveLabelData(workspace(), { kind: 'product', id: 'loaf' })
  const issues = checkLabel(d, data)
  expect(issues.join(' ')).toContain('safe area')
  expect(issues.join(' ')).toContain('7 pt')
  expect(issues.join(' ')).toContain('overflow')
  expect(() => validateLabelDocument({ ...d, width: 0 })).toThrow()
  expect(() =>
    validateLabelDocument({
      ...d,
      elements: [{ ...e, binding: 'unsafe.field' }],
    }),
  ).toThrow()
  expect(() =>
    validateLabelDocument({
      ...d,
      elements: [{ ...e, color: 'url(example)#ffffff' }],
    }),
  ).toThrow()
  expect(() => validateLabelDocument({ ...d, elements: [e, e] })).toThrow()
})
it('conditions hide blank, batch-only, and undeclared allergen elements', () => {
  const data = resolveLabelData(workspace(), { kind: 'product', id: 'loaf' }),
    e = {
      ...newElement('text', '', 'product.subtitle'),
      condition: 'nonempty' as const,
    }
  expect(elementVisible(e, data)).toBe(false)
  expect(elementVisible({ ...e, condition: 'batch' }, data)).toBe(false)
  expect(elementVisible({ ...e, condition: 'allergens' }, data)).toBe(true)
})
it('all original templates pass document validation and fit their label', () => {
  for (const t of systemLabelTemplates) {
    expect(() => validateLabelDocument(t)).not.toThrow()
    for (const e of t.elements) {
      expect(e.x + e.width).toBeLessThanOrEqual(t.width)
      expect(e.y + e.height).toBeLessThanOrEqual(t.height)
    }
  }
})
it('wraps text using bundled font metrics', () => {
  const e = newElement('text')
  expect(measureLabelText(e, 'WWW')).toBeGreaterThan(measureLabelText(e, 'iii'))
  expect(
    wrapLabelText('One two three four', 35, 12, 0, (t) =>
      measureLabelText(e, t),
    ).length,
  ).toBeGreaterThan(1)
})
describe('physical PDF export', () => {
  it('embeds print fonts and preserves label dimensions and copy count', async () => {
    const d = blankLabel()
    d.width = 144
    d.height = 72
    d.elements = [
      {
        ...newElement('text', 'Made with care'),
        width: 110,
        height: 20,
        fontSize: 10,
      },
    ]
    const data: LabelData = {
      values: {},
      warnings: [],
      allergens: [],
      weightsVerified: true,
      ingredientParts: [],
    }
    const bytes = await exportLabelPdf(d, data, [], 2, defaultSheet, {
      font: async (key) =>
        new Uint8Array(await readFile('public/label-fonts/' + key + '.ttf')),
      image: async () => new Uint8Array(),
    })
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(2)
    expect(pdf.getPage(0).getSize()).toEqual({ width: 144, height: 72 })
    expect(pdf.getPage(0).node.Resources()?.toString()).toContain('/Font')
    expect(bytes.length).toBeGreaterThan(1000)
  })
  it('lays out sheets and rejects impossible layouts', async () => {
    const d = blankLabel()
    d.width = 144
    d.height = 72
    const layout = {
      ...defaultSheet,
      mode: 'sheet' as const,
      rows: 3,
      columns: 2,
    }
    const data: LabelData = {
      values: {},
      warnings: [],
      allergens: [],
      weightsVerified: true,
      ingredientParts: [],
    }
    const bytes = await exportLabelPdf(d, data, [], 7, layout),
      pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(2)
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
    expect(() => validateSheet(d, { ...layout, columns: 9 })).toThrow(
      'do not fit',
    )
    expect(() => validateSheet(d, { ...layout, rows: 0 })).toThrow()
  })
})
it('preserves independent fill and stroke alpha in a real PDF', async () => {
  const doc = {
    ...blankLabel(),
    background: 'transparent',
    elements: [
      {
        ...newElement('shape'),
        fill: '#71315f',
        fillOpacity: 0.5,
        color: '#000000',
        colorOpacity: 0.8,
        opacity: 1,
      },
    ],
  }
  const bytes = await exportLabelPdf(
    doc,
    {
      values: {},
      warnings: [],
      allergens: [],
      weightsVerified: true,
      ingredientParts: [],
    },
    [],
    1,
    defaultSheet,
  )
  const pdf = await PDFDocument.load(bytes)
  const resources = pdf.getPage(0).node.Resources()!
  const { PDFName } = await import('pdf-lib')
  const states = resources.lookup(PDFName.of('ExtGState')) as any
  const entries = states
    .entries()
    .map(([, ref]: any) => pdf.context.lookup(ref)!.toString())
    .join('\n')
  expect(entries).toContain('/ca 0.5')
  expect(entries).toContain('/CA 0.8')
  expect(entries).toContain('/ca 0')
})
