import { expect, it } from 'vitest'
import { demoData } from './demo'
import { planFinance } from './finance'
import {
  receiptBusinessAllocations,
  receiptAllocationIssues,
} from './receipt-totals'
import type { Workspace } from './domain'
let sequence = 0
function setup(lines: any[], extra = {}) {
  const w = demoData()
  w.receipt_extractions = [
    {
      id: 'allocation-test',
      name: 'Disposable receipt',
      vendor: 'Test mill',
      date: '2026-11-15',
      receivedDate: '2026-11-15',
      currency: 'USD',
      status: 'draft',
      arithmeticVersion: 2,
      allocationVersion: 1,
      taxTreatment: 'exclusive',
      tax: 0,
      printedTotal: 20,
      lines,
      ...extra,
    },
  ]
  return w
}
const expense = (allocation = 'business') => ({
  description: 'Supplies',
  amount: 20,
  decision: allocation === 'personal' ? 'personal' : 'expense',
  category: 'Supplies expense',
  allocation,
})
function apply(w: Workspace, action = 'receiptPost', data: any = {}) {
  const plan = planFinance(
    w,
    action,
    { id: 'allocation-test', ...data },
    () => `allocation-${++sequence}`,
  )
  for (const { table, record } of plan.writes) {
    const rows = (w[table] ||= [])
    const index = rows.findIndex((r) => r.id === record.id)
    if (index < 0) rows.push(record)
    else rows[index] = record
  }
  if (plan.journal) (w.journals ||= []).push(plan.journal)
  return plan
}
it('posts only business costs once and retains original merchant values', () => {
  const w = setup([expense()])
  const plan = apply(w)
  expect(
    plan.writes
      .filter((x) => x.table === 'expenses')
      .map((x) => x.record.amount),
  ).toEqual([20])
  expect(w.receipt_extractions[0].lines[0].amount).toBe(20)
  expect(w.receipt_extractions[0].total).toBe(20)
  expect(apply(w).writes).toEqual([])
})
it('keeps a wholly personal receipt without any business transaction, journal, expense or stock', () => {
  const w = setup([expense('personal')])
  const plan = apply(w)
  expect(plan.journal).toBeUndefined()
  expect(plan.writes.map((x) => x.table)).toEqual(['receipt_extractions'])
  expect(w.receipt_extractions[0].excludedTotal).toBe(20)
  expect(w.receipt_extractions[0].transactionId).toBeNull()
  apply(w, 'receiptCorrect', { reason: 'Recheck excluded use' })
  expect(w.receipt_extractions.at(-1)?.status).toBe('draft')
})
it.each(['percent', 'amount'])(
  'posts a mixed receipt with %s split, actual tax, discount and fees',
  (method) => {
    const w = setup(
      [
        { ...expense(), amount: 10 },
        {
          ...expense('split'),
          amount: 10,
          splitMethod: method,
          businessPercent: 50,
          businessAmount: 5.5,
        },
      ],
      { tax: 2, receiptDiscount: 1, otherCharges: 1, printedTotal: 22 },
    )
    const plan = apply(w)
    const tx = plan.writes.find(
      (x) => x.table === 'finance_transactions',
    )!.record
    expect(tx.amount).toBe(16.5)
    expect(w.receipt_extractions[0].total).toBe(22)
    expect(w.receipt_extractions[0].excludedTotal).toBe(5.5)
    expect(
      plan.journal!.lines.reduce(
        (n: number, l: { debit: number; credit: number }) =>
          n + l.debit - l.credit,
        0,
      ),
    ).toBeCloseTo(0)
  },
)
it('accepts actual item-specific adjusted costs only when they reconcile', () => {
  const w = setup(
    [
      { ...expense(), amount: 10, adjustedAmount: 12 },
      { ...expense('personal'), amount: 10, adjustedAmount: 10 },
    ],
    { tax: 2, printedTotal: 22, adjustmentAllocation: 'manual' },
  )
  expect(
    apply(w).writes.find((x) => x.table === 'finance_transactions')!.record
      .amount,
  ).toBe(12)
  const invalid = setup([{ ...expense(), adjustedAmount: 19 }], {
    adjustmentAllocation: 'manual',
  })
  expect(() => apply(invalid)).toThrow('reconcile')
})
it('receives only explicit business quantities with the corresponding split cost', () => {
  const w = setup([])
  const item = w.ingredients[0]
  const prior = item.quantity
  w.receipt_extractions[0].lines = [
    {
      ...expense('split'),
      decision: 'inventory',
      itemId: item.id,
      printedQuantity: 2,
      printedUnit: item.unit,
      quantity: 1,
      unit: item.unit,
      stockQuantityConfirmed: true,
      quantityAllocationConfirmed: true,
      splitMethod: 'percent',
      businessPercent: 50,
    },
  ]
  const plan = apply(w)
  expect(w.ingredients[0].quantity).toBe(prior + 1)
  expect(plan.writes.find((x) => x.table === 'ledger')!.record.amount).toBe(10)
  expect(w.receipt_extractions[0].lines[0].printedQuantity).toBe(2)
  const correction = apply(w, 'receiptCorrect', {
    reason: 'Correct mixed allocation',
  })
  expect(w.ingredients[0].quantity).toBe(prior)
  expect(
    correction.writes.find((x) => x.table === 'ledger')!.record.quantity,
  ).toBe(-1)
  expect(
    w.receipt_extractions.at(-1)?.history.at(-1).postedLines[0].postedAmount,
  ).toBe(10)
  expect(apply(w, 'receiptCorrect', { reason: 'retry' }).writes).toEqual([])
})
it('saves unresolved reviews, but rejects posting unreviewed, inaccurate, negative and invalid split lines', () => {
  for (const line of [
    { ...expense(), allocation: 'unreviewed' },
    { ...expense('split'), businessPercent: 101 },
    { ...expense(), amount: -20 },
  ]) {
    const w = setup([line])
    expect(apply(w, 'receiptDraft').journal).toBeUndefined()
    expect(() => apply(w)).toThrow()
  }
  expect(() => apply(setup([expense()], { printedTotal: 21 }))).toThrow(
    'differs',
  )
  expect(() => apply(setup([]))).toThrow()
  const w = setup([expense()])
  apply(w, 'receiptDraft')
  expect(apply(w).journal).toBeDefined()
})
it('requires independent inventory confirmation and rejects unavailable cross-business matches', () => {
  const w = setup([
    {
      ...expense('split'),
      decision: 'inventory',
      itemId: 'other-business-item',
      quantity: 1,
      unit: 'lb',
      stockQuantityConfirmed: true,
      quantityAllocationConfirmed: true,
      splitMethod: 'percent',
      businessPercent: 50,
    },
  ])
  expect(() => apply(w)).toThrow()
  const r = w.receipt_extractions[0]
  r.lines[0].quantityAllocationConfirmed = false
  expect(receiptAllocationIssues(r).join()).toContain('quantity and cost')
  expect(receiptBusinessAllocations(r)[0].postedAmount).toBe(10)
})
it('excludes personal amounts from the existing business reports without counting the receipt header twice', async () => {
  const { financeDashboard } = await import('./finance-dashboard')
  const w = setup([
    { ...expense('split'), splitMethod: 'amount', businessAmount: 7.31 },
  ])
  w.expenses = []
  w.finance_transactions = []
  w.journals = []
  w.sales = []
  apply(w)
  const report = financeDashboard(w, '2026-11-15', '2026-11-15')
  expect(report.expenses.value).toBe(7.31)
  expect(
    report.receiptRecords.find((r) => r.receipt.id === 'allocation-test')
      ?.expenseAmount,
  ).toBe(7.31)
})
it('reconciles rounded business and excluded shares to the original total to the cent', () => {
  const r = setup(
    [
      {
        ...expense('split'),
        amount: 0.01,
        splitMethod: 'percent',
        businessPercent: 50,
      },
      {
        ...expense('split'),
        amount: 0.02,
        splitMethod: 'percent',
        businessPercent: 33.33,
      },
    ],
    { tax: 0.01, printedTotal: 0.04 },
  ).receipt_extractions[0]
  const allocations = receiptBusinessAllocations(r)
  expect(
    allocations.reduce(
      (n, l) =>
        n +
        Math.round(l.postedAmount * 100) +
        Math.round(l.excludedAmount * 100),
      0,
    ),
  ).toBe(4)
  expect(receiptAllocationIssues(r)).toEqual([])
})
