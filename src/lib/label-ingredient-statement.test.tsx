// @vitest-environment node
import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { load } from 'cheerio'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFRawStream,
  PDFArray,
  decodePDFRawStream,
} from 'pdf-lib'
import { LabelCanvas } from '../components/label-canvas'
import { ingredientStatementRuns } from './label-ingredient-statement'
import {
  labelTextLines,
  measureLabelText,
  checkLabel,
  validateLabelDocument,
  newElement,
} from './label-studio'
import { labelSide } from './label-sets'
import { duplicateSavedLabel } from './saved-labels'
import { exportLabelPdf } from './label-export'
import { exportSvgLabelPdf } from '../../netlify/lib/label-svg-output'
import { printPageHtml } from './label-browser-print'
import {
  ingredientStatementFixture,
  statement,
  mainNames,
} from '../test/fixtures/ingredient-statement'

it('uses structured main names, including commas in a name, and preserves exact nested wording and order', () => {
  const { data } = ingredientStatementFixture()
  expect(data.values['recipe.ingredients']).toBe(statement)
  const runs = ingredientStatementRuns(data)
  expect(runs.map((run) => run.text).join('')).toBe(statement)
  expect(runs.filter((run) => run.bold).map((run) => run.text)).toEqual(
    mainNames,
  )
  expect(
    runs
      .filter((run) => !run.bold)
      .map((run) => run.text)
      .join(''),
  ).toContain(
    '(sugar, chocolate (cocoa mass, cocoa butter), soy lecithin, vanilla)',
  )
})

it('supports older text-only snapshots with nested parentheses, exact whitespace, and no markup', () => {
  const { data } = ingredientStatementFixture()
  data.ingredientParts = []
  data.values['recipe.ingredients'] =
    'Ingredients:  Chocolate chips (sugar, chocolate (cocoa, butter)),\nSea Salt.'
  const runs = ingredientStatementRuns(data)
  expect(runs.map((run) => run.text).join('')).toBe(
    data.values['recipe.ingredients'],
  )
  expect(
    runs
      .filter((run) => run.bold)
      .map((run) => run.text)
      .join(''),
  ).toBe('Chocolate chips Sea Salt.')
  expect(
    runs
      .filter((run) => !run.bold)
      .map((run) => run.text)
      .join(''),
  ).toContain('(sugar, chocolate (cocoa, butter))')
})

it('keeps inline parenthesized subingredients regular even when they are in the saved statement name', () => {
  const { data } = ingredientStatementFixture()
  data.ingredientParts = [
    { name: 'Butter (cream (milk), salt)', subingredients: '', weight: 1 },
  ]
  data.values['recipe.ingredients'] = 'Ingredients: Butter (cream (milk), salt)'
  const runs = ingredientStatementRuns(data)
  expect(runs.map((run) => run.text).join('')).toBe(
    data.values['recipe.ingredients'],
  )
  expect(
    runs
      .filter((run) => run.bold)
      .map((run) => run.text)
      .join('')
      .trim(),
  ).toBe('Butter')
})

it('measures each weight when wrapping and reports overflow without changing or clipping the text box', () => {
  const { document, data } = ingredientStatementFixture()
  const e = document.elements[0]
  const before = structuredClone(document)
  const lines = labelTextLines(e, data)
  expect(lines.length).toBeGreaterThan(1)
  expect(
    lines
      .flat()
      .map((run) => run.text)
      .join(''),
  ).toBe(statement)
  for (const line of lines) {
    const characters = line.reduce(
      (n, run) => n + Array.from(run.text).length,
      0,
    )
    const width =
      line.reduce(
        (n, run) =>
          n +
          measureLabelText(
            { ...e, bold: run.bold ?? e.bold, letterSpacing: 0 },
            run.text,
          ),
        0,
      ) +
      Math.max(0, characters - 1) * e.letterSpacing
    expect(width).toBeLessThanOrEqual(e.width)
  }
  expect(
    checkLabel(document, data).filter((issue) => issue.includes('overflow')),
  ).toEqual([])
  const short = { ...document, elements: [{ ...e, height: 10 }] }
  expect(checkLabel(short, data)).toContain(
    'Print warning: recipe.ingredients may overflow its text box.',
  )
  expect(labelTextLines(short.elements[0], data)).toEqual(lines)
  const xml = load(
    renderToStaticMarkup(<LabelCanvas document={short} data={data} />),
    { xml: true },
  )
  expect(xml('[data-element="ingredients"] text').attr('font-size')).toBe('10')
  expect(xml('[data-element="ingredients"] clipPath')).toHaveLength(0)
  expect(document).toEqual(before)
})

