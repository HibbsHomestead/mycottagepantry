import { labelFontMetrics } from './label-font-metrics'
import { libraryArtwork, withLibraryArtwork } from './artwork-library'
import {
  type LabelFont,
  fontFileUrl,
  fontFaceKey,
} from './label-font-catalog'
import { labelFonts, type LabelDocument } from './label-studio'
import type { Item } from './domain'
/** Load real custom/online font advances before laying out a saved auto-fit design. */
export async function loadLabelFitMetrics(
  d: LabelDocument,
  customFonts: LabelFont[] = [],
) {
  let changed = false
  const elements = [...d.elements, ...(d.back?.elements || [])].filter(
    (e) => e.autoFit,
  )
  const names = new Set(
    elements.flatMap((e) => [
      e.font,
      ...(e.textRuns || []).map((r) => r.font),
    ]),
  )
  for (const font of [...labelFonts, ...customFonts].filter(
    (f) => names.has(f.name) && f.source !== 'bundled',
  )) {
    for (const bold of [false, true]) {
      const key = fontFaceKey(font, bold)
      if (!labelFontMetrics[key]?.__ascent) {
        const response = await fetch(
          fontFileUrl(key) + '&metrics=1&layout=2',
        )
        if (!response.ok)
          throw new Error(
            'The ingredient font could not load. Try again before printing or exporting.',
          )
        labelFontMetrics[key] = await response.json()
        changed = true
      }
      labelFontMetrics[font.name + (bold ? '-bold' : '')] =
        labelFontMetrics[key]
    }
  }
  return changed
}
export async function assetPng(
  asset: Item,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const original = libraryArtwork(asset.id)
  if (original) {
    const response = await fetch(original.printUrl, { signal })
    if (!response.ok) throw new Error(`Cannot load ${original.name}.`)
    return new Uint8Array(await response.arrayBuffer())
  }
  const r = await fetch(asset.fileUrl, { signal })
  if (!r.ok) throw new Error(`Cannot load ${asset.name}.`)
  const blob = await r.blob(),
    bitmap = await createImageBitmap(blob),
    canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return new Uint8Array(
    await (
      await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b
              ? resolve(b)
              : reject(new Error('Image could not be decoded.')),
          'image/png',
        ),
      )
    ).arrayBuffer(),
  )
}
export function downloadLabel(
  bytes: Uint8Array,
  name: string,
  type: string,
) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type })),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
const toData = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(s)
}

export function labelArtworkPreparation(
  assets: Item[],
  customFonts: LabelFont[],
  signal?: AbortSignal,
  share = false,
) {
  const catalog = new Map(
    withLibraryArtwork(assets).map((asset) => [asset.fileUrl, asset]),
  )
  const faces = new Map<string, Promise<string>>()
  const images = new Map<string, Promise<string>>()
  const objectUrls = new Set<string>()
  const names = [...labelFonts, ...customFonts]
  return {
    font(name: string) {
      const font = names.find((entry) => entry.name === name)
      if (!font)
        throw new Error(
          `Font “${name}” is unavailable. Upload it before printing or exporting.`,
        )
      if (!faces.has(name))
        faces.set(
          name,
          Promise.all(
            (font.weights.includes(700) ? [400, 700] : [400]).map(
              async (weight) => {
                const response = await fetch(
                  fontFileUrl(font.file + (weight === 700 ? '-bold' : '')),
                  { signal },
                )
                if (!response.ok)
                  throw new Error(`Could not load label font “${name}”.`)
                const format =
                  weight === 700
                    ? 'ttf'
                    : (
                        {
                          woff2: 'woff2',
                          woff: 'woff',
                          opentype: 'otf',
                        } as Record<string, string>
                      )[font.browserFormat || ''] || 'ttf'
                return `@font-face{font-family:${JSON.stringify(name)};src:url(data:font/${format};base64,${toData(new Uint8Array(await response.arrayBuffer()))});font-weight:${weight}}`
              },
            ),
          ).then((rules) => rules.join('')),
        )
      return faces.get(name)!
    },
    image(url: string) {
      const asset = catalog.get(url)
      if (!asset) return Promise.resolve(url)
      if (!images.has(url))
        images.set(
          url,
          assetPng(asset, signal).then((bytes) => {
            signal?.throwIfAborted()
            if (!share) return 'data:image/png;base64,' + toData(bytes)
            const objectUrl = URL.createObjectURL(
              new Blob([bytes as BlobPart], { type: 'image/png' }),
            )
            objectUrls.add(objectUrl)
            return objectUrl
          }),
        )
      return images.get(url)!
    },
    async css() {
      return (await Promise.all(faces.values())).join('')
    },
    dispose() {
      for (const url of objectUrls) URL.revokeObjectURL(url)
      objectUrls.clear()
    },
  }
}

export async function inlineLabelSvg(
  svg: SVGSVGElement,
  d: LabelDocument,
  assets: Item[],
  customFonts: LabelFont[] = [],
  shared?: ReturnType<typeof labelArtworkPreparation>,
): Promise<SVGSVGElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.querySelectorAll('[data-editor-only]').forEach((n) => n.remove())
  clone.setAttribute('width', String((d.width / 72) * 300))
  clone.setAttribute('height', String((d.height / 72) * 300))
  const preparation = shared || labelArtworkPreparation(assets, customFonts)
  const used = new Set(
    d.elements
      .filter((e) => e.type === 'text')
      .flatMap((e) => [e.font, ...(e.textRuns || []).map((r) => r.font)]),
  )
  await Promise.all([
    ...[...used].map((name) => preparation.font(name)),
    ...[...clone.querySelectorAll('image')].map(async (image) => {
      const url = image.getAttribute('href')
      if (url) image.setAttribute('href', await preparation.image(url))
    }),
  ])
  if (!shared) {
    const style = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'style',
    )
    style.textContent = await preparation.css()
    clone.prepend(style)
  }
  return clone
}
export async function exportLabelPng(
  svg: SVGSVGElement,
  d: LabelDocument,
  assets: Item[],
  customFonts: LabelFont[] = [],
): Promise<Uint8Array> {
  const clone = await inlineLabelSvg(svg, d, assets, customFonts)
  const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(clone)], {
        type: 'image/svg+xml;charset=utf-8',
      }),
    ),
    image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () =>
        reject(new Error('PNG rendering failed. Try PDF export.'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = (d.width / 72) * 300
    canvas.height = (d.height / 72) * 300
    canvas.getContext('2d')!.drawImage(image, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('PNG export failed.'))),
        'image/png',
      ),
    )
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}
