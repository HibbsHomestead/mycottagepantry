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
  const printed = missing(r.printedTotal) ? null : receiptCents(r.printedTotal)
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
/** Cumulative integer rounding assigns every cent once, independent of classifications. */
function distribute(total: number, weights: number[]) {
  const sum = weights.reduce((n, w) => n + w, 0)
  let cumulative = 0,
    previous = 0
  return weights.map((weight) => {
    cumulative += weight
    const next = sum
      ? Number(
          (BigInt(total) * BigInt(cumulative) * 2n + BigInt(sum)) /
            (2n * BigInt(sum)),
        )
      : 0
    const share = next - previous
    previous = next
    return share
  })
}
/** Actual tax takes priority; rates use discounted bases; combined tax uses eligible bases. */
export function receiptTaxAllocation(r: ReceiptValues) {
  const t = receiptTotals(r),
    lines: ReceiptValues[] = r.lines || []
  const errors: string[] = []
  if (t.total == null)
    return {
      taxes: [] as number[],
      bases: [] as number[],
      fees: [] as number[],
      errors,
      estimated: false,
    }
  if (
    r.feeAllocation &&
    !['proportional', 'business', 'personal', 'unreviewed'].includes(
      r.feeAllocation,
    )
  )
    errors.push('Choose a valid shipping / fee allocation rule.')
  const raw = lines.map((l) => receiptLineCents(l)!)
  const bases = distribute(
    raw.reduce((n, v) => n + v, 0) - receiptCents(t.discount)!,
    raw,
  )
  const taxes: (number | null)[] = lines.map((l, i) => {
    if (
      l.taxableStatus &&
      !['unknown', 'taxable', 'exempt'].includes(l.taxableStatus)
    )
      errors.push(`Line ${i + 1}: choose a valid taxable status.`)
    if (!missing(l.lineTax)) {
      const actual = receiptCents(l.lineTax)
      if (actual == null || actual < 0)
        errors.push(`Line ${i + 1}: enter valid actual tax.`)
      return actual == null || actual < 0 ? 0 : actual
    }
    if (l.taxableStatus === 'exempt') return 0
    if (!missing(l.taxRate)) {
      const rate = decimal(l.taxRate)
      if (!rate || rate.value < 0n || rate.value > 100n * rate.scale) {
        errors.push(`Line ${i + 1}: enter a tax rate between 0 and 100.`)
        return 0
      }
      const denominator =
        100n * rate.scale + (r.taxTreatment === 'inclusive' ? rate.value : 0n)
      return Number(
        (BigInt(bases[i]) * rate.value * 2n + denominator) / (2n * denominator),
      )
    }
    return null
  })
  const originalTax = receiptCents(t.tax)!
  const known = taxes.reduce<number>((n, v) => n + (v ?? 0), 0)
  const unknown = taxes.map((v, i) => (v == null ? bases[i] : 0))
  const remaining = originalTax - known
  if (remaining < 0 || (!unknown.some(Boolean) && remaining !== 0))
    errors.push(
      'Line tax does not reconcile to original receipt tax. Review tax details; original totals are unchanged.',
    )
  const estimated =
    taxes.some(
      (v, i) =>
        v == null && lines[i].taxableStatus !== 'taxable' && bases[i] > 0,
    ) && originalTax > 0
  // Keep discrepancies visible, rather than silently rewriting the merchant tax.
  const remainder = distribute(Math.max(0, remaining), unknown)
  const allocated = taxes.map((v, i) => v ?? remainder[i])
  if (r.taxTreatment === 'inclusive' && allocated.some((v, i) => v > bases[i]))
    errors.push('Included line tax exceeds its discounted amount.')
  const feeWeights = lines.map((l, i) =>
    !r.feeAllocation || r.feeAllocation === 'proportional'
      ? bases[i]
      : (l.allocation ||
            (l.decision === 'personal' ? 'personal' : 'business')) ===
          r.feeAllocation
        ? bases[i]
        : 0,
  )
  const feeTotal = receiptCents(t.charges)! + (receiptCents(r.adjustment) ?? 0)
  if (feeTotal && !feeWeights.some(Boolean))
    errors.push('Choose eligible lines for shipping / fee allocation.')
  const fees = distribute(Math.abs(feeTotal), feeWeights).map((v) =>
    feeTotal < 0 ? -v : v,
  )
  return { taxes: allocated, bases, fees, errors, estimated }
}
export function receiptAllocations(r: ReceiptValues) {
  const t = receiptTotals(r)
  if (t.total == null) return []
  const plan = receiptTaxAllocation(r)
  return (r.lines || []).map((l: ReceiptValues, index: number) => {
    const tax = plan.taxes[index],
      base = plan.bases[index],
      fee = plan.fees[index]
    const cents = base + fee + (r.taxTreatment === 'exclusive' ? tax : 0)
    return {
      ...l,
      amount: receiptLineCents(l)! / 100,
      postedAmount:
        (r.adjustmentAllocation === 'manual'
          ? (receiptCents(l.adjustedAmount) ?? 0)
          : cents) / 100,
      subtotalShare: (base - (r.taxTreatment === 'inclusive' ? tax : 0)) / 100,
      taxShare: tax / 100,
      otherChargesShare: fee / 100,
      estimatedTax: plan.estimated,
    }
  }) as ReceiptValues[]
}
/** Separate supporting allocation from immutable merchant amounts and explicit stock quantities. */
export function businessReceiptLine(l: ReceiptValues): ReceiptValues & {
  allocation: string
  fullAmount: number
  postedAmount: number
  excludedAmount: number
  allocationErrors: string[]
} {
  const full = receiptCents(l.postedAmount) ?? 0
  const allocation =
    l.allocation ??
    (l.decision === 'personal'
      ? 'personal'
      : ['expense', 'inventory'].includes(l.decision)
        ? 'business'
        : 'unreviewed')
  let business = allocation === 'business' ? full : 0
  if (allocation === 'split') {
    if (l.splitMethod === 'amount')
      business = receiptCents(l.businessAmount) ?? NaN
    else {
      const percent = decimal(l.businessPercent)
      business =
        percent && percent.value >= 0n && percent.value <= 100n * percent.scale
          ? Number(
              (BigInt(full) * percent.value * 2n + 100n * percent.scale) /
                (200n * percent.scale),
            )
          : NaN
    }
  }
  const errors: string[] = []
  if (!['business', 'personal', 'split'].includes(allocation))
    errors.push('Classify allocation')
  if (!Number.isSafeInteger(business) || business < 0 || business > full)
    errors.push('Business allocation must be within the line total')
  if (allocation === 'split' && business === 0)
    errors.push('Choose Personal when no amount is allocated to business')
  if (allocation === 'split' && l.decision === 'inventory') {
    if (!(Number(l.quantity) > 0) || !l.unit || !l.stockQuantityConfirmed)
      errors.push('Confirm explicit business stock quantity and unit')
    if (
      l.unit === l.printedUnit &&
      Number(l.printedQuantity) > 0 &&
      Number(l.quantity) > Number(l.printedQuantity)
    )
      errors.push('Business quantity exceeds purchased quantity')
    if (
      l.unit === l.printedUnit &&
      Number(l.printedQuantity) > 0 &&
      Number.isFinite(business) &&
      Math.abs(
        Math.round((full * Number(l.quantity)) / Number(l.printedQuantity)) -
          business,
      ) > 1
    )
      errors.push(
        'Business cost must correspond to the confirmed share of purchased quantity',
      )
    if (!l.quantityAllocationConfirmed)
      errors.push('Confirm quantity and cost allocation agree')
  }
  const tax = receiptCents(l.taxShare) ?? 0
  const businessTax =
    full > 0 &&
    Number.isSafeInteger(business) &&
    business >= 0 &&
    business <= full
      ? distribute(tax, [business, full - business])[0]
      : 0
  const fee = receiptCents(l.otherChargesShare) ?? 0
  const businessFees =
    full > 0 &&
    Number.isSafeInteger(business) &&
    business >= 0 &&
    business <= full
      ? distribute(Math.abs(fee), [business, full - business])[0] *
        (fee < 0 ? -1 : 1)
      : 0
  return {
    ...l,
    businessTax: businessTax / 100,
    excludedTax: (tax - businessTax) / 100,
    businessSubtotal: Number.isFinite(business)
      ? (business - businessTax - businessFees) / 100
      : 0,
    businessFees: businessFees / 100,
    allocation,
    fullAmount: full / 100,
    postedAmount: Number.isFinite(business) ? business / 100 : 0,
    excludedAmount: Number.isFinite(business) ? (full - business) / 100 : 0,
    allocationErrors: errors,
  }
}
export function receiptBusinessAllocations(r: ReceiptValues) {
  return receiptAllocations(r).map(businessReceiptLine)
}
export function receiptAllocationIssues(r: ReceiptValues) {
  const allocations = receiptBusinessAllocations(r)
  const errors = [
    ...receiptTaxAllocation(r).errors,
    ...allocations.flatMap((l, i) =>
      l.allocationErrors.map((e: string) => `Line ${i + 1}: ${e}`),
    ),
  ]
  if (
    r.adjustmentAllocation &&
    !['manual', 'proportional'].includes(r.adjustmentAllocation)
  )
    errors.push('Choose an adjustment allocation method')
  if (
    r.allocationVersion === 1 &&
    (r.lines || []).some((l: ReceiptValues) => !l.allocation)
  )
    errors.push('Classify every line as Business, Personal or Split')
  if (r.allocationVersion === 1 && receiptCents(r.printedTotal) == null)
    errors.push('Enter the original receipt total to reconcile before posting')
  if (r.adjustmentAllocation === 'manual') {
    if (
      (r.lines || []).some(
        (l: ReceiptValues) =>
          receiptCents(l.adjustedAmount) == null ||
          receiptCents(l.adjustedAmount)! < 0,
      )
    )
      errors.push('Enter every adjusted line amount')
    if (
      allocations.reduce(
        (sum, l) => sum + (receiptCents(l.fullAmount) ?? 0),
        0,
      ) !== receiptCents(receiptTotals(r).total)
    )
      errors.push('Adjusted line amounts must reconcile to the receipt total')
  }
  return errors
}
export function editableReceipt(r: Item): Item {
  if (r.status !== 'draft') return structuredClone(r)
  const editable = structuredClone(r)
  editable.lines = (editable.lines || []).map((l: ReceiptValues) => ({
    ...l,
    allocation:
      l.allocation ??
      (l.decision === 'personal'
        ? 'personal'
        : ['inventory', 'expense'].includes(l.decision)
          ? 'business'
          : 'unreviewed'),
  }))
  if (r.arithmeticVersion === 2)
    return {
      ...editable,
      allocationVersion: 1,
      printedTotal: Object.hasOwn(r, 'printedTotal') ? r.printedTotal : r.total,
    }
  return {
    ...editable,
    arithmeticVersion: 2,
    allocationVersion: 1,
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
  if (l.allocation === 'unreviewed') issues.push('Classify allocation')
  if (l.allocation === 'split') {
    if (
      l.splitMethod === 'amount'
        ? !(Number(l.businessAmount) > 0)
        : !(Number(l.businessPercent) > 0 && Number(l.businessPercent) <= 100)
    )
      issues.push('Enter business share')
    if (l.decision === 'inventory' && !l.quantityAllocationConfirmed)
      issues.push('Confirm quantity and cost allocation')
  }
  if (!['inventory', 'expense', 'personal'].includes(l.decision))
    issues.push('Choose use')
  if (l.decision === 'expense' && !l.category) issues.push('Choose category')
  if (l.decision === 'inventory' && (!l.itemId || l.createNew))
    issues.push('Match or create item')
  if (
    l.decision === 'inventory' &&
    (!l.stockQuantityConfirmed || !(Number(l.quantity) > 0) || !l.unit)
  )
    issues.push('Confirm stock quantity / unit')
  return issues
}
