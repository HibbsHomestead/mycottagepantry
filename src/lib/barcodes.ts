import type { Item } from './domain'

export const scanFormats = [
  'upc_a',
  'upc_e',
  'ean_13',
  'ean_8',
  'code_128',
  'qr_code',
]
/** GTIN-14 is a stored identifier, not a browser camera symbology. */
export const barcodeFormats = [...scanFormats, 'gtin_14']
export function barcodeText(raw: unknown): string {
  if (
    typeof raw !== 'string' ||
    !raw.trim() ||
    raw.length > 512 ||
    [...raw].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new Error(
      'Enter a barcode of up to 512 characters without control characters.',
    )
  return raw.trim()
}
export function validGTIN(code: string) {
  if (!/^\d+$/.test(code)) return false
  const digits = [...code].map(Number),
    check = digits.pop()!
  return (
    (10 -
      (digits
        .reverse()
        .reduce((sum, n, index) => sum + n * (index % 2 ? 1 : 3), 0) %
        10)) %
      10 ===
    check
  )
}
export function expandedUPCE(raw: string): string | null {
  if (!/^[01]\d{7}$/.test(raw)) return null
  const digits = raw.slice(1, 7),
    last = digits[5]
  let body: string
  if ('012'.includes(last))
    body = digits.slice(0, 2) + last + '0000' + digits.slice(2, 5)
  else if (last === '3')
    body = digits.slice(0, 3) + '00000' + digits.slice(3, 5)
  else if (last === '4') body = digits.slice(0, 4) + '00000' + digits[4]
  else body = digits.slice(0, 5) + '0000' + last
  const expanded = raw[0] + body + raw[7]
  return validGTIN(expanded) ? expanded : null
}
export function normalizedBarcode(raw: string, format?: string) {
  let code = barcodeText(raw)
  if (
    format &&
    !['upc_a', 'upc_e', 'ean_13', 'ean_8', 'gtin_14'].includes(format)
  )
    return code
  // Eight digits alone could be EAN-8. Expand UPC-E only when the decoder supplies its format.
  if (format === 'upc_e') code = expandedUPCE(code) || code
  if ([12, 13, 14].includes(code.length) && validGTIN(code))
    return code.length === 14
      ? code.startsWith('0')
        ? code.slice(1)
        : code
      : code.padStart(13, '0')
  return code
}
export type BarcodeMatch = { item: Item; offer?: Item }
export function barcodeMatches(
  items: Item[],
  raw: string,
  format?: string,
): BarcodeMatch[] {
  const key = normalizedBarcode(raw, format),
    literal = barcodeText(raw),
    matches: BarcodeMatch[] = []
  function matchesCode(value: unknown, storedFormat?: string) {
    if (typeof value !== 'string' || !value) return false
    try {
      return (
        barcodeText(value) === literal ||
        normalizedBarcode(value, storedFormat) === key
      )
    } catch {
      return false
    }
  }
  for (const item of items) {
    if (matchesCode(item.barcode, item.barcodeFormat)) matches.push({ item })
    for (const offer of item.purchaseOffers || [])
      if (matchesCode(offer.barcode, offer.barcodeFormat))
        matches.push({ item, offer })
  }
  return matches
}
export function internalItemCode(id: string) {
  return `cottage-pantry:item:${encodeURIComponent(id)}`
}
export function internalItemId(raw: string): string | null {
  if (!raw.startsWith('cottage-pantry:item:')) return null
  try {
    const id = decodeURIComponent(raw.slice(20))
    return /^[a-zA-Z0-9_-]{1,200}$/.test(id) ? id : null
  } catch {
    return null
  }
}
