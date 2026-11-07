// @vitest-environment node
import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  PDFDict,
  PDFName,
  decodePDFRawStream,
} from 'pdf-lib'
import { LabelCanvas } from '../components/label-canvas'
import {
  blankLabel,
  systemLabelTemplates,
  validateLabelDocument,
  type LabelData,
  type LabelDocument,
} from './label-studio'
import { labelLayout, labelSide } from './label-sets'
import { duplicateSavedLabel } from './saved-labels'
import { labelContent } from './label-persistence'
import { exportLabelPdf } from './label-export'
import { defaultSheet } from './label-print-layout'
import { printPageHtml } from './label-browser-print'
import { exportSvgLabelPdf } from '../../netlify/lib/label-svg-output'

const data: LabelData = {
  values: {},
  warnings: [],
  allergens: [],
  weightsVerified: true,
  ingredientParts: [],
}
const legacy = (background?: string | null): LabelDocument =>
  ({
    ...blankLabel(),
    background,
    backgroundOpacity: 0.3,
  }) as LabelDocument

it('starts blank labels and every bundled starting design with opaque white on either side', () => {
  for (const document of [blankLabel(), ...systemLabelTemplates]) {
    expect(document.background).toBe('#FFFFFF')
    expect(document.backgroundOpacity).toBe(1)
    const paired = {
      ...document,
      format: 'front-back' as const,
      back: labelLayout(blankLabel()),
    }
    expect(labelSide(paired, 'front').background).toBe('#FFFFFF')
    expect(labelSide(paired, 'back').background).toBe('#FFFFFF')
  }
})

it.each([undefined, null, '', '  '])(
  'uses solid white for unset legacy backgrounds (%s) without changing the stored source',
  (background) => {
    const document = legacy(background)
    const original = structuredClone(document)
    const paired = {
      ...document,
      format: 'front-back' as const,
      back: labelLayout(document),
    }
    // A missing Back background must not inherit an explicitly colored Front.
    paired.background = '#71315f'
    paired.back.background = background as string
    paired.back.backgroundOpacity = 0.3
    const back = labelSide(paired, 'back')
    expect(back).toMatchObject({ background: '#FFFFFF', backgroundOpacity: 1 })
    expect(validateLabelDocument(document)).toMatchObject({
      background: '#FFFFFF',
      backgroundOpacity: 1,
    })
    expect(validateLabelDocument(paired).back).toMatchObject({
      background: '#FFFFFF',
      backgroundOpacity: 1,
    })
    const copy = duplicateSavedLabel(paired, { kind: 'product', id: '' })
    expect(copy.background).toBe('#71315f')
    expect(copy.back).toMatchObject({
      background: '#FFFFFF',
      backgroundOpacity: 1,
    })
    expect(
      duplicateSavedLabel(document, { kind: 'product', id: '' }),
    ).toMatchObject({ background: '#FFFFFF', backgroundOpacity: 1 })
    expect(document).toEqual(original)
  },
)

it.each(['#71315f', '#f8efdf', 'transparent'])(
  'retains an explicitly saved background and opacity through duplication (%s)',
  (background) => {
    const document = legacy(background)
    document.format = 'front-back'
    document.back = {
      ...labelLayout(document),
      background: '#123456',
      backgroundOpacity: 0.6,
    }
    const copy = duplicateSavedLabel(document, { kind: 'product', id: '' })
    expect(copy).toMatchObject({ background, backgroundOpacity: 0.3 })
    expect(copy.back).toMatchObject({
      background: '#123456',
      backgroundOpacity: 0.6,
    })
    copy.back!.background = '#abcdef'
    expect(document.back.background).toBe('#123456')
  },
)

it('keeps explicit legacy colors without adding opacity fields that would invalidate save confirmations', () => {
  const document = { ...blankLabel(), background: '#f8efdf' }
  delete document.backgroundOpacity
  const saved = validateLabelDocument(document)
  expect(labelContent(saved)).toBe(labelContent(document))
  expect(saved.background).toBe('#f8efdf')
  expect(saved).not.toHaveProperty('backgroundOpacity')
})

it('renders an explicit opaque white SVG background for editor, preview, PNG and browser printing', async () => {
  const document = legacy()
  for (const editor of [false, true]) {
    const svg = renderToStaticMarkup(
      <LabelCanvas document={document} data={data} editor={editor} />,
    )
    expect(svg).toContain('fill="#FFFFFF" fill-opacity="1"')
    const png = new Resvg(svg).render().asPng()
    const pixel = await sharp(png)
      .ensureAlpha()
      .extract({ left: 20, top: 20, width: 1, height: 1 })
      .raw()
      .toBuffer()
    expect([...pixel]).toEqual([255, 255, 255, 255])
    expect(printPageHtml(svg, document, 1, defaultSheet)).toContain(
      'fill="#FFFFFF" fill-opacity="1"',
    )
  }
})

it.each([false, true])(
  'paints white in PDF output rather than relying on page transparency (round=%s)',
  async (round) => {
    const document = { ...legacy(), round }
    const pdf = await PDFDocument.load(
      await exportLabelPdf(document, data, [], 1, defaultSheet),
    )
    const contents = pdf.getPage(0).node.Contents() as PDFArray
    const stream = contents.lookup(0, PDFRawStream)
    const instructions = new TextDecoder().decode(
      decodePDFRawStream(stream).decode(),
    )
    expect(instructions).toContain('1 1 1 rg')
    expect(pdf.getPage(0).node.Resources()!.toString()).toContain('/ca 1')
  },
)

it('renders each saved side color in SVG, PNG, browser print and the actual paired PDF renderer', async () => {
  const document: LabelDocument = {
    ...blankLabel(),
    format: 'front-back',
    background: '#ffd08a',
    back: { ...labelLayout(blankLabel()), background: '#9dd8f0' },
  }
  const sides = [labelSide(document, 'front'), labelSide(document, 'back')]
  const pixels = [
    [255, 208, 138],
    [157, 216, 240],
  ]
  const markup: string[] = []
  for (const [i, side] of sides.entries()) {
    const svg = renderToStaticMarkup(
      <LabelCanvas document={side} data={data} />,
    )
    markup.push(svg)
    expect(svg).toContain(`fill="${side.background}" fill-opacity="1"`)
    const pixel = await sharp(new Resvg(svg).render().asPng())
      .ensureAlpha()
      .extract({ left: 20, top: 20, width: 1, height: 1 })
      .raw()
      .toBuffer()
    expect([...pixel]).toEqual([...pixels[i], 255])
  }
  const printed = printPageHtml(
    markup[0],
    sides[0],
    2,
    { ...defaultSheet, mode: 'roll' },
    undefined,
    markup,
  )
  expect(printed).toContain('fill="#ffd08a"')
  expect(printed).toContain('fill="#9dd8f0"')
  const pdf = await PDFDocument.load(
    await exportSvgLabelPdf(
      sides,
      data,
      [],
      { ...defaultSheet, mode: 'roll' },
      {
        fonts: [],
        font: async () => {
          throw new Error('No fonts in this fixture')
        },
        image: async () => {
          throw new Error('No images in this fixture')
        },
      },
    ),
  )
  expect(pdf.getPageCount()).toBe(2)
  for (const [i, page] of pdf.getPages().entries()) {
    const images = page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
    const embedded = images.lookup(images.keys()[0])
    if (!(embedded instanceof PDFRawStream))
      throw new Error('Expected an embedded label image')
    const pixelsInPdf = decodePDFRawStream(embedded).decode()
    expect([...pixelsInPdf.slice(0, 3)]).toEqual(pixels[i])
  }
})
