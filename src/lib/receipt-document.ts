import type { Item } from './domain'
export type ReceiptMime =
  'application/pdf' | 'image/png' | 'image/jpeg' | 'image/heic'
export function receiptMime(bytes: Uint8Array): ReceiptMime {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end))
  if (ascii(0, 5) === '%PDF-') return 'application/pdf'
  if (
    bytes[0] === 137 &&
    ascii(1, 4) === 'PNG' &&
    bytes[4] === 13 &&
    bytes[5] === 10
  )
    return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg'
  if (
    ascii(4, 8) === 'ftyp' &&
    /heic|heix|hevc|hevx|mif1|msf1/.test(ascii(8, 40))
  )
    return 'image/heic'
  throw new Error(
    'The receipt response is not a supported image or PDF. A login or error page cannot be used as a receipt.',
  )
}
export function receiptFileEndpoint(id: string, original = false) {
  if (!id || !id.trim())
    throw new Error('This receipt has no saved file identifier.')
  return (
    '/api/workspace?receiptFile=' +
    encodeURIComponent(id) +
    (original ? '&original=1' : '')
  )
}
export function receiptObjectKey(
  org: string,
  receipt: Item,
  original: boolean,
) {
  const expected = `${org}/${receipt.id}/${original ? 'original' : 'preview'}`
  const saved = original ? receipt.originalObjectKey : receipt.previewObjectKey
  if (saved && saved !== expected)
    throw new Error('Receipt storage reference does not belong to this oven.')
  return expected // Backward compatibility for receipts uploaded before explicit keys were stored.
}
export async function readReceiptResponse(response: Response) {
  if (response.status === 401 || response.status === 403)
    throw new Error(
      'Receipt access expired or was denied. Sign in to this oven, then Retry.',
    )
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? 'The saved receipt file was not found. Retry or contact support.'
        : `Receipt loading failed (HTTP ${response.status}). Retry.`,
    )
  if (response.redirected || response.type === 'opaqueredirect')
    throw new Error(
      'The receipt request redirected instead of returning a file. Sign in, then Retry.',
    )
  const contentType = (response.headers.get('content-type') || '')
    .split(';')[0]
    .toLowerCase()
  if (
    ![
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/heic',
      'image/heif',
    ].includes(contentType)
  )
    throw new Error(
      'The server returned a page instead of a receipt file. Sign in if needed, then Retry.',
    )
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.length || bytes.length > 16 * 1024 * 1024)
    throw new Error('The receipt file is empty or too large to preview.')
  const mime = receiptMime(bytes)
  if (
    mime !== contentType &&
    !(mime === 'image/heic' && contentType === 'image/heif')
  )
    throw new Error(
      'The receipt file does not match its reported file type. Retry.',
    )
  return { bytes, mime }
}
export const receiptFields = [
  'arithmeticVersion',
  'taxTreatment',
  'receiptDiscount',
  'printedTotal',
  'vendor',
  'date',
  'receivedDate',
  'receiptNumber',
  'currency',
  'adjustment',
  'adjustmentReason',
  'subtotal',
  'tax',
  'otherCharges',
  'total',
  'method',
  'discounts',
  'lines',
] as const
export function receiptReviewValues(r: Record<string, any>) {
  return Object.fromEntries(receiptFields.map((k) => [k, r[k] ?? null]))
}
export function emptyReceiptValue(value: unknown) {
  return value === null || value === undefined || value === ''
}
export function receiptDifferences(r: Record<string, any>) {
  const numeric = (v: unknown) =>
    emptyReceiptValue(v)
      ? null
      : typeof v === 'number'
        ? v
        : typeof v === 'string'
          ? Number(v)
          : NaN
  const values = [r.subtotal, r.tax, r.total].map(numeric)
  const charges = emptyReceiptValue(r.otherCharges)
    ? 0
    : numeric(r.otherCharges)
  const lineValues = (r.lines || []).map((l: any) => numeric(l.amount)) as (
    number | null
  )[]
  const lineTotal =
    lineValues.length &&
    lineValues.every((v) => v !== null && Number.isFinite(v))
      ? Math.round(lineValues.reduce<number>((a, v) => a + (v || 0), 0) * 100) /
        100
      : null
  const [subtotal, tax, total] = values
  return {
    lineTotal,
    subtotalDifference:
      lineTotal !== null && subtotal !== null
        ? Math.round((lineTotal - subtotal) * 100) / 100
        : null,
    totalDifference:
      subtotal !== null && tax !== null && total !== null && charges !== null
        ? Math.round(
            (subtotal + tax + charges + (numeric(r.adjustment) ?? 0) - total) *
              100,
          ) / 100
        : null,
  }
}

export function receiptReadingLabel(r: {
  id?: string
  extractionStatus?: string
}) {
  if (r.id === 'uploading')
    return r.extractionStatus === 'upload_failed'
      ? 'Upload failed'
      : 'Uploading'
  return (
    (
      {
        queued: 'Ready to read',
        processing: 'Reading receipt',
        needs_review: 'Ready for review',
        partial: 'Partially extracted — review needed',
        failed: 'Extraction failed',
        not_configured: 'Extraction failed — reader unavailable',
        manual: 'Manual entry',
      } as Record<string, string>
    )[r.extractionStatus || ''] || 'Manual entry'
  )
}