it('retains binding and geometry on saved/reopened duplicates and renders matching editor, preview and browser-print runs on both sides', () => {
  const { document, data, source } = ingredientStatementFixture()
  const reopened = validateLabelDocument(JSON.parse(JSON.stringify(document)))
  const copy = duplicateSavedLabel(reopened, source)
  for (const d of [reopened, copy]) {
    expect(d.elements).toEqual(document.elements)
    expect(d.back!.elements).toEqual(document.back.elements)
    for (const side of ['front', 'back'] as const) {
      const layout = labelSide(d, side)
      const render = (editor: boolean) =>
        load(
          renderToStaticMarkup(
            <LabelCanvas document={layout} data={data} editor={editor} />,
          ),
          { xml: true },
        )
      const editor = render(true),
        preview = render(false)
      const text = preview('[data-element="ingredients"] text')
      expect(text.attr('font-weight')).toBe('400')
      expect(text.text()).toBe(statement)
      expect(text.html()).toBe(
        editor('[data-element="ingredients"] text').html(),
      )
      expect(
        text
          .find('tspan[font-weight="700"]')
          .toArray()
          .map((node) => preview(node).text())
          .join(''),
      ).toBe(mainNames.join(''))
      expect(text.find('tspan[font-weight="400"]').text()).toContain(
        'chocolate (cocoa mass, cocoa butter)',
      )
      expect(
        printPageHtml(preview.xml(), layout, 1, document.printSettings.layout),
      ).toContain(text.toString())
    }
  }
  const allergens = {
    ...newElement('text', '', 'recipe.allergens'),
    bold: true,
  }
  expect(
    labelTextLines(allergens, {
      ...data,
      values: { ...data.values, 'recipe.allergens': 'CONTAINS: MILK, SOY' },
    }).flat(),
  ).toEqual([{ text: 'CONTAINS: MILK, SOY', font: allergens.font }])
})

const font = async (key: string) =>
  new Uint8Array(await readFile(`public/label-fonts/${key}.ttf`))
const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

it.each([false, true])(
  'embeds actual regular and bold faces in vector PDF regardless of the text box bold flag (%s)',
  async (bold) => {
    const { document, data } = ingredientStatementFixture()
    document.elements[0].bold = bold
    const loaded: string[] = []
    await exportLabelPdf(document, data, [], 1, document.printSettings.layout, {
      font: async (key) => {
        loaded.push(key)
        return font(key)
      },
      image: async () => {
        throw new Error('No images')
      },
    })
    expect(loaded.sort()).toEqual(['dm-sans', 'dm-sans-bold'])
  },
)

it('keeps a selected single-weight font and uses explicit bold outlines only for main names in vector PDF', async () => {
  const { document, data } = ingredientStatementFixture()
  document.elements[0].font = 'Allura'
  document.elements[0].colorOpacity = 0.4
  const loaded: string[] = []
  const pdf = await PDFDocument.load(
    await exportLabelPdf(document, data, [], 1, document.printSettings.layout, {
      font: async (key) => {
        loaded.push(key)
        return font(key)
      },
      image: async () => {
        throw new Error('No images')
      },
    }),
  )
  expect(loaded).toEqual(['allura'])
  const contents = pdf.getPage(0).node.Contents() as PDFArray
  const operators = new TextDecoder().decode(
    decodePDFRawStream(contents.lookup(0, PDFRawStream)).decode(),
  )
  expect(operators).toContain('2 Tr')
  expect(operators).toContain('0 Tr')
  const states = pdf
    .getPage(0)
    .node.Resources()!
    .lookup(PDFName.of('ExtGState'), PDFDict)
  expect(
    states
      .values()
      .map((ref) => pdf.context.lookup(ref)?.toString())
      .join(' '),
  ).toContain('/CA 0.4')
})

it.each([
  ['DM Sans', ['dm-sans', 'dm-sans-bold']],
  ['Allura', ['allura']],
] as const)(
  'matches editor/PNG pixels in the actual Front/Back PDF export with %s',
  async (family, faces) => {
    const { document, data } = ingredientStatementFixture()
    document.elements[0].font = family
    document.back.elements[0].font = family
    const sides = [labelSide(document, 'front'), labelSide(document, 'back')]
    const loaded: string[] = []
    const pdf = await PDFDocument.load(
      await exportSvgLabelPdf(sides, data, [], document.printSettings.layout, {
        fonts: [],
        font: async (key) => {
          loaded.push(key)
          return font(key)
        },
        image: async () => {
          throw new Error('No images')
        },
      }),
    )
    expect(new Set(loaded)).toEqual(new Set(faces))
    expect(pdf.getPageCount()).toBe(2)
    for (const [i, page] of pdf.getPages().entries()) {
      const resources = page.node
        .Resources()!
        .lookup(PDFName.of('XObject'), PDFDict)
      const embedded = resources.lookup(resources.keys()[0])
      if (!(embedded instanceof PDFRawStream))
        throw new Error('Expected label image')
      const png = new Resvg(
        renderToStaticMarkup(<LabelCanvas document={sides[i]} data={data} />),
        {
          fitTo: { mode: 'width', value: 1200 },
          font: {
            fontFiles: faces.map((face) => `public/label-fonts/${face}.ttf`),
            loadSystemFonts: false,
          },
        },
      )
        .render()
        .asPng()
      const pixels = await sharp(png).removeAlpha().raw().toBuffer()
      expect(digest(decodePDFRawStream(embedded).decode())).toBe(digest(pixels))
    }
  },
)
