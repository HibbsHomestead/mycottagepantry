import { inlineLabelSvg } from './label-client-export'
import { validateSheet, type SheetLayout } from './label-print-layout'
import { points, checkPrinterSize, type PrinterProfile } from './label-printers'
import type { LabelDocument } from './label-studio'
import type { LabelFont } from './label-font-catalog'
import type { Item } from './domain'
export function printPageHtml(
  markup: string,
  d: LabelDocument,
  copies: number,
  layout: SheetLayout,
  profile?: PrinterProfile,
  sequence?: string[],
) {
  validateSheet(d, layout)
  if (!Number.isInteger(copies) || copies < 1 || copies > 200)
    throw new Error('Choose 1–200 labels.')
  if (profile && layout.mode !== 'sheet') checkPrinterSize(d, profile)
  if (sequence && sequence.length !== copies)
    throw new Error('Label sequence and copy count disagree.')
  const sheet = layout.mode === 'sheet',
    pw = sheet ? layout.pageWidth : d.width,
    ph = sheet ? layout.pageHeight : d.height,
    per = sheet ? layout.columns * layout.rows : 1
  const x = profile ? points(profile.offsetX, profile.unit) : 0,
    y = profile ? points(profile.offsetY, profile.unit) : 0
  let pages = ''
  for (let n = 0; n < copies; n += per) {
    let labels = ''
    for (let k = 0; k < Math.min(per, copies - n); k++)
      labels += `<div class="label" style="width:${d.width}pt;height:${d.height}pt">${sequence ? sequence[n + k] : markup}</div>`
    pages += `<section class="page"><div class="labels">${labels}</div></section>`
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cottage Pantry labels</title><style>@page{size:${pw}pt ${ph}pt;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:white}.page{width:${pw}pt;height:${ph}pt;break-after:page;overflow:hidden}.page:last-child{break-after:auto}.labels{display:grid;grid-template-columns:repeat(${sheet ? layout.columns : 1},${d.width}pt);gap:${sheet ? layout.gutter : 0}pt;padding:${sheet ? layout.margin : 0}pt;transform:translate(${x}pt,${y}pt)}.label{overflow:hidden;flex-shrink:0}.label svg{display:block;width:${d.width}pt;height:${d.height}pt;background:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${pages}</body></html>`
}
export async function browserPrint(
  svg: SVGSVGElement,
  d: LabelDocument,
  assets: Item[],
  fonts: LabelFont[],
  copies: number,
  layout: SheetLayout,
  profile?: PrinterProfile,
  labels?: { svg: SVGSVGElement; document: LabelDocument }[],
) {
  const prepared = await inlineLabelSvg(svg, d, assets, fonts)
  const cache = new Map<SVGSVGElement, string>()
  const sequence: string[] | undefined = labels ? [] : undefined
  for (const label of labels || []) {
    if (
      label.document.width !== d.width ||
      label.document.height !== d.height ||
      label.document.round !== d.round
    )
      throw new Error('Different label stocks require separate print runs.')
    if (!cache.has(label.svg))
      cache.set(
        label.svg,
        new XMLSerializer().serializeToString(
          await inlineLabelSvg(label.svg, label.document, assets, fonts),
        ),
      )
    sequence!.push(cache.get(label.svg)!)
  }
  // Keep the app and its modal mounted. This document contains only print output.
  document
    .querySelectorAll('iframe[data-label-print]')
    .forEach((f) => f.remove())
  const frame = document.createElement('iframe')
  frame.dataset.labelPrint = 'true'
  frame.title = 'Label print output'
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText =
    'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0'
  const previousFocus = document.activeElement as HTMLElement | null
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve()
      frame.onerror = () =>
        reject(new Error('The print document could not load.'))
    })
    frame.srcdoc = printPageHtml(
      new XMLSerializer().serializeToString(prepared),
      d,
      copies,
      layout,
      profile,
      sequence,
    )
    document.body.append(frame)
    await Promise.race([
      (async () => {
        await loaded
        const target = frame.contentWindow
        if (!target) throw new Error('The print document is unavailable.')
        target.document.body.getBoundingClientRect()
        // FontFaceSet.ready alone can resolve before SVG text discovers a face.
        // Explicitly load the label's faces before allowing the native dialog.
        await Promise.all(
          (labels
            ? labels.flatMap((label) => label.document.elements)
            : d.elements
          )
            .filter((e) => e.type === 'text')
            .flatMap((e) =>
              [e.font, ...(e.textRuns || []).map((run) => run.font)]
                .filter(Boolean)
                .flatMap((font) =>
                  [400, 700].map((weight) =>
                    target.document.fonts.load(
                      `${weight} 12pt ${JSON.stringify(font)}`,
                    ),
                  ),
                ),
            ),
        )
        await target.document.fonts.ready
        if ([...target.document.fonts].some((font) => font.status === 'error'))
          throw new Error('A label font could not load. Printing is blocked.')
        await Promise.all([
          ...Array.from(target.document.images).map((image) => image.decode()),
          ...Array.from(target.document.querySelectorAll('svg image')).map(
            async (svgImage) => {
              const image = new Image()
              image.src = svgImage.getAttribute('href') || ''
              await image.decode()
            },
          ),
        ])
        await new Promise<void>((resolve) =>
          target.requestAnimationFrame(() =>
            target.requestAnimationFrame(() => resolve()),
          ),
        )
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                'Label fonts or images did not finish loading. Try printing again.',
              ),
            ),
          25000,
        )
      }),
    ])
    clearTimeout(timeout)
    const target = frame.contentWindow!
    target.addEventListener(
      'afterprint',
      () => {
        frame.remove()
        previousFocus?.focus()
      },
      { once: true },
    )
    target.focus()
    target.print()
  } catch (error) {
    frame.remove()
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
