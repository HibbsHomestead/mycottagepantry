import type { Item } from './domain'
import { convert } from './domain'
export type ShelfMedia = {
  id: string
  name: string
  kind: 'tape' | 'fixed'
  width: number
  height: number
  marginX: number
  marginY: number
  dpi: number
  rotation: 0 | 90
  fontSize: number
  singleLine: boolean
}
export const defaultShelfMedia: ShelfMedia = {
  id: '',
  name: 'Custom media',
  kind: 'tape',
  width: 60,
  height: 20,
  marginX: 3,
  marginY: 3,
  dpi: 203,
  rotation: 0,
  fontSize: 12,
  singleLine: false,
}
export function validateShelfMedia(value: any): ShelfMedia {
  if (
    !value ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 100 ||
    !['tape', 'fixed'].includes(value.kind) ||
    ![0, 90].includes(value.rotation) ||
    typeof value.singleLine !== 'boolean'
  )
    throw new Error('Choose a media name, type and orientation.')
  const limits: Record<string, [number, number]> = {
    width: [5, 300],
    height: [5, 500],
    marginX: [0, 50],
    marginY: [0, 50],
    dpi: [72, 600],
    fontSize: [6, 72],
  }
  for (const [key, [min, max]] of Object.entries(limits))
    if (
      typeof value[key] !== 'number' ||
      !Number.isFinite(value[key]) ||
      value[key] < min ||
      value[key] > max
    )
      throw new Error(`Invalid media ${key}.`)
  if (
    value.width - value.marginX * 2 < 2 ||
    value.height - value.marginY * 2 < 2
  )
    throw new Error('Margins leave too little printable area.')
  return {
    id: String(value.id || '').slice(0, 100),
    name: value.name.trim(),
    kind: value.kind,
    width: value.width,
    height: value.height,
    marginX: value.marginX,
    marginY: value.marginY,
    dpi: value.dpi,
    rotation: value.rotation,
    fontSize: value.fontSize,
    singleLine: value.singleLine,
  }
}
export type ShelfFields = {
  location: boolean
  reorder: boolean
  sku: boolean
  barcode: boolean
  qr: boolean
  text: string
}
export function shelfLines(item: Item, fields: ShelfFields): string[] {
  const lines = [String(item.name || '')]
  if (fields.location && item.storageLocation)
    lines.push(String(item.storageLocation))
  if (fields.reorder && item.threshold != null) {
    const unit = item.storageUnit || item.unit
    lines.push(
      `Reorder: ${Number(convert(item.threshold, item.unit, unit, item.conversions).toFixed(6))} ${unit}`,
    )
  }
  if (fields.sku && item.sku) lines.push(`SKU: ${item.sku}`)
  if (fields.barcode && item.barcode) lines.push(String(item.barcode))
  if (fields.text.trim()) lines.push(fields.text.trim())
  return lines
}
export function shelfLayout(
  lines: string[],
  media: ShelfMedia,
  graphic: boolean,
) {
  const w =
    media.rotation === 90
      ? media.height - 2 * media.marginY
      : media.width - 2 * media.marginX
  const h =
    media.rotation === 90
      ? media.width - 2 * media.marginX
      : media.height - 2 * media.marginY
  const size = (media.fontSize * 25.4) / 72,
    lineHeight = size * 1.25
  const output: string[] = []
  // Conservative estimate; actual rendering also measures the selected browser font.
  const max = Math.max(1, Math.floor(w / (size * 0.65)))
  for (const line of media.singleLine ? [lines.join(' · ')] : lines) {
    if (media.singleLine) output.push(line)
    else {
      let rest = line
      while (rest.length > max) {
        let cut = rest.lastIndexOf(' ', max)
        if (cut < 1) cut = max
        output.push(rest.slice(0, cut))
        rest = rest.slice(cut).trimStart()
      }
      output.push(rest)
    }
  }
  const textHeight = output.length * lineHeight,
    graphicHeight = graphic ? Math.min(18, h / 2) : 0
  return {
    width: w,
    height: h,
    size,
    lineHeight,
    lines: output,
    textHeight,
    graphicHeight,
    clipped:
      textHeight + graphicHeight > h ||
      (media.singleLine && output.some((s) => s.length > max)),
    small: media.fontSize < 9,
  }
}
