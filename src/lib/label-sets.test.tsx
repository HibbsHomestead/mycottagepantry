// @vitest-environment node
import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LabelCanvas } from '../components/label-canvas'
import {
  blankLabel,
  newElement,
  resolveLabelData,
  elementText,
  validateLabelDocument,
  checkLabel,
} from './label-studio'
import {
  labelLayout,
  labelSetPlan,
  labelSide,
  validateLabelRunContent,
} from './label-sets'
import { demoData } from './demo'
import { defaultSheet } from './label-print-layout'
import { applyProductTemplateDraft } from './label-preview'
import { exportSvgLabelPdf } from '../../netlify/lib/label-svg-output'
import { PDFDocument } from 'pdf-lib'
import { readFile } from 'node:fs/promises'
import { artworkLibrary } from './artwork-library'

export function pairedTemplate() {
  const front = {
    ...blankLabel(),
    id: 'paired',
    recordKind: 'template' as const,
    renderVersion: 2 as const,
    width: 216,
    height: 144,
    elements: [newElement('text', '', 'product.displayName')],
  }
  return {
    ...front,
    format: 'front-back' as const,
    back: {
      ...labelLayout(front),
      elements: [newElement('text', '', 'product.netQuantity')],
    },
  }
}
it('prints exact grouped/paired sets and replacement counts without modifying the document', () => {
  const d = pairedTemplate(),
    before = structuredClone(d)
  expect(labelSetPlan(d, 1).sequence).toEqual(['front', 'back'])
  const twelve = labelSetPlan(d, 12)
  expect(twelve.sequence.filter((s) => s === 'front')).toHaveLength(12)
  expect(twelve.sequence.filter((s) => s === 'back')).toHaveLength(12)
  expect(twelve.total).toBe(24)
  expect(labelSetPlan(d, 2, 'both', 'paired').sequence).toEqual([
    'front',
    'back',
    'front',
    'back',
  ])
  expect(labelSetPlan(d, 12, 'front').sequence).toEqual(Array(12).fill('front'))
  expect(labelSetPlan(d, 12, 'back').sequence).toEqual(Array(12).fill('back'))
  expect(d).toEqual(before)
})
it('separates incompatible stock and rejects missing backs and excessive counts', () => {
  const d = pairedTemplate()
  d.back.width = 144
  const plan = labelSetPlan(d, 12, 'both', 'paired')
  expect(plan.differentStock).toBe(true)
  expect(
    plan.runs.map((r) => [
      r.document.width,
      r.document.height,
      r.sequence.length,
    ]),
  ).toEqual([
    [216, 144, 12],
    [144, 144, 12],
  ])
  expect(() =>
    labelSetPlan({ ...d, back: { ...d.back, elements: [] } }, 12),
  ).toThrow(/Back is blank/)
  expect(() =>
    labelSetPlan({ ...d, back: { ...d.back, width: 216 } }, 101),
  ).toThrow(/200 individual/)
  expect(() =>
    labelSetPlan({ ...d, format: 'single', back: undefined }, 1, 'back'),
  ).toThrow(/no Back/)
  expect(() =>
    validateLabelDocument({ ...d, back: { ...d.back, width: 0 } }),
  ).toThrow()
})
it('resolves current product fields on both sides without writing fallback or changing other products', () => {
  const w = demoData(),
    d = pairedTemplate(),
    p = w.products[0],
    other = structuredClone(w.products[1])
  p.labelMainName = ' \t '
  p.netWeightOz = 9.5
  const data = resolveLabelData(w, { kind: 'product', id: p.id })
  expect(elementText(d.elements[0], data)).toBe(p.name)
  expect(data.values['product.netQuantity']).toBe('Net Wt. 9.5oz (269g)')
  expect(p.labelMainName).toBe(' \t ')
  p.labelMainName = 'Market loaf'
  expect(
    resolveLabelData(w, { kind: 'product', id: p.id }).values[
      'product.displayName'
    ],
  ).toBe('Market loaf')
  p.netWeightOz = ''
  expect(
    resolveLabelData(w, { kind: 'product', id: p.id }).values[
      'product.netQuantity'
    ],
  ).toBe('')
  expect(w.products[1]).toEqual(other)
  expect(labelSide(d, 'front').id).not.toBe(labelSide(d, 'back').id)
})
it('validates new assignments but retains unchanged legacy links', () => {
  const w = demoData(),
    d = pairedTemplate()
  w.label_templates = [d, { ...blankLabel(), id: 'legacy' }]
  const old = { id: 'p', name: 'Old', labelDesignId: 'legacy' }
  expect(
    applyProductTemplateDraft(w, { ...old, name: 'Renamed' }, old)
      .labelDesignId,
  ).toBe('legacy')
  expect(() =>
    applyProductTemplateDraft(w, {
      id: 'new',
      name: 'New',
      labelAssignmentEdited: true,
      labelDesignId: 'legacy',
    }),
  ).toThrow()
  expect(() =>
    applyProductTemplateDraft(w, {
      id: 'new',
      name: 'New',
      labelAssignmentEdited: true,
      labelDesignId: 'foreign',
    }),
  ).toThrow()
  expect(
    applyProductTemplateDraft(w, {
      id: 'new',
      name: 'New',
      labelAssignmentEdited: true,
      labelDesignId: d.id,
    }).labelDesignId,
  ).toBe(d.id)
  expect(
    applyProductTemplateDraft(
      w,
      { ...old, labelAssignmentEdited: true, labelDesignId: '' },
      old,
    ).labelDesignId,
  ).toBe('')
})
it('uses the same canvas with embedded library artwork and produces exactly 24 exact-size PDF pages', async () => {
  const w = demoData(),
    d = pairedTemplate(),
    data = resolveLabelData(w, { kind: 'product', id: w.products[0].id })
  const asset = artworkLibrary[0]
  d.elements.push({ ...newElement('image'), binding: '', assetId: asset.id })
  const inline = { ...asset, fileUrl: 'data:image/png;base64,embedded' }
  const markup = renderToStaticMarkup(
    <LabelCanvas document={d} data={data} assets={[inline]} />,
  )
  expect(markup).toContain(inline.fileUrl)
  const plan = labelSetPlan(d, 12)
  const bytes = await exportSvgLabelPdf(
    plan.sequence.map((side) => labelSide(d, side)),
    data,
    [],
    defaultSheet,
    {
      fonts: [],
      font: async (key) =>
        new Uint8Array(await readFile(`public/label-fonts/${key}.ttf`)),
      image: async () => {
        throw new Error('Library artwork must use bundled original')
      },
    },
  )
  const pdf = await PDFDocument.load(bytes)
  expect(pdf.getPageCount()).toBe(24)
  expect(
    pdf.getPages().every((p) => p.getWidth() === 216 && p.getHeight() === 144),
  ).toBe(true)
})

