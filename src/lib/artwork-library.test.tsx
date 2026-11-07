// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { artworkLibrary } from './artwork-library'
import { demoData } from './demo'
import {
  blankLabel,
  newElement,
  resolveLabelData,
  checkLabel,
} from './label-studio'
import { LabelCanvas } from '@/components/label-studio'
import { exportLabelPdf } from './label-export'

it('ships fourteen distinct validated original illustrations and matching print-safe derivatives', async () => {
  expect(artworkLibrary).toHaveLength(14)
  const hashes = new Set<string>()
  for (const asset of artworkLibrary) {
    const svg = await readFile('public' + asset.fileUrl, 'utf8')
    expect(svg).toContain('viewBox="0 0 120 96"')
    expect(svg).toContain('stroke-width="2.2"')
    expect(svg).not.toMatch(
      /<(script|foreignObject|image|use|text)\b|href=|on\w+=|url\(|gradient|filter/i,
    )
    expect(svg.match(/<(path|circle|ellipse)\b/g)!.length).toBeGreaterThan(1)
    hashes.add(createHash('sha256').update(svg).digest('hex'))
    const png = await readFile('public' + asset.printUrl)
    expect(await sharp(png).metadata()).toMatchObject({
      width: 1200,
      height: 960,
      hasAlpha: true,
    })
    const prepared = await sharp(Buffer.from(svg), { density: 720 })
      .resize(1200, 960)
      .png()
      .toBuffer()
    expect(prepared.equals(png)).toBe(true)
    expect(asset.license).toBe('CC0-1.0')
  }
  expect(hashes.size).toBe(14)
})
it('resolves different product artwork through one unchanged template for preview and actual PDF export', async () => {
  const w = demoData(),
    template = blankLabel(),
    before = structuredClone(template)
  template.elements = [
    { ...newElement('image', '', 'product.graphic'), width: 72, height: 58 },
  ]
  const documentBefore = structuredClone(template)
  w.products[0].graphicAssetId = artworkLibrary[0].id
  w.products[1].graphicAssetId = artworkLibrary[6].id
  const first = resolveLabelData(w, { kind: 'product', id: w.products[0].id })
  const second = resolveLabelData(w, { kind: 'product', id: w.products[1].id })
  const render = (data: typeof first) =>
    renderToStaticMarkup(
      <LabelCanvas document={template} data={data} assets={[]} />,
    )
  expect(render(first)).toContain('/artwork/bananas.svg')
  expect(render(second)).toContain('/artwork/spiced-orange.svg')
  expect(checkLabel(template, first, []).join()).not.toContain('image asset')
  const image = vi.fn(
    async (asset) => new Uint8Array(await readFile('public' + asset.printUrl)),
  )
  const bytes = await exportLabelPdf(template, first, [], 1, undefined, {
    image,
    font: async () => {
      throw new Error('no text')
    },
  })
  expect(bytes.length).toBeGreaterThan(100)
  expect(image.mock.calls[0][0].id).toBe(artworkLibrary[0].id)
  w.products[0].graphicAssetId = ''
  w.products[0].labelArtworkVersion = 2
  const empty = resolveLabelData(w, { kind: 'product', id: w.products[0].id })
  expect(render(empty)).not.toContain('<image')
  expect(template).toEqual(documentBefore)
  expect(before.id).toBe(template.id)
})
