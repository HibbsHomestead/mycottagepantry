import { withLibraryArtwork } from './artwork-library'
import { effectiveFill } from './label-colors'
import { assetPng } from './label-client-export'
import { type LabelFont, fontFileUrl } from './label-font-catalog'
import {
  PDFDocument,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  degrees,
  rectangle,
  clip,
  endPath,
  moveTo,
  appendBezierCurve,
  closePath,
  setTextRenderingMode,
  TextRenderingMode,
  setLineWidth,
  setStrokingRgbColor,
  setGraphicsState,
} from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import {
  bakeryGraphics,
  withLabelBackgrounds,
  elementAssetId,
  elementVisible,
  labelFonts,
  labelTextLines,
  labelTextRuns,
  type LabelDocument,
  type LabelData,
} from './label-studio'
import type { Item } from './domain'
import {
  defaultSheet,
  validateSheet,
  type SheetLayout,
} from './label-print-layout'
export {
  defaultSheet,
  validateSheet,
  type SheetLayout,
} from './label-print-layout'
const rgbHex = (hex: string) => {
  const h = hex === 'transparent' ? '#ffffff' : hex
  return rgb(
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  )
}
export async function exportLabelPdf(
  d: LabelDocument,
  data: LabelData,
  assets: Item[],
  copies = 1,
  layout: SheetLayout = defaultSheet,
  loaders?: {
    fonts?: LabelFont[]
    font: (key: string) => Promise<Uint8Array>
    image: (asset: Item) => Promise<Uint8Array>
  },
): Promise<Uint8Array> {
  d = withLabelBackgrounds(d)
  validateSheet(d, layout)
  const availableFonts = [...labelFonts, ...(loaders?.fonts || [])]
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const fonts = new Map<string, Awaited<ReturnType<typeof pdf.embedFont>>>(),
    images = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>()
  for (const e of d.elements.filter((e) => elementVisible(e, data))) {
    if (e.type === 'image' && e.binding && !elementAssetId(e, data)) continue
    if (e.type === 'text') {
      for (const run of labelTextRuns(e, data)) {
        const name = run.font
        const f = availableFonts.find((f) => f.name === name)
        if (!f)
          throw new Error(
            `Font “${name}” is unavailable. Upload the authorized font before exporting; no substitute is exported.`,
          )
        const suffix =
          (run.bold ?? e.bold) && f.weights.includes(700) ? '-bold' : ''
        const key = f.file + suffix
        if (!fonts.has(key)) {
          const bytes = loaders
            ? await loaders.font(key)
            : await (async () => {
                const r = await fetch(fontFileUrl(key))
                if (!r.ok)
                  throw new Error(
                    `The print font for ${f.name} could not be loaded. Choose a bundled font or try again; no substitute is exported.`,
                  )
                return new Uint8Array(await r.arrayBuffer())
              })()
          fonts.set(key, await pdf.embedFont(bytes, { subset: true }))
        }
      }
    }
    if (e.type === 'image') {
      const a = withLibraryArtwork(assets).find(
        (a) => a.id === elementAssetId(e, data),
      )
      if (!a) throw new Error('An image is unavailable.')
      if (!images.has(a.id))
        images.set(
          a.id,
          await pdf.embedPng(
            loaders ? await loaders.image(a) : await assetPng(a),
          ),
        )
    }
  }
  const capacity = layout.mode === 'sheet' ? layout.rows * layout.columns : 1
  for (let first = 0; first < copies; first += capacity) {
    const page = pdf.addPage(
      layout.mode === 'sheet'
        ? [layout.pageWidth, layout.pageHeight]
        : [d.width, d.height],
    )
    for (let j = 0; j < Math.min(capacity, copies - first); j++) {
      const ox =
          (layout.mode === 'sheet'
            ? layout.margin + (j % layout.columns) * (d.width + layout.gutter)
            : 0) + (layout.offsetX || 0),
        oy =
          layout.mode === 'sheet'
            ? layout.margin +
              Math.floor(j / layout.columns) * (d.height + layout.gutter)
            : 0,
        top = page.getHeight() - oy - (layout.offsetY || 0)
      page.pushOperators(pushGraphicsState())
      if (d.round) {
        const cx = ox + d.width / 2,
          cy = top - d.height / 2,
          rx = d.width / 2,
          ry = d.height / 2,
          k = 0.5522847498
        page.pushOperators(
          moveTo(cx + rx, cy),
          appendBezierCurve(
            cx + rx,
            cy + ry * k,
            cx + rx * k,
            cy + ry,
            cx,
            cy + ry,
          ),
          appendBezierCurve(
            cx - rx * k,
            cy + ry,
            cx - rx,
            cy + ry * k,
            cx - rx,
            cy,
          ),
          appendBezierCurve(
            cx - rx,
            cy - ry * k,
            cx - rx * k,
            cy - ry,
            cx,
            cy - ry,
          ),
          appendBezierCurve(
            cx + rx * k,
            cy - ry,
            cx + rx,
            cy - ry * k,
            cx + rx,
            cy,
          ),
          closePath(),
          clip(),
          endPath(),
        )
      } else
        page.pushOperators(
          rectangle(ox, top - d.height, d.width, d.height),
          clip(),
          endPath(),
        )
      if (d.round)
        page.drawEllipse({
          x: ox + d.width / 2,
          y: top - d.height / 2,
          xScale: d.width / 2,
          yScale: d.height / 2,
          color: rgbHex(d.background),
          opacity:
            d.background === 'transparent' ? 0 : (d.backgroundOpacity ?? 1),
        })
      else
        page.drawRectangle({
          x: ox,
          y: top - d.height,
          width: d.width,
          height: d.height,
          color: rgbHex(d.background),
          opacity:
            d.background === 'transparent' ? 0 : (d.backgroundOpacity ?? 1),
        })
      for (const e of d.elements.filter((e) => elementVisible(e, data))) {
        if (e.type === 'image' && e.binding && !elementAssetId(e, data))
          continue
        const rad = (e.rotation * Math.PI) / 180
        page.pushOperators(
          pushGraphicsState(),
          concatTransformationMatrix(
            Math.cos(rad),
            -Math.sin(rad),
            Math.sin(rad),
            Math.cos(rad),
            ox + e.x,
            top - e.y,
          ),
        )
        const color = rgbHex(e.color),
          opacity =
            e.opacity * (e.color === 'transparent' ? 0 : (e.colorOpacity ?? 1))
        if (e.type === 'text') {
          const face = (name: string, bold = e.bold) => {
            const f = availableFonts.find((f) => f.name === name)!
            return fonts.get(
              f.file + (bold && f.weights.includes(700) ? '-bold' : ''),
            )!
          }
          const lines = labelTextLines(
              e,
              data,
              (text, name, bold) =>
                Array.from(text).reduce(
                  (sum, char) =>
                    sum + face(name, bold).widthOfTextAtSize(char, e.fontSize),
                  0,
                ) +
                Math.max(0, Array.from(text).length - 1) * e.letterSpacing,
            ),
            lineHeight = e.fontSize * e.lineHeight,
            total = lines.length * lineHeight
          const start =
            e.vertical === 'middle'
              ? (e.height - total) / 2
              : e.vertical === 'bottom'
                ? e.height - total
                : 0
          if (e.fill !== 'transparent')
            page.drawRectangle({
              x: 0,
              y: -e.height,
              width: e.width,
              height: e.height,
              color: rgbHex(e.fill),
              opacity: e.opacity * (e.fillOpacity ?? 1),
            })
          for (const [i, line] of lines.entries()) {
            const width =
                line.reduce(
                  (sum, run) =>
                    sum +
                    Array.from(run.text).reduce(
                      (width, char) =>
                        width +
                        face(run.font, run.bold ?? e.bold).widthOfTextAtSize(
                          char,
                          e.fontSize,
                        ),
                      0,
                    ),
                  0,
                ) +
                Math.max(
                  0,
                  line.reduce((n, run) => n + Array.from(run.text).length, 0) -
                    1,
                ) *
                  e.letterSpacing,
              x =
                e.align === 'center'
                  ? (e.width - width) / 2
                  : e.align === 'right'
                    ? e.width - width
                    : 0,
              y = -start - e.fontSize - i * lineHeight
            // Per-character positioning preserves explicit letter spacing in vector text.
            let cursor = x
            for (const run of line) {
              const font = face(run.font, run.bold ?? e.bold)
              const outline =
                run.bold &&
                !availableFonts
                  .find((f) => f.name === run.font)
                  ?.weights.includes(700)
              if (outline)
                page.pushOperators(
                  pushGraphicsState(),
                  setGraphicsState(
                    page.node.newExtGState(
                      'IngredientBold',
                      pdf.context.register(pdf.context.obj({ CA: opacity })),
                    ),
                  ),
                  setLineWidth(e.fontSize * 0.02),
                  setStrokingRgbColor(color.red, color.green, color.blue),
                  setTextRenderingMode(TextRenderingMode.FillAndOutline),
                )
              for (const char of run.text) {
                page.drawText(char, {
                  x: cursor,
                  y,
                  size: e.fontSize,
                  font,
                  color,
                  opacity,
                  xSkew: degrees(e.italic ? 12 : 0),
                })
                cursor +=
                  font.widthOfTextAtSize(char, e.fontSize) + e.letterSpacing
              }
              if (outline)
                page.pushOperators(
                  setTextRenderingMode(TextRenderingMode.Fill),
                  popGraphicsState(),
                )
            }
            if (e.underline)
              page.drawLine({
                start: { x, y: y - 1 },
                end: { x: x + width, y: y - 1 },
                thickness: 0.5,
                color,
                opacity,
              })
          }
        } else if (e.type === 'line')
          page.drawLine({
            start: { x: 0, y: 0 },
            end: { x: e.width, y: -e.height },
            thickness: 1,
            color,
            opacity,
          })
        else if (e.type === 'shape' || e.type === 'border')
          page.drawRectangle({
            x: 0,
            y: -e.height,
            width: e.width,
            height: e.height,
            borderColor: color,
            borderWidth: 1,
            color:
              e.type === 'shape' && effectiveFill(e) !== 'transparent'
                ? rgbHex(effectiveFill(e))
                : undefined,
            opacity:
              effectiveFill(e) === 'transparent'
                ? 0
                : e.opacity * (e.fillOpacity ?? 1),
            borderOpacity: opacity,
          })
        else if (e.type === 'illustration') {
          const scale = Math.min(e.width, e.height) / 100
          page.drawSvgPath(
            bakeryGraphics[e.graphic || 'bread'] || bakeryGraphics.bread,
            {
              x: (e.width - 100 * scale) / 2,
              y: -(e.height - 100 * scale) / 2,
              scale,
              borderColor: color,
              borderWidth: 2,
              opacity,
            },
          )
        } else if (e.type === 'image') {
          const image = images.get(elementAssetId(e, data))!
          const ratio = (e.fit === 'cover' ? Math.max : Math.min)(
            e.width / image.width,
            e.height / image.height,
          )
          page.pushOperators(
            rectangle(0, -e.height, e.width, e.height),
            clip(),
            endPath(),
          )
          page.drawImage(image, {
            x: (e.width - image.width * ratio) / 2,
            y: -(e.height + image.height * ratio) / 2,
            width: image.width * ratio,
            height: image.height * ratio,
            opacity: e.opacity,
          })
        }
        page.pushOperators(popGraphicsState())
      }
      page.pushOperators(popGraphicsState())
    }
  }
  return pdf.save()
}

export { assetPng, downloadLabel, exportLabelPng } from './label-client-export'
