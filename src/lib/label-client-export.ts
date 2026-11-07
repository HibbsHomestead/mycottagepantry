import { libraryArtwork, withLibraryArtwork } from './artwork-library'
import { type LabelFont, fontFileUrl } from './label-font-catalog'
import { labelFonts, type LabelDocument } from './label-studio'
import type { Item } from './domain'
export async function assetPng(asset: Item): Promise<Uint8Array> {
  const original = libraryArtwork(asset.id)
  if (original) {
    const response = await fetch(original.printUrl)
    if (!response.ok) throw new Error(`Cannot load ${original.name}.`)
    return new Uint8Array(await response.arrayBuffer())
  }
  const r = await fetch(asset.fileUrl)
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
            b ? resolve(b) : reject(new Error('Image could not be decoded.')),
          'image/png',
        ),
      )
    ).arrayBuffer(),
  )
}
export function downloadLabel(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type })),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
export async function inlineLabelSvg(
  svg: SVGSVGElement,
  d: LabelDocument,
  assets: Item[],
  customFonts: LabelFont[] = [],
): Promise<SVGSVGElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.querySelectorAll('[data-editor-only]').forEach((n) => n.remove())
  clone.setAttribute('width', String((d.width / 72) * 300))
  clone.setAttribute('height', String((d.height / 72) * 300))
  const toData = (bytes: Uint8Array) => {
    let s = ''
    for (let i = 0; i < bytes.length; i += 8192)
      s += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return btoa(s)
  }
  let css = ''
  const used = new Set(
    d.elements
      .filter((e) => e.type === 'text')
      .flatMap((e) => [e.font, ...(e.textRuns || []).map((r) => r.font)]),
  )
  for (const name of used)
    if (![...labelFonts, ...customFonts].some((f) => f.name === name))
      throw new Error(
        `Font “${name}” is unavailable. Upload it before printing or exporting.`,
      )
  for (const f of [...labelFonts, ...customFonts].filter((f) =>
    used.has(f.name),
  )) {
    const r = await fetch(fontFileUrl(f.file))
    if (!r.ok) throw new Error('Could not load export font.')
    css += `@font-face{font-family:${JSON.stringify(f.name)};src:url(data:font/${f.browserFormat === 'woff2' ? 'woff2' : f.browserFormat === 'woff' ? 'woff' : f.browserFormat === 'opentype' ? 'otf' : 'ttf'};base64,${toData(new Uint8Array(await r.arrayBuffer()))});font-weight:400}`
    if (f.weights.includes(700)) {
      const b = await fetch(fontFileUrl(f.file + '-bold'))
      if (!b.ok) throw new Error('Could not load bold export font.')
      css += `@font-face{font-family:${JSON.stringify(f.name)};src:url(data:font/ttf;base64,${toData(new Uint8Array(await b.arrayBuffer()))});font-weight:700}`
    }
  }
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = css
  clone.prepend(style)
  for (const img of clone.querySelectorAll('image')) {
    const a = withLibraryArtwork(assets).find(
      (a) => img.getAttribute('href') === a.fileUrl,
    )
    if (a)
      img.setAttribute(
        'href',
        'data:image/png;base64,' + toData(await assetPng(a)),
      )
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
