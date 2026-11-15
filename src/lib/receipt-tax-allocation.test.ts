import { expect, it } from 'vitest'
import {
  receiptAllocationIssues,
  receiptBusinessAllocations,
  receiptCents,
  receiptTaxAllocation,
  receiptTotals,
} from './receipt-totals'
import { demoData } from './demo'
import { planFinance } from './finance'
const line = (amount: number, allocation = 'business', extra = {}) => ({
  description: 'Supplies',
  amount,
  allocation,
  decision: allocation === 'personal' ? 'personal' : 'expense',
  category: 'Supplies expense',
  ...extra,
})
const receipt = (lines: any[], tax: number, extra = {}) => ({
  id: 'tax-review',
  name: 'Disposable tax review',
  status: 'draft',
  vendor: 'Test',
  date: '2026-11-15',
  currency: 'USD',
  arithmeticVersion: 2,
  allocationVersion: 1,
  taxTreatment: 'exclusive',
  lines,
  tax,
  printedTotal: lines.reduce((n, l) => n + l.amount, 0) + tax,
  ...extra,
})
const centsSum = (rows: any[], key: string) =>
  rows.reduce((n, l) => n + (receiptCents(l[key]) ?? 0), 0)
it('meets the 20 business / 10 personal acceptance case and restores without drift', () => {
  const r = receipt(
    [
      line(20, 'business', { taxRate: 8 }),
      line(10, 'personal', { taxRate: 8 }),
    ],
    2.4,
  )
  const rows = receiptBusinessAllocations(r)
  expect(rows[0]).toMatchObject({
    businessSubtotal: 20,
    businessTax: 1.6,
    postedAmount: 21.6,
  })
  expect(rows[1]).toMatchObject({ excludedAmount: 10.8, excludedTax: 0.8 })
  expect(receiptAllocationIssues(r)).toEqual([])
  for (let i = 0; i < 50; i++) {
    r.lines[1].allocation = 'business'
    expect(centsSum(receiptBusinessAllocations(r), 'businessTax')).toBe(240)
    r.lines[1].allocation = 'personal'
    expect(receiptBusinessAllocations(r)).toEqual(rows)
  }
  expect(receiptTotals(r).total).toBe(32.4)
  expect(r.printedTotal).toBe(32.4)
})
it('uses actual tax before rates and excludes exempt items from combined tax', () => {
  const actual = receipt(
    [
      line(20, 'business', { lineTax: 1.2, taxRate: 99 }),
      line(10, 'personal', { lineTax: 0 }),
    ],
    1.2,
  )
  expect(receiptBusinessAllocations(actual)[0].businessTax).toBe(1.2)
  const combined = receipt(
    [
      line(20, 'business', { taxableStatus: 'exempt' }),
      line(10, 'personal', { taxableStatus: 'taxable' }),
    ],
    0.8,
  )
  expect(receiptBusinessAllocations(combined).map((l) => l.taxShare)).toEqual([
    0, 0.8,
  ])
  expect(receiptTaxAllocation(combined).estimated).toBe(false)
  const unknown = receipt([line(20), line(10, 'personal')], 2.4)
  expect(receiptTaxAllocation(unknown).estimated).toBe(true)
})
it('applies discounts before distinct rates, then splits tax and accounts separately for unreviewed amounts', () => {
  const r = receipt(
    [
      line(20, 'split', { taxRate: 8, businessPercent: 50 }),
      line(10, 'unreviewed', { taxRate: 5 }),
      line(10, 'personal', { taxableStatus: 'exempt' }),
    ],
    1.575,
    { receiptDiscount: 10, printedTotal: 31.58 },
  )
  // 15 * 8% + 7.50 * 5%, line rounding half up.
  r.tax = 1.58
  const rows = receiptBusinessAllocations(r)
  expect(rows[0]).toMatchObject({
    businessSubtotal: 7.5,
    businessTax: 0.6,
    postedAmount: 8.1,
    excludedAmount: 8.1,
  })
  expect(rows[1]).toMatchObject({
    postedAmount: 0,
    fullAmount: 7.88,
    excludedTax: 0.38,
  })
  expect(rows[2].taxShare).toBe(0)
  expect(centsSum(rows, 'businessTax') + centsSum(rows, 'excludedTax')).toBe(
    158,
  )
  expect(
    centsSum(rows, 'postedAmount') + centsSum(rows, 'excludedAmount'),
  ).toBe(3158)
  expect(receiptAllocationIssues(r).join()).toContain('Classify allocation')
})
it('extracts included tax once, supports amount splits and keeps fees separate', () => {
  const r = receipt(
    [
      line(21.6, 'split', {
        taxRate: 8,
        splitMethod: 'amount',
        businessAmount: 11.8,
      }),
      line(10.8, 'personal', { taxRate: 8 }),
    ],
    2.4,
    { taxTreatment: 'inclusive', otherCharges: 3, printedTotal: 35.4 },
  )
  const rows = receiptBusinessAllocations(r)
  expect(rows[0]).toMatchObject({
    fullAmount: 23.6,
    postedAmount: 11.8,
    businessTax: 0.8,
    businessFees: 1,
    businessSubtotal: 10,
  })
  expect(receiptTotals(r).total).toBe(35.4)
  expect(receiptAllocationIssues(r)).toEqual([])
})
it('recalculates quantity, prices, discounts and rate edits from source values', () => {
  const r = receipt(
    [
      line(20, 'business', {
        amountMode: 'quantity',
        printedQuantity: 2,
        unitPrice: 10,
        taxRate: 8,
      }),
    ],
    1.6,
    { printedTotal: 21.6 },
  )
  expect(receiptBusinessAllocations(r)[0].businessTax).toBe(1.6)
  Object.assign(r.lines[0], {
    printedQuantity: 3,
    unitPrice: 5,
    lineDiscount: 5,
  })
  r.tax = 0.8
  r.printedTotal = 10.8
  expect(receiptBusinessAllocations(r)[0]).toMatchObject({
    businessTax: 0.8,
    businessSubtotal: 10,
    postedAmount: 10.8,
  })
})
it('reconciles fractional cents deterministically for combined tax and repeated splits', () => {
  const r = receipt(
    [
      line(0.01, 'split', { businessPercent: 50 }),
      line(0.02),
      line(0.03, 'personal'),
    ],
    0.01,
    { printedTotal: 0.07 },
  )
  const rows = receiptBusinessAllocations(r)
  expect(centsSum(rows, 'businessTax') + centsSum(rows, 'excludedTax')).toBe(1)
  expect(
    centsSum(rows, 'postedAmount') + centsSum(rows, 'excludedAmount'),
  ).toBe(7)
  expect(receiptBusinessAllocations(r)).toEqual(rows)
})
it('blocks inconsistent original tax rather than altering it', () => {
  const r = receipt([line(20, 'business', { taxRate: 8 })], 2)
  expect(receiptAllocationIssues(r).join()).toContain('does not reconcile')
  expect(r.tax).toBe(2)
  const w = demoData()
  w.receipt_extractions = [r]
  expect(() =>
    planFinance(w, 'receiptPost', { id: r.id }, () => crypto.randomUUID()),
  ).toThrow('does not reconcile')
})
it('posts only the recalculated business total and preserves original source and allocation history', () => {
  const r = receipt(
    [
      line(20, 'business', { taxRate: 8 }),
      line(10, 'business', { taxRate: 8 }),
    ],
    2.4,
  )
  const w = demoData()
  w.receipt_extractions = [r]
  const edited = structuredClone(r)
  edited.lines[1].allocation = 'personal'
  edited.lines[1].decision = 'personal'
  const plan = planFinance(w, 'receiptPost', edited, () => crypto.randomUUID())
  expect(
    plan.writes
      .filter((x) => x.table === 'expenses')
      .map((x) => x.record.amount),
  ).toEqual([21.6])
  const saved = plan.writes.find(
    (x) => x.table === 'receipt_extractions',
  )!.record
  expect(saved.total).toBe(32.4)
  expect(saved.originalReceipt.lines).toEqual(r.lines)
  expect(saved.lines).toHaveLength(2)
  expect(saved.postedLines[0]).toMatchObject({
    taxShare: 1.6,
    businessBaseAmount: 20,
  })
  expect(saved.postedLines[1]).toMatchObject({ taxShare: 0, excludedTax: 0.8 })
})
it('uses only the business allocation in saved document amounts and restores personal items', async () => {
  const { receiptBusinessTotal } = await import('./receipt-totals')
  const r = receipt(
    [
      line(20, 'business', { taxRate: 8 }),
      line(10, 'personal', { taxRate: 8 }),
    ],
    2.4,
  )
  expect(receiptBusinessTotal(r)).toBe(21.6)
  r.lines[1].allocation = 'business'
  r.lines[1].decision = 'expense'
  expect(receiptBusinessTotal(r)).toBe(32.4)
  expect(r.printedTotal).toBe(32.4)
})
