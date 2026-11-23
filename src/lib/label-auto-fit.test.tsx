// @vitest-environment node
import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { load } from 'cheerio'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { LabelCanvas } from '../components/label-canvas'
import {
  ingredientStatementFixture,
  statement,
} from '../test/fixtures/ingredient-statement'
import {
  fitIngredientText,
  labelTextLines,
  assertIngredientFit,
  ingredientOverflowMessage,
  validateLabelDocument,
} from './label-studio'
import { exportLabelPdf } from './label-export'
import { exportSvgLabelPdf } from '../../netlify/lib/label-svg-output'
import { defaultSheet } from './label-print-layout'
import { labelOutputBlocker } from '../components/label-print-workflow'

for (const font of ['DM Sans', 'Lora', 'Oswald']) {
  it(`fits complete nested statement in ${font}, restores selected size and survives reopening`, () => {
    const { document, data } = ingredientStatementFixture()
    const e = {
      ...document.elements[0],
      font,
      autoFit: true,
      minimumFontSize: 5,
      fontSize: 18,
      height: 58,
    }
    const before = JSON.stringify(e)
    const fit = fitIngredientText(e, data)
    expect(fit.overflow).toBe(false)
    expect(fit.element.fontSize).toBeLessThan(18)
    expect(fit.element.fontSize).toBeGreaterThanOrEqual(5)
    expect(
      labelTextLines(fit.element, data)
        .flat()
        .map((r) => r.text)
        .join(''),
    ).toBe(statement)
    expect(JSON.stringify(e)).toBe(before)
    const reopened = validateLabelDocument(
      JSON.parse(JSON.stringify({ ...document, elements: [e] })),
    ).elements[0]
    expect(fitIngredientText(reopened, data)).toEqual(fit)
    expect(
      fitIngredientText({ ...e, width: 900, height: 500 }, data).element
        .fontSize,
    ).toBe(18)
    expect(
      fitIngredientText({ ...e, autoFit: false }, data).element.fontSize,
    ).toBe(18)
    expect(
      fitIngredientText(e, {
        ...data,
        values: { ...data.values, 'recipe.ingredients': 'Ingredients: Salt' },
        ingredientParts: [],
      }).element.fontSize,
    ).toBe(18)
  })
}
it('preserves manual spacing, punctuation and allergens without transformation', () => {
  const { document, data } = ingredientStatementFixture()
  const text =
    'Ingredients:  Flour (wheat, vitamins (iron, niacin)), butter. Contains: WHEAT, MILK.'
  const e = {
    ...document.elements[0],
    binding: undefined,
    text,
    autoFit: true,
    minimumFontSize: 5,
    textCase: 'upper' as const,
  }
  const fitted = fitIngredientText(e, data)
  expect(fitted.overflow).toBe(false)
  expect(
    labelTextLines(fitted.element, data)
      .flat()
      .map((r) => r.text)
      .join(''),
  ).toBe(text)
})
it('stops at configured minimum, flags canvas and blocks PDF output while allowing draft validation', async () => {
  const { document, data } = ingredientStatementFixture()
  const e = {
    ...document.elements[0],
    autoFit: true,
    minimumFontSize: 10,
    width: 35,
    height: 12,
  }
  const d = {
    ...document,
    format: 'single' as const,
    back: undefined,
    elements: [e],
  }
  expect(fitIngredientText(e, data).element.fontSize).toBe(10)
  expect(fitIngredientText(e, data).overflow).toBe(true)
  expect(() => validateLabelDocument(d)).not.toThrow()
  expect(() => assertIngredientFit(d, data)).toThrow(ingredientOverflowMessage)
  expect(
    renderToStaticMarkup(
      <LabelCanvas document={d} data={data} assets={[]} editor />,
    ),
  ).toContain('data-ingredient-overflow')
  await expect(
    exportLabelPdf(
      d,
      data,
      [],
      1,
      { ...defaultSheet, mode: 'roll' },
      {
        font: async (key) =>
          new Uint8Array(await readFile(`public/label-fonts/${key}.ttf`)),
        image: async () => new Uint8Array(),
      },
    ),
  ).rejects.toThrow(ingredientOverflowMessage)
})
it('uses identical fitted line runs on SVG and physical PDF pages', async () => {
  const { document, data } = ingredientStatementFixture()
  const e = {
    ...document.elements[0],
    autoFit: true,
    minimumFontSize: 5,
    fontSize: 18,
    height: 60,
  }
  const d = { ...document, elements: [e], back: undefined }
  const fitted = fitIngredientText(e, data)
  expect(fitted.overflow).toBe(false)
  const xml = load(
    renderToStaticMarkup(<LabelCanvas document={d} data={data} assets={[]} />),
    { xml: true },
  )
  expect(xml('text').text()).toBe(statement)
  expect(Number(xml('text').attr('font-size'))).toBe(fitted.element.fontSize)
  const loaders = {
    fonts: [],
    font: async (key: string) =>
      new Uint8Array(await readFile(`public/label-fonts/${key}.ttf`)),
    image: async () => new Uint8Array(),
  }
  const layout = { ...defaultSheet, mode: 'roll' as const }
  const bytes = await exportSvgLabelPdf([d], data, [], layout, loaders)
  const pdf = await PDFDocument.load(bytes)
  expect(pdf.getPage(0).getSize()).toEqual({
    width: d.width,
    height: d.height,
  })
})
it('cannot bypass overflow by acknowledging warnings', () => {
  const { document } = ingredientStatementFixture()
  expect(
    labelOutputBlocker({
      type: 'pdf',
      doc: document,
      copies: 1,
      layout: defaultSheet,
      issues: [ingredientOverflowMessage],
      reviewed: true,
    }),
  ).toBe(ingredientOverflowMessage)
})

it('rechecks long wording and physical stock bounds without modifying content or manual size', () => {
  const { document, data } = ingredientStatementFixture()
  const element = { ...document.elements[0], autoFit: true, minimumFontSize: 8 }
  const long = {
    ...data,
    ingredientParts: [],
    values: {
      ...data.values,
      'recipe.ingredients': (
        statement + '. Contains: WHEAT, SOY, MILK. '
      ).repeat(30),
    },
  }
  const original = long.values['recipe.ingredients']
  expect(fitIngredientText(element, long).overflow).toBe(true)
  expect(long.values['recipe.ingredients']).toBe(original)
  expect(() =>
    assertIngredientFit({ ...document, elements: [element] }, data),
  ).not.toThrow()
  expect(() =>
    assertIngredientFit(
      { ...document, width: 144, height: 144, elements: [element] },
      data,
    ),
  ).toThrow(ingredientOverflowMessage)
  expect(element.fontSize).toBe(10)
})
