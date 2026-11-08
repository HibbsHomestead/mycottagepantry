// @vitest-environment node
import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { demoData } from './demo'
import {
  blankLabel,
  checkLabel,
  elementText,
  newElement,
  resolveLabelData,
  validateLabelDocument,
  type LabelDocument,
} from './label-studio'
import { labelLayout, labelSide } from './label-sets'
import { duplicateSavedLabel } from './saved-labels'
import { LabelCanvas } from '../components/label-canvas'
import { printPageHtml } from './label-browser-print'
import { defaultSheet } from './label-print-layout'

const binding = 'business.cottageFoodDisclaimer'

it('resolves the exact business text without changing legacy product or brand overrides', () => {
  const workspace = demoData()
  const product = workspace.products[0]
  const source = { kind: 'product' as const, id: product.id }
  const saved = 'Owner text — preserve punctuation.\nSecond line.  '
  workspace.settings[0].disclaimer = saved
  product.disclaimer = 'Existing product text'
  const brand = {
    id: 'existing-brand',
    name: 'Existing brand',
    defaultDisclaimer: 'Existing brand text',
    contact: { disclaimer: 'Existing contact text' },
  }
  const before = structuredClone({ workspace, brand })
  expect(resolveLabelData(workspace, source, brand).values[binding]).toBe(saved)
  expect(
    resolveLabelData(workspace, source, brand).values['business.disclaimer'],
  ).toBe('Existing product text')
  expect({ workspace, brand }).toEqual(before)
  product.disclaimer = ''
  expect(
    resolveLabelData(workspace, source, brand).values['business.disclaimer'],
  ).toBe('Existing brand text')
})

it.each([undefined, null, ''])(
  'leaves missing business text empty (%s) without substituting another statement',
  (text) => {
    const workspace = demoData()
    workspace.settings[0].disclaimer = text
    workspace.products[0].disclaimer = 'Existing product text'
    const data = resolveLabelData(
      workspace,
      { kind: 'product', id: workspace.products[0].id },
      {
        id: 'brand',
        name: 'Existing brand',
        defaultDisclaimer: 'Existing brand text',
      },
    )
    expect(data.values[binding]).toBe('')
    expect(workspace.settings[0].disclaimer).toBe(text)
  },
)

it('keeps business text isolated between workspace data and explicit on non-food designs', () => {
  const a = demoData(),
    b = demoData()
  a.settings[0].disclaimer = 'Business A text'
  b.settings[0].disclaimer = 'Business B text'
  a.products[0].workflow = 'handmade'
  const source = { kind: 'product' as const, id: a.products[0].id }
  expect(resolveLabelData(a, source).values[binding]).toBe('Business A text')
  expect(resolveLabelData(b, source).values[binding]).toBe('Business B text')
  expect(resolveLabelData(a, source).values['business.disclaimer']).toBe('')
})

it('retains the live binding and all layout properties on both sides through validation, duplication and print rendering', () => {
  const workspace = demoData()
  workspace.settings[0].disclaimer = 'OWNER TEXT A'
  const source = { kind: 'product' as const, id: workspace.products[0].id }
  const front = {
    ...newElement('text', '', binding),
    fontSize: 9,
    rotation: 12,
    x: 30,
    y: 40,
    width: 200,
    height: 60,
  }
  const back = {
    ...newElement('text', '', binding),
    fontSize: 11,
    rotation: -8,
    x: 45,
    y: 80,
    width: 190,
    height: 70,
  }
  const document: LabelDocument = {
    ...blankLabel(),
    id: 'business-text-label',
    name: 'Owner text label',
    workflowVersion: 1,
    recordKind: 'label',
    source,
    productId: source.id,
    format: 'front-back',
    elements: [front],
    back: labelLayout({ ...blankLabel(), elements: [back] }),
  }
  const original = structuredClone(document)
  const copy = duplicateSavedLabel(validateLabelDocument(document), source)
  expect(copy.elements).toEqual(original.elements)
  expect(copy.back).toEqual(original.back)
  workspace.settings[0].disclaimer = 'OWNER TEXT B'
  const data = resolveLabelData(workspace, source)
  const markup = (['front', 'back'] as const).map((side) => {
    const layout = labelSide(copy, side)
    expect(layout.elements[0].binding).toBe(binding)
    expect(layout.elements[0].text).toBe('')
    expect(elementText(layout.elements[0], data)).toBe('OWNER TEXT B')
    const svg = renderToStaticMarkup(
      <LabelCanvas document={layout} data={data} />,
    )
    expect(svg).toContain('OWNER TEXT B')
    expect(svg).not.toContain('OWNER TEXT A')
    return svg
  })
  const html = printPageHtml(
    markup[0],
    labelSide(copy, 'front'),
    2,
    { ...defaultSheet, mode: 'roll' },
    undefined,
    markup,
  )
  expect(html.match(/OWNER TEXT B/g)).toHaveLength(2)
  expect(document).toEqual(original)
})

it('recognizes the explicit business binding in disclaimer checks without adding elements', () => {
  const workspace = demoData()
  workspace.settings[0].disclaimer = 'Owner supplied text'
  const data = resolveLabelData(workspace, {
    kind: 'product',
    id: workspace.products[0].id,
  })
  const document = {
    ...blankLabel(),
    labelType: 'Finished-product full compliance label',
    elements: [newElement('text', '', binding)],
  }
  const before = structuredClone(document)
  expect(checkLabel(document, data)).not.toContain(
    'Missing information: Cottage-food disclaimer.',
  )
  expect(document).toEqual(before)
  workspace.settings[0].disclaimer = ''
  expect(
    checkLabel(
      document,
      resolveLabelData(workspace, {
        kind: 'product',
        id: workspace.products[0].id,
      }),
    ),
  ).toContain('Missing information: Cottage-food disclaimer.')
})
