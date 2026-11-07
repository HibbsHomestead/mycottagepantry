import { it, expect, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { demoData } from './demo'
import {
  resolveLabelData,
  elementAssetId,
  newElement,
  blankLabel,
  validateLabelDocument,
  labelArtworkAssignment,
  elementVisible,
} from './label-studio'
import { exportLabelPdf } from './label-export'
function fixture() {
  const w = demoData()
  w.products = [
    {
      ...w.products[0],
      id: 'bread',
      imageAssetId: 'photo',
      graphicAssetId: 'wheat',
      iconAssetId: 'leaf',
    },
    {
      ...w.products[0],
      id: 'cookies',
      imageAssetId: 'cookie-photo',
      graphicAssetId: 'cookie-art',
    },
  ]
  w.graphic_assets = [
    'photo',
    'wheat',
    'leaf',
    'cookie-photo',
    'cookie-art',
    'logo',
    'secondary',
  ].map((id) => ({
    id,
    name: id,
    fileUrl: '/api/workspace?asset=' + id,
    widthPx: 600,
    heightPx: 600,
  }))
  w.settings[0].logoAssetId = 'logo'
  return w
}
it('resolves product photo, consolidated graphic, and business logo per selected source', () => {
  const w = fixture(),
    bread = resolveLabelData(w, { kind: 'product', id: 'bread' }),
    cookies = resolveLabelData(w, { kind: 'product', id: 'cookies' })
  expect(bread.values['product.image']).toBe('photo')
  expect(bread.values['product.icon']).toBe('wheat')
  expect(bread.values['business.logo']).toBe('logo')
  const e = { ...newElement('image'), binding: 'product.graphic' }
  expect(elementAssetId(e, bread)).toBe('wheat')
  expect(elementAssetId(e, cookies)).toBe('cookie-art')
  expect(
    resolveLabelData(
      w,
      { kind: 'product', id: 'bread' },
      { id: 'kit', name: 'kit', primaryLogoAssetId: 'secondary' },
    ).values['business.logo'],
  ).toBe('secondary')
  w.products[0].graphicAssetId = 'changed'
  expect(elementAssetId(e, bread)).toBe('wheat')
  expect(
    elementVisible(
      { ...e, binding: 'product.graphic', condition: 'nonempty' },
      cookies,
    ),
  ).toBe(true)
  const label = blankLabel()
  label.elements = [e]
  expect(() => validateLabelDocument(label)).not.toThrow()
  label.elements = [{ ...newElement('text'), binding: 'business.logo' }]
  expect(() => validateLabelDocument(label)).toThrow('image fields')
})
it('rejects artwork, products, and brand kits outside the oven', () => {
  const w = fixture()
  expect(() =>
    labelArtworkAssignment(w, {
      target: 'productIcon',
      assetId: 'foreign',
      productId: 'bread',
    }),
  ).toThrow('this oven')
  expect(() =>
    labelArtworkAssignment(w, {
      target: 'productIcon',
      assetId: 'leaf',
      productId: 'foreign',
    }),
  ).toThrow('this oven')
  expect(() =>
    labelArtworkAssignment(w, {
      target: 'businessLogo',
      assetId: 'logo',
      brandId: 'foreign',
    }),
  ).toThrow('this oven')
  expect(
    labelArtworkAssignment(w, {
      target: 'productIcon',
      assetId: 'wheat',
      productId: 'bread',
    })[0].record.graphicAssetId,
  ).toBe('wheat')
  expect(
    labelArtworkAssignment(w, {
      target: 'businessLogo',
      assetId: 'secondary',
    })[0].record.logoAssetId,
  ).toBe('secondary')
})
it('embeds the exact linked artwork from the print data snapshot', async () => {
  const w = fixture(),
    snapshot = resolveLabelData(w, { kind: 'product', id: 'bread' }),
    doc = blankLabel()
  doc.elements = [
    {
      ...newElement('image'),
      binding: 'product.graphic',
      width: 50,
      height: 50,
    },
  ]
  w.products[0].graphicAssetId = 'cookie-art'
  const image = vi.fn(
    async (_asset: { id: string }) =>
      new Uint8Array(await readFile('public/favicon-48.png')),
  )
  const pdf = await exportLabelPdf(
    doc,
    snapshot,
    w.graphic_assets,
    1,
    undefined,
    {
      image,
      font: async () => {
        throw new Error('No text')
      },
    },
  )
  expect(image.mock.calls[0][0]).toMatchObject({ id: 'wheat' })
  expect(pdf.length).toBeGreaterThan(100)
})

it('migrates legacy links without overwriting artwork or reviving a cleared selection', () => {
  const w = fixture()
  w.products[0].graphicAssetId = ''
  expect(
    resolveLabelData(w, { kind: 'product', id: 'bread' }).values[
      'product.graphic'
    ],
  ).toBe('leaf')
  w.products[0].labelArtworkVersion = 2
  expect(
    resolveLabelData(w, { kind: 'product', id: 'bread' }).values[
      'product.graphic'
    ],
  ).toBe('')
  const updated = labelArtworkAssignment(w, {
    target: 'productIcon',
    assetId: 'wheat',
    productId: 'bread',
  })[0].record
  expect(updated.graphicAssetId).toBe('wheat')
  expect(updated.iconAssetId).toBe('leaf')
  expect(w.graphic_assets.some((a) => a.id === 'leaf')).toBe(true)
  const doc = blankLabel()
  const old = {
    ...newElement('image'),
    binding: 'product.icon',
    x: 17,
    y: 23,
    rotation: 32,
    width: 53,
    height: 47,
  }
  doc.elements = [{ ...old }]
  validateLabelDocument(doc)
  expect(doc.elements[0]).toEqual({ ...old, binding: 'product.graphic' })
})
it('omits absent bound graphics from PDFs without loading a placeholder', async () => {
  const w = fixture(),
    doc = blankLabel()
  w.products[0].graphicAssetId = ''
  w.products[0].labelArtworkVersion = 2
  doc.elements = [{ ...newElement('image'), binding: 'product.graphic' }]
  const image = vi.fn()
  const bytes = await exportLabelPdf(
    doc,
    resolveLabelData(w, { kind: 'product', id: 'bread' }),
    w.graphic_assets,
    1,
    undefined,
    { image, font: vi.fn() },
  )
  expect(bytes.length).toBeGreaterThan(100)
  expect(image).not.toHaveBeenCalled()
})
