/** All geometry uses original, orientation-corrected base-image pixels. */
export type Placement = {
  x: number
  y: number
  width: number
  rotation: number
}
export type MockupComposition = {
  version: 1
  baseId: string
  artworkId: string
  placement: Placement
  area: { x: number; y: number; width: number; height: number }
  panelWidth: number
  panelHeight: number
  calibrated: boolean
}
export const initialPlacement: Placement = {
  x: 0,
  y: 0,
  width: 300,
  rotation: 0,
}
export function artworkHeight(p: Placement, width: number, height: number) {
  return (p.width * height) / width
}
export function validateComposition(
  input: unknown,
  assets: { id: string }[],
): MockupComposition {
  const c = input as MockupComposition
  if (
    !c ||
    c.version !== 1 ||
    !assets.some((a) => a.id === c.baseId) ||
    (c.artworkId && !assets.some((a) => a.id === c.artworkId))
  )
    throw new Error('Choose images from this business.')
  if (
    !c.placement ||
    !c.area ||
    ![
      c.placement.x,
      c.placement.y,
      c.placement.width,
      c.placement.rotation,
      c.area.x,
      c.area.y,
      c.area.width,
      c.area.height,
      c.panelWidth,
      c.panelHeight,
    ].every(
      (v) =>
        typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000,
    ) ||
    c.placement.width <= 0 ||
    c.area.width <= 0 ||
    c.area.height <= 0 ||
    (c.calibrated && !(c.panelWidth > 0 && c.panelHeight > 0))
  )
    throw new Error('Review placement and panel dimensions.')
  return {
    version: 1,
    baseId: c.baseId,
    artworkId: c.artworkId,
    placement: {
      x: c.placement.x,
      y: c.placement.y,
      width: c.placement.width,
      rotation: c.placement.rotation,
    },
    area: {
      x: c.area.x,
      y: c.area.y,
      width: c.area.width,
      height: c.area.height,
    },
    panelWidth: c.panelWidth,
    panelHeight: c.panelHeight,
    calibrated: c.calibrated === true,
  }
}
export async function loadMockupImage(url: string) {
  if (!url.startsWith('/api/workspace?asset='))
    throw new Error('Choose a private uploaded image.')
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok)
    throw new Error('Image unavailable. Reconnect and try again.')
  const blob = await response.blob()
  return createImageBitmap(blob, { imageOrientation: 'from-image' })
}
export function renderMockup(
  base: CanvasImageSource,
  art: CanvasImageSource | null,
  c: MockupComposition,
  bw: number,
  bh: number,
  aw: number,
  ah: number,
  exportWidth: number,
  background?: string,
) {
  const canvas = document.createElement('canvas')
  canvas.width = exportWidth
  canvas.height = Math.round((exportWidth * bh) / bw)
  const ctx = canvas.getContext('2d')!
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.scale(exportWidth / bw, exportWidth / bw)
  ctx.drawImage(base, 0, 0, bw, bh)
  if (art) {
    const p = c.placement,
      h = artworkHeight(p, aw, ah)
    ctx.translate(p.x + p.width / 2, p.y + h / 2)
    ctx.rotate((p.rotation * Math.PI) / 180)
    ctx.drawImage(art, -p.width / 2, -h / 2, p.width, h)
  }
  return canvas
}
export function canvasBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error('Export failed. Try a smaller output size.')),
      type,
      0.94,
    ),
  )
}
