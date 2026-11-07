import fontkit from '@pdf-lib/fontkit'
import { load } from 'cheerio'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Resvg } from '@resvg/resvg-js'
import { PDFDocument } from 'pdf-lib'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { LabelCanvas } from '../../src/components/label-canvas'
import {
  labelFonts,
  elementAssetId,
  elementVisible,
  type LabelData,
  type LabelDocument,
} from '../../src/lib/label-studio'
import {
  withLibraryArtwork,
  libraryArtwork,
} from '../../src/lib/artwork-library'
import {
  validateSheet,
  type SheetLayout,
} from '../../src/lib/label-print-layout'
import type { LabelFont } from '../../src/lib/label-font-catalog'
import type { Item } from '../../src/lib/domain'

/** The same SVG used by the editor, rasterized at 300 DPI with explicit fonts/assets. */
export async function exportSvgLabelPdf(
  documents: LabelDocument[],
  data: LabelData,
  assets: Item[],
  layout: SheetLayout,
  loaders: {
    fonts: LabelFont[]
    font: (key: string) => Promise<Uint8Array>
    image: (asset: Item) => Promise<Uint8Array>
  },
) {
  if (!documents.length || documents.length > 200)
    throw new Error('Choose 1–200 individual labels per run.')
  const first = documents[0]
  for (const document of documents) {
    if (
      document.width !== first.width ||
      document.height !== first.height ||
      document.round !== first.round
    )
      throw new Error('Different stock sizes require separate print runs.')
    validateSheet(document, layout)
  }
  const pdf = await PDFDocument.create()
  const images = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>()
  const available = [...labelFonts, ...loaders.fonts]
  for (const document of documents) {
    const key = JSON.stringify(document)
    if (images.has(key)) continue
    const fontKeys = new Set<string>()
    for (const element of document.elements.filter(
      (e) => e.type === 'text' && elementVisible(e, data),
    )) {
      for (const name of [
        element.font,
        ...(element.textRuns || []).map((run) => run.font),
      ]) {
        const font = available.find((f) => f.name === name)
        if (!font)
          throw new Error(
            `Font “${name}” is unavailable. No substitute is exported.`,
          )
        fontKeys.add(
          font.file +
            (element.bold && font.weights.includes(700) ? '-bold' : ''),
        )
      }
    }
    const fontNames = new Map<string, string>()
    const fontBuffers = await Promise.all(
      [...fontKeys].map(async (key) => {
        const bytes = Buffer.from(await loaders.font(key))
        if (
          bytes.length < 4 ||
          !(
            bytes.readUInt32BE(0) === 0x00010000 ||
            bytes.toString('ascii', 0, 4) === 'OTTO'
          )
        )
          throw new Error(
            'This PDF renderer needs a TTF or OTF font. Your design is preserved; use browser printing or PNG for uploaded WOFF/WOFF2 fonts.',
          )
        const face = fontkit.create(bytes)
        const alias = available.find(
          (f) => key === f.file || key === f.file + '-bold',
        )?.name
        if (!face.familyName)
          throw new Error('The selected font has no usable family metadata.')
        if (alias) fontNames.set(alias, face.familyName)
        return bytes
      }),
    )
    const inlined: Item[] = []
    for (const id of new Set(
      document.elements
        .filter((e) => e.type === 'image' && elementVisible(e, data))
        .map((e) => elementAssetId(e, data))
        .filter(Boolean),
    )) {
      const asset = withLibraryArtwork(assets).find((a) => a.id === id)
      if (!asset) throw new Error('Label artwork is unavailable.')
      const original = libraryArtwork(id)
      const bytes = original
        ? await readFile(resolve('public', original.printUrl.slice(1)))
        : await loaders.image(asset)
      inlined.push({
        ...asset,
        fileUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
      })
    }
    const markup = renderToStaticMarkup(
      createElement(LabelCanvas, { document, data, assets: inlined }),
    )
    const xml = load(markup, { xml: true })
    xml('[font-family]').each((_, node) => {
      const name = (xml(node).attr('font-family') || '').replace(/^"|"$/g, '')
      if (fontNames.has(name))
        xml(node).attr('font-family', JSON.stringify(fontNames.get(name)))
    })
    const svg = xml.xml()
    const fontDirectory = await mkdtemp(join(tmpdir(), 'cottage-label-fonts-'))
    try {
      const fontFiles = await Promise.all(
        fontBuffers.map(async (bytes, i) => {
          // mkdtemp already returns an absolute path. Resolving its unknown
          // directory against cwd makes file tracers glob the whole repository
          // for TTF files, including copies inside generated function packages.
          const path = join(fontDirectory, `${i}.ttf`)
          await writeFile(path, bytes)
          return path
        }),
      )
      const rendered = new Resvg(svg, {
        fitTo: { mode: 'width', value: Math.ceil((document.width / 72) * 300) },
        font: { fontFiles, loadSystemFonts: false },
      }).render()
      images.set(key, await pdf.embedPng(rendered.asPng()))
    } finally {
      await rm(fontDirectory, { recursive: true, force: true })
    }
  }
  const sheet = layout.mode === 'sheet'
  const capacity = sheet ? layout.rows * layout.columns : 1
  for (let start = 0; start < documents.length; start += capacity) {
    const page = pdf.addPage(
      sheet
        ? [layout.pageWidth, layout.pageHeight]
        : [first.width, first.height],
    )
    for (let i = 0; i < Math.min(capacity, documents.length - start); i++) {
      page.drawImage(images.get(JSON.stringify(documents[start + i]))!, {
        x:
          (sheet
            ? layout.margin +
              (i % layout.columns) * (first.width + layout.gutter)
            : 0) + (layout.offsetX || 0),
        y:
          page.getHeight() -
          first.height -
          (sheet
            ? layout.margin +
              Math.floor(i / layout.columns) * (first.height + layout.gutter)
            : 0) -
          (layout.offsetY || 0),
        width: first.width,
        height: first.height,
      })
    }
  }
  return pdf.save()
}