it('does not require content to be repeated on both sides and blocks a populated blank side', () => {
  const w = demoData(),
    d = pairedTemplate(),
    data = resolveLabelData(w, { kind: 'product', id: w.products[0].id })
  const all = [...d.elements, ...d.back.elements]
  expect(
    checkLabel(labelSide(d, 'back'), data, [], [], all).join(' '),
  ).not.toContain('Missing information: Product name')
  data.values['product.netQuantity'] = ''
  expect(() => validateLabelRunContent(d, data, ['front', 'back'])).toThrow(
    /Back has no visible/,
  )
  expect(() => validateLabelRunContent(d, data, ['front'])).not.toThrow()
})
it('renders uploaded font aliases and fails explicitly for compressed fonts without changing the design', async () => {
  const w = demoData(),
    d = labelSide(pairedTemplate(), 'front'),
    data = resolveLabelData(w, { kind: 'product', id: w.products[0].id })
  const { labelFonts } = await import('./label-studio')
  const custom = {
    ...labelFonts[0],
    name: 'Uploaded face · abc123',
    file: 'custom-fixture',
    weights: [400],
  }
  d.elements[0].font = custom.name
  const before = structuredClone(d)
  const loaders = {
    fonts: [custom],
    font: async () =>
      new Uint8Array(await readFile('public/label-fonts/inter.ttf')),
    image: async () => new Uint8Array(),
  }
  const pdf = await PDFDocument.load(
    await exportSvgLabelPdf([d], data, [], defaultSheet, loaders),
  )
  expect(pdf.getPageCount()).toBe(1)
  await expect(
    exportSvgLabelPdf([d], data, [], defaultSheet, {
      ...loaders,
      font: async () => new Uint8Array(Buffer.from('wOFFcompressed')),
    }),
  ).rejects.toThrow(/TTF or OTF/)
  expect(d).toEqual(before)
})
