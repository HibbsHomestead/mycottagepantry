import type { Item } from './domain'
type ReceiptValues = Partial<Item>

const missing = (v: unknown) => v === '' || v == null
// Parse decimal text before arithmetic; round each monetary line once, half up.
function decimal(v: unknown): { value: bigint; scale: bigint } | null {
  if (
    String(v).length > 64 ||
    missing(v) ||
    !/^-?\d+(\.\d{1,9})?$/.test(String(v))
  )
    return null
  const [whole, fraction = ''] = String(v).replace('-', '').split('.')
  const scale = 10n ** BigInt(fraction.length)
  const value =
    (BigInt(whole) * scale + BigInt(fraction || '0')) *
    (String(v).startsWith('-') ? -1n : 1n)
  return { value, scale }
}
function rounded(value: bigint, scale: bigint) {
  const sign = value < 0n ? -1n : 1n
  const absolute = value * sign
  const cents = Number(((absolute * 100n + scale / 2n) / scale) * sign)
  return Number.isSafeInteger(cents) && Math.abs(cents) <= 100_000_000_000
    ? cents
    : null
}
export function receiptCents(v: unknown): number | null {
  const d = decimal(v)
  return d ? rounded(d.value, d.scale) : null
}
export function receiptLineCents(line: ReceiptValues): number | null {
  if (!line.amountMode) return receiptCents(line.amount) // Historical/extracted amounts are already net.
  let gross: number | null
  if (line.amountMode === 'quantity') {
    const q = decimal(line.printedQuantity),
      p = decimal(line.unitPrice)
    gross =
      q && p && q.value > 0n && p.value >= 0n
        ? rounded(q.value * p.value, q.scale * p.scale)
        : null
  } else if (line.amountMode === 'direct')
    gross = receiptCents(line.enteredAmount)
  else return null
  const discount = missing(line.lineDiscount)
    ? 0
    : receiptCents(line.lineDiscount)
  return gross == null ||
    gross < 0 ||
    discount == null ||
    discount < 0 ||
    discount > gross
    ? null
    : gross - discount
}
export function receiptTotals(r: ReceiptValues) {
  const errors: string[] = []
  const lineAmounts: (number | null)[] = (r.lines || []).map(
    (l: ReceiptValues, i: number) => {
      const amount = receiptLineCents(l)
      if (amount == null || amount < 0)
        errors.push(
          `Line ${i + 1}: enter a valid amount, or quantity and unit price; discount cannot exceed the line.`,
        )
      return amount == null ? null : amount / 100
    },
  )
  if (!lineAmounts.length) errors.push('Add at least one receipt line.')
  const subtotalCents =
    lineAmounts.length && lineAmounts.every((v) => v != null)
      ? (r.lines || []).reduce(
          (sum: number, l: ReceiptValues) => sum + receiptLineCents(l)!,
          0,
        )
      : null
  const optional = (key: string, label: string, signed = false) => {
    const value = missing(r[key]) ? 0 : receiptCents(r[key])
    if (value == null || (!signed && value < 0))
      errors.push(`Enter a valid ${label}.`)
    return value
  }
  const discount = optional('receiptDiscount', 'receipt discount'),
    charges = optional('otherCharges', 'shipping / fees'),
    adjustment = optional('adjustment', 'rounding adjustment', true)
  const tax = receiptCents(r.tax)
  if (tax == null || tax < 0)
    errors.push('Enter receipt tax, including 0 only when confirmed.')
  if (!['exclusive', 'inclusive'].includes(r.taxTreatment))
    errors.push(
      'Confirm whether tax is added or already included in line amounts.',
    )
  if (subtotalCents != null && discount != null && discount > subtotalCents)
    errors.push('Receipt discount exceeds the line subtotal.')
  if (
    adjustment != null &&
    (Math.abs(adjustment) > 5 ||
      (adjustment !== 0 && !String(r.adjustmentReason || '').trim()))
  )
    errors.push(
      'Rounding requires an explanation and must be within five cents.',
    )
  const totalCents =
    errors.length ||
    subtotalCents == null ||
    discount == null ||
    charges == null ||
    tax == null ||
    adjustment == null
      ? null
      : subtotalCents -
        discount +
        charges +
        adjustment +
        (r.taxTreatment === 'exclusive' ? tax : 0)
  if (totalCents != null && totalCents <= 0)
    errors.push('Receipt total must be greater than zero.')
  if (
    r.taxTreatment === 'inclusive' &&
    totalCents != null &&
    tax != null &&
    tax > totalCents
  )
    errors.push('Included tax cannot exceed the receipt total.')
  const printed = missing(r.printedTotal)
    ? null
    : receiptCents(r.printedTotal)
  if (!missing(r.printedTotal) && (printed == null || printed < 0))
    errors.push('Enter a valid printed total or leave it blank.')
  return {
    lineAmounts,
    subtotal: subtotalCents == null ? null : subtotalCents / 100,
    discount: discount == null ? null : discount / 100,
    tax: tax == null ? null : tax / 100,
    charges: charges == null ? null : charges / 100,
    total: errors.length || totalCents == null ? null : totalCents / 100,
    difference:
      printed != null && totalCents != null
        ? (totalCents - printed) / 100
        : null,
    errors,
  }
}
/** Acquisition-cost allocation preserves the existing policy, with a last-line cent remainder. */
export function receiptAllocations(r: ReceiptValues) {
  const t = receiptTotals(r)
  if (t.total == null || t.subtotal == null) return []
  const subtotal = receiptCents(t.subtotal)!,
    total = receiptCents(t.total)!
  let allocated = 0,
    cumulativeBase = 0,
    allocatedTax = 0
  const tax = r.taxTreatment === 'exclusive' ? receiptCents(t.tax)! : 0
  const share = (value: number, weight: number) =>
    subtotal
      ? Number(
          (BigInt(value) * BigInt(weight) * 2n + BigInt(subtotal)) /
            (BigInt(subtotal) * 2n),
        )
      : 0
  return (r.lines || []).map((l: ReceiptValues, index: number) => {
    const base = receiptLineCents(l)!
    cumulativeBase += base
    const last = index === r.lines.length - 1
    const cumulativeAmount = last ? total : share(total, cumulativeBase)
    const cumulativeTax = last ? tax : share(tax, cumulativeBase)
    const cents = cumulativeAmount - allocated,
      taxShare = cumulativeTax - allocatedTax
    allocated = cumulativeAmount
    allocatedTax = cumulativeTax
    return {
      ...l,
      amount: base / 100,
      postedAmount: cents / 100,
      taxShare: taxShare / 100,
      otherChargesShare: (cents - base - taxShare) / 100,
    }
  }) as ReceiptValues[]
}
export function editableReceipt(r: Item): Item {
  if (r.status !== 'draft' || r.arithmeticVersion === 2)
    return structuredClone(r)
  return {
    ...structuredClone(r),
    arithmeticVersion: 2,
    printedTotal: r.total ?? null,
    taxTreatment:
      r.taxTreatment || (r.taxInclusive === true ? 'inclusive' : ''),
    receiptDiscount: 0,
  }
}
export function receiptLineIssues(l: ReceiptValues) {
  const issues: string[] = []
  if (!String(l.description || '').trim()) issues.push('Add item name')
  if (receiptLineCents(l) == null) issues.push('Amount incomplete')
  if (!['inventory', 'expense', 'personal'].includes(l.decision))
    issues.push('Choose use')
  if (l.decision === 'expense' && !l.category)
    issues.push('Choose category')
  if (l.decision === 'inventory' && (!l.itemId || l.createNew))
    issues.push('Match or create item')
  if (
    l.decision === 'inventory' &&
    (!l.stockQuantityConfirmed || !(Number(l.quantity) > 0) || !l.unit)
  )
    issues.push('Confirm stock quantity / unit')
  return issues
}
