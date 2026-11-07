import type { LabelDocument } from './label-studio'
export type SheetLayout = {
  mode: 'single' | 'sheet' | 'roll'
  pageWidth: number
  pageHeight: number
  columns: number
  rows: number
  margin: number
  gutter: number
  offsetX?: number
  offsetY?: number
}
export const defaultSheet: SheetLayout = {
  mode: 'single',
  pageWidth: 612,
  pageHeight: 792,
  columns: 2,
  rows: 3,
  margin: 18,
  gutter: 9,
}
export function validateSheet(d: LabelDocument, l: SheetLayout) {
  for (const n of [l.offsetX, l.offsetY])
    if (n !== undefined && (!Number.isFinite(n) || Math.abs(n) > 72))
      throw new Error('Use calibration offsets within 1 inch.')
  if (l.mode !== 'sheet') return
  if (
    ![l.pageWidth, l.pageHeight, l.columns, l.rows, l.margin, l.gutter].every(
      Number.isFinite,
    ) ||
    l.pageWidth < 72 ||
    l.pageHeight < 72 ||
    l.pageWidth > 1008 ||
    l.pageHeight > 1008 ||
    !Number.isInteger(l.columns) ||
    !Number.isInteger(l.rows) ||
    l.columns < 1 ||
    l.rows < 1 ||
    l.columns * l.rows > 200 ||
    l.margin < 0 ||
    l.gutter < 0
  )
    throw new Error(
      'Use valid sheet dimensions, rows, columns, margins, and gutter.',
    )
  if (
    l.columns * d.width + (l.columns - 1) * l.gutter + 2 * l.margin >
      l.pageWidth ||
    l.rows * d.height + (l.rows - 1) * l.gutter + 2 * l.margin > l.pageHeight
  )
    throw new Error(
      'Labels do not fit this sheet. Reduce rows, columns, or margins.',
    )
}
