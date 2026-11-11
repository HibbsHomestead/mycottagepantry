import { expect, it } from 'vitest'
import { financeDashboard } from './finance-dashboard'
import { demoData } from './demo'
const w = () => {
  const w = demoData()
  for (const k of Object.keys(w)) if (k !== 'settings') w[k] = []
  return w
}
it('reconciles signed sales, tax, refunds, fees, bills and reversals without summing payouts, payments or linked receipt headers', () => {
  const data = w()
  data.sales = [
    { id: 's', name: 'Sale', date: '2026-11-01', amount: 100, tax: 8, fees: 3 },
    {
      id: 'refund',
      name: 'Refund',
      date: '2026-11-02',
      amount: -20,
      tax: -1.6,
      fees: 0,
      refundOf: 's',
    },
  ]
  data.expenses = [
    {
      id: 'e',
      name: 'Bill',
      date: '2026-11-01',
      amount: 12,
      category: 'Supplies expense',
      transactionId: 't',
    },
    {
      id: 'reverse',
      name: 'Reversal',
      date: '2026-11-03',
      amount: -2,
      category: 'Supplies expense',
    },
    {
      id: 'stock',
      name: 'Stock',
      date: '2026-11-01',
      amount: 50,
      inventory: true,
    },
    {
      id: 'pending',
      name: 'Pending',
      date: '2026-11-01',
      amount: 20,
      status: 'pending',
    },
  ]
  data.finance_transactions = [
    { id: 't', name: 'Bill', date: '2026-11-01', kind: 'bill', amount: 12 },
    {
      id: 'pay',
      name: 'Pay bill',
      date: '2026-11-02',
      kind: 'vendorPayment',
      amount: 12,
    },
    {
      id: 'payout',
      name: 'Payout',
      date: '2026-11-02',
      kind: 'squarePayout',
      amount: 80,
    },
    {
      id: 'transfer',
      name: 'Transfer',
      date: '2026-11-02',
      kind: 'transfer',
      amount: 50,
    },
  ]
  data.consignment_sales = [
    {
      id: 'c',
      name: 'Commission',
      date: '2026-11-03',
      commission: 3,
      deductions: 0,
      businessFee: 1,
      tax: 2,
    },
  ]
  const result = financeDashboard(data, '2026-11-01', '2026-11-30')
  expect(result.income.value).toBe(83)
  expect(result.expenses.value).toBe(14)
  expect(result.tax.value).toBe(8.4)
  expect(result.difference).toBe(69)
  expect(result.trend).toEqual([{ month: '2026-11', income: 83, expenses: 14 }])
  expect(result.categories.reduce((n, c) => n + (c.value || 0), 0)).toBe(14)
  expect(financeDashboard(data, '2026-11-02', '2026-11-02').income.value).toBe(
    -20,
  )
})
it('distinguishes empty, missing and recorded zero; scopes attention and category records to dates', () => {
  const data = w()
  expect(
    financeDashboard(data, '2026-11-01', '2026-11-30').income.records,
  ).toHaveLength(0)
  data.sales = [
    { id: 's', name: 'Sale', date: '2026-11-01', amount: 0, tax: null },
  ]
  data.expenses = [
    { id: 'missing', name: 'Missing', date: '2026-11-02', amount: null },
  ]
  data.receipt_extractions = [
    { id: 'u', name: 'Undated', status: 'draft' },
    { id: 'old', name: 'Old', status: 'draft', date: '2026-10-01' },
  ]
  const result = financeDashboard(data, '2026-11-01', '2026-11-30')
  expect(result.income.value).toBe(0)
  expect(result.expenses.value).toBeNull()
  expect(result.tax.value).toBeNull()
  expect(result.drafts.map((r) => r.id)).toEqual(['u'])
  expect(result.missingCategories).toHaveLength(1)
})

it('adds commission and deductions in cents without float tails', () => {
  const data = w()
  data.consignment_sales = [
    {
      id: 'fraction',
      name: 'Commission',
      date: '2026-11-01',
      commission: 0.1,
      deductions: 0.2,
      businessFee: 0,
      tax: 0,
    },
  ]
  expect(financeDashboard(data, '2026-11-01', '2026-11-30').income.value).toBe(
    0.3,
  )
})
