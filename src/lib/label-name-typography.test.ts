// @vitest-environment node
import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { applySelectionFont, editStaticText } from './label-rich-text'
import {
  blankLabel,
  newElement,
  resolveLabelData,
  validateLabelDocument,
  labelTextLines,
  checkLabel,
} from './label-studio'
import { exportLabelPdf } from './label-export'
import { defaultSheet } from './label-print-layout'
import { labelContent, confirmLabelSave } from './label-persistence'
import { demoData } from './demo'
it('switches explicit name parts without guessing, changing the full name, or changing independent formatting', () => {
  const w = demoData()
  w.products[0] = {
    ...w.products[0],
    labelMainName: 'Homestyle White',
    labelProductType: 'Bread',
  }
  w.products[1] = {
    ...w.products[1],
    labelMainName: 'Chocolate Chip',
    labelProductType: 'Cookies',
  }
  const d = {
    ...blankLabel(),
    id: 'names',
    elements: [
      {
        ...newElement('text', '', 'product.labelMainName'),
        font: 'Lora',
        fontSize: 18,
        letterSpacing: 1.2,
        lineHeight: 1.4,
        rotation: 15,
        groupId: 'name',
      },
      {
        ...newElement('text', '', 'product.labelProductType'),
        font: 'Oswald',
        fontSize: 16,
        y: 80,
        groupId: 'name',
      },
    ],
  }
  const before = JSON.stringify(d)
  const first = resolveLabelData(w, { kind: 'product', id: w.products[0].id }),
    second = resolveLabelData(w, { kind: 'product', id: w.products[1].id })
  expect(first.values['product.labelMainName']).toBe('Homestyle White')
  expect(second.values['product.labelMainName']).toBe('Chocolate Chip')
  expect(second.values['product.labelProductType']).toBe('Cookies')
  expect(first.values['product.name']).toBe(w.products[0].name)
  expect(JSON.stringify(d)).toBe(before)
  expect(validateLabelDocument(JSON.parse(before)).elements).toEqual(d.elements)
  delete w.products[1].labelMainName
  const missing = resolveLabelData(w, { kind: 'product', id: w.products[1].id })
  expect(missing.values['product.labelMainName']).toBe('')
  expect(checkLabel(d, missing)).toContain(
    'Missing information: Label main name. Enter it in the product editor before printing.',
  )
})
it('stores selected static words as text runs, preserves formatting during edits, and rejects offset-based dynamic styling', () => {
  let e = newElement('text', 'Homestyle White Bread')
  e = { ...e, textRuns: applySelectionFont(e, 16, 21, 'Oswald') }
  expect(e.textRuns?.map((r) => [r.text, r.font])).toEqual([
    ['Homestyle White ', 'DM Sans'],
    ['Bread', 'Oswald'],
  ])
  e = { ...e, ...editStaticText(e, 'Homestyle Wheat Bread') }
  expect(
    e.textRuns
      ?.filter((r) => r.font === 'Oswald')
      .map((r) => r.text)
      .join(''),
  ).toBe('Bread')
  expect(e.textRuns?.map((r) => r.text).join('')).toBe(e.text)
  expect(
    validateLabelDocument({ ...blankLabel(), elements: [e] }).elements[0],
  ).toEqual(e)
  expect(() =>
    validateLabelDocument({
      ...blankLabel(),
      elements: [{ ...e, binding: 'product.name' }],
    }),
  ).toThrow(/Dynamic fields/)
  const data = {
    values: {},
    warnings: [],
    allergens: [],
    weightsVerified: true,
    ingredientParts: [],
  }
  const lines = labelTextLines(e, data)
  expect(
    lines
      .flat()
      .map((r) => r.text)
      .join(''),
  ).toBe(e.text)
  expect(lines.flat().at(-1)?.font).toBe('Oswald')
})
it('embeds both static-run fonts and independent dynamic fonts in the PDF after save/reopen serialization', async () => {
  const w = demoData()
  w.products[0].labelMainName = 'Homestyle White'
  w.products[0].labelProductType = 'Bread'
  const e = newElement('text', 'Homestyle White Bread')
  const d = {
    ...blankLabel(),
    id: 'print-names',
    elements: [
      { ...e, textRuns: applySelectionFont(e, 16, 21, 'Oswald') },
      {
        ...newElement('text', '', 'product.labelMainName'),
        font: 'Lora',
        y: 80,
      },
      {
        ...newElement('text', '', 'product.labelProductType'),
        font: 'Oswald',
        y: 120,
      },
      {
        ...newElement('text', '', 'recipe.ingredients'),
        rotation: 180,
        x: 250,
        y: 240,
      },
    ],
  }
  const reopened = validateLabelDocument(JSON.parse(JSON.stringify(d)))
  expect(labelContent(reopened)).toBe(labelContent(d))
  const bytes = await exportLabelPdf(
    reopened,
    resolveLabelData(w, { kind: 'product', id: w.products[0].id }),
    [],
    1,
    defaultSheet,
    {
      font: async (key) =>
        new Uint8Array(await readFile('public/label-fonts/' + key + '.ttf')),
      image: async () => new Uint8Array(),
    },
  )
  const pdf = await PDFDocument.load(bytes)
  const fonts = pdf
    .getPage(0)
    .node.Resources()
    ?.lookupMaybe(
      (await import('pdf-lib')).PDFName.of('Font'),
      (await import('pdf-lib')).PDFDict,
    )
  expect(
    new Set(fonts?.values().map((reference) => reference.toString())).size,
  ).toBe(3)
  expect(pdf.getPage(0).getSize()).toEqual({ width: d.width, height: d.height })
})
it('rejects missing fonts and incomplete or mismatched save acknowledgements', async () => {
  const d = {
    ...blankLabel(),
    id: 'bad-font',
    elements: [
      { ...newElement('text', 'Bread'), font: 'Unavailable owner font' },
    ],
  }
  await expect(
    exportLabelPdf(
      d,
      {
        values: {},
        warnings: [],
        allergens: [],
        weightsVerified: true,
        ingredientParts: [],
      },
      [],
    ),
  ).rejects.toThrow('Unavailable owner font')
  const valid = {
    ...blankLabel(),
    id: 'confirm',
    elements: [newElement('text', 'Bread')],
  }
  const saved = {
    ...valid,
    revision: 1,
    savedAt: new Date().toISOString(),
    lastSaveOperationId: 'operation',
  }
  expect(
    confirmLabelSave({ label_templates: [saved] }, valid, 'operation'),
  ).toEqual(saved)
  for (const broken of [
    { ...saved, id: 'wrong' },
    { ...saved, elements: [] },
    { ...saved, savedAt: '' },
    { ...saved, lastSaveOperationId: 'wrong' },
    { ...saved, revision: 0 },
  ])
    expect(() =>
      confirmLabelSave({ label_templates: [broken] }, valid, 'operation'),
    ).toThrow('did not confirm')
})
it('keeps a newer confirmed label visible when an older oven response arrives afterward', async () => {
  const { mergeLabelWorkspace } = await import('./label-persistence')
  const current = demoData(),
    old = demoData()
  current.settings[0].labelEditorScope = old.settings[0].labelEditorScope =
    'same-user-and-workspace'
  const label = {
    ...blankLabel(),
    id: 'visible',
    revision: 3,
    name: 'Latest saved edits',
  }
  current.label_templates = [label]
  old.label_templates = [{ ...label, revision: 2, name: 'Old edits' }]
  expect(mergeLabelWorkspace(current, old).label_templates[0]).toEqual(label)
  old.label_templates = []
  expect(mergeLabelWorkspace(current, old).label_templates).toEqual([label])
  old.settings[0].labelEditorScope = 'another-workspace'
  expect(mergeLabelWorkspace(current, old).label_templates).toHaveLength(0)
})
