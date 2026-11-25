import {
  inlineLabelSvg,
  labelArtworkPreparation,
} from './label-client-export'
import { validateSheet, type SheetLayout } from './label-print-layout'
import {
  points,
  printPlacement,
  checkPrinterSize,
  type PrinterProfile,
} from './label-printers'
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
  fontCss = '',
) {
  validateSheet(d, layout)
  if (!Number.isInteger(copies) || copies < 1 || copies > 200)
    throw new Error('Choose 1–200 labels.')
  if (profile && layout.mode !== 'sheet') checkPrinterSize(d, profile)
  if (sequence && sequence.length !== copies)
    throw new Error('Label sequence and copy count disagree.')
  const sheet = layout.mode === 'sheet',
    { media, matrix } = printPlacement(d, sheet ? undefined : profile),
    pw = sheet ? layout.pageWidth : media.width,
    ph = sheet ? layout.pageHeight : media.height,
    per = sheet ? layout.columns * layout.rows : 1
  const x =
      sheet && profile ? points(profile.offsetX, profile.unit) : matrix[4],
    y = sheet && profile ? points(profile.offsetY, profile.unit) : matrix[5]
  let pages = ''
  for (let n = 0; n < copies; n += per) {
    let labels = ''
    for (let k = 0; k < Math.min(per, copies - n); k++)
      labels += `<div class="label" style="width:${d.width}pt;height:${d.height}pt">${sequence ? sequence[n + k] : markup}</div>`
    pages += `<section class="page"><div class="labels">${labels}</div></section>`
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cottage Pantry labels</title><style>${fontCss.replaceAll('<', '\\3c ')}@page{size:${pw}pt ${ph}pt;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:white}.page{width:${pw}pt;height:${ph}pt;break-after:page;overflow:hidden;position:relative}.page:last-child{break-after:auto}.labels{position:absolute;top:0;left:0;display:grid;grid-template-columns:repeat(${sheet ? layout.columns : 1},${d.width}pt);gap:${sheet ? layout.gutter : 0}pt;padding:${sheet ? layout.margin : 0}pt;transform-origin:0 0;transform:translate(${x}pt,${y}pt) matrix(${matrix.slice(0, 4).join(',')},0,0)}.label{overflow:hidden;flex-shrink:0}.label svg{display:block;width:${d.width}pt;height:${d.height}pt;background:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${pages}</body></html>`
}

export type BrowserPrintOptions = {
  signal?: AbortSignal
  progress?: (message: string) => void
  timing?: (stage: string, elapsed: number) => void
}

const releaseFrame = new WeakMap<Element, () => void>()
export async function browserPrint(
  svg: SVGSVGElement,
  d: LabelDocument,
  assets: Item[],
  fonts: LabelFont[],
  copies: number,
  layout: SheetLayout,
  profile?: PrinterProfile,
  labels?: { svg: SVGSVGElement; document: LabelDocument }[],
  options: BrowserPrintOptions = {},
) {
  const started = performance.now()
  let last = started
  const mark = (stage: string) => {
    const now = performance.now()
    options.timing?.(stage, now - last)
    last = now
  }
  validateSheet(d, layout)
  if (
    !Number.isInteger(copies) ||
    copies < 1 ||
    copies > 200 ||
    (labels && labels.length !== copies)
  )
    throw new Error('Choose 1–200 labels with a matching sequence.')
  if (profile && layout.mode !== 'sheet') checkPrinterSize(d, profile)
  const designs = labels || [{ svg, document: d }]
  for (const label of designs) {
    if (
      label.document.width !== d.width ||
      label.document.height !== d.height ||
      label.document.round !== d.round
    )
      throw new Error('Different label stocks require separate print runs.')
  }
  mark('Validate print geometry')
  const controller = new AbortController()
  const signal = controller.signal
  const cancel = () =>
    controller.abort(
      new DOMException('Print preparation canceled.', 'AbortError'),
    )
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error(
          'Label fonts or images did not finish loading. Try printing again.',
        ),
      ),
    25000,
  )
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) cancel()
  const preparation = labelArtworkPreparation(assets, fonts, signal, true)
  const frame = document.createElement('iframe')
  frame.dataset.labelPrint = 'true'
  frame.title = 'Label print output'
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText =
    'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0'
  const previousFocus = document.activeElement as HTMLElement | null
  const cleanup = () => {
    frame.remove()
    preparation.dispose()
    releaseFrame.delete(frame)
  }
  const interrupted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason)
    else
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      })
  })
  try {
    await Promise.race([
      (async () => {
        signal.throwIfAborted()
        options.progress?.('Loading label fonts and artwork')
        const cache = new Map<SVGSVGElement, Promise<string>>()
        const serializer = new XMLSerializer()
        const sequence = await Promise.all(
          designs.map((label) => {
            if (!cache.has(label.svg))
              cache.set(
                label.svg,
                inlineLabelSvg(
                  label.svg,
                  label.document,
                  assets,
                  fonts,
                  preparation,
                ).then((prepared) =>
                  serializer.serializeToString(prepared),
                ),
              )
            return cache.get(label.svg)!
          }),
        )
        const css = await preparation.css()
        signal.throwIfAborted()
        mark('Load and embed fonts and artwork')
        options.progress?.('Preparing print pages')
        const loaded = new Promise<void>((resolve, reject) => {
          frame.onload = () => resolve()
          frame.onerror = () =>
            reject(new Error('The print document could not load.'))
        })
        frame.srcdoc = printPageHtml(
          sequence[0],
          d,
          copies,
          layout,
          profile,
          labels ? sequence : undefined,
          css,
        )
        mark('Paginate print document')
        document
          .querySelectorAll('iframe[data-label-print]')
          .forEach((old) => releaseFrame.get(old)?.())
        releaseFrame.set(frame, cleanup)
        document.body.append(frame)
        await loaded
        signal.throwIfAborted()
        mark('Load print frame')
        const target = frame.contentWindow
        if (!target) throw new Error('The print document is unavailable.')
        const imageUrls = new Set(
          [...target.document.querySelectorAll('svg image')].map((image) =>
            image.getAttribute('href'),
          ),
        )
        await Promise.all([
          ...[...target.document.fonts].map((font) =>
            font.load().catch(() => {
              throw new Error(
                `The label font ${font.family} could not load. Printing is blocked.`,
              )
            }),
          ),
          ...Array.from(target.document.images).map((image) =>
            image.decode(),
          ),
          ...[...imageUrls].map(async (url) => {
            const image = new Image()
            image.src = url || ''
            try {
              await image.decode()
            } catch {
              throw new Error(
                'A label image could not be decoded. Check the artwork and retry.',
              )
            }
          }),
        ])
        await target.document.fonts.ready
        target.document.body.getBoundingClientRect()
        mark('Decode assets and lay out print pages')
      })(),
      interrupted,
    ])
    signal.throwIfAborted()
    const target = frame.contentWindow!
    if (typeof target.print !== 'function')
      throw new Error(
        'Browser printing is unavailable. Download the PDF instead.',
      )
    target.addEventListener(
      'afterprint',
      () => {
        cleanup()
        previousFocus?.focus()
      },
      { once: true },
    )
    options.progress?.('Opening the browser print dialog')
    target.focus()
    options.timing?.(
      'App preparation to print call',
      performance.now() - started,
    )
    clearTimeout(timeout)
    target.print()
  } catch (error) {
    controller.abort()
    cleanup()
    throw error
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', cancel)
  }
}
