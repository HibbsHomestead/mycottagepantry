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
    {
      id: 's',
      name: 'Sale',
      date: '2026-11-01',
      amount: 100,
      tax: 8,
      fees: 3,
    },
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
    {
      id: 't',
      name: 'Bill',
      date: '2026-11-01',
      kind: 'bill',
      amount: 12,
    },
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
  expect(result.trend).toEqual([
    { month: '2026-11-01', income: 100, expenses: 15 },
    { month: '2026-11-02', income: -20, expenses: 0 },
    { month: '2026-11-03', income: 3, expenses: -1 },
  ])
  expect(
    result.categories.reduce((n, c) => n + (c.value || 0), 0),
  ).toBe(14)
  expect(
    financeDashboard(data, '2026-11-02', '2026-11-02').income.value,
  ).toBe(-20)
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
    {
      id: 'missing',
      name: 'Missing',
      date: '2026-11-02',
      amount: null,
    },
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
  expect(
    financeDashboard(data, '2026-11-01', '2026-11-30').income.value,
  ).toBe(0.3)
})

it('includes legacy manual bills without double counting canonical splits or requiring reconciliation', () => {
  const data = w()
  data.finance_transactions = [
    {
      id: 'legacy',
      name: 'Legacy',
      date: '2026-11-01',
      kind: 'expense',
      amount: 25,
      status: 'posted',
    },
    {
      id: 'split',
      name: 'Split bill',
      date: '2026-11-02',
      kind: 'bill',
      amount: 10,
      splits: [
        { category: 'Supplies expense', amount: 4 },
        { category: 'Rent expense', amount: 6 },
      ],
    },
    {
      id: 'linked',
      name: 'Linked',
      date: '2026-11-03',
      kind: 'expense',
      amount: 8,
    },
    {
      id: 'draft',
      name: 'Draft',
      date: '2026-11-03',
      kind: 'expense',
      status: 'draft',
      amount: 100,
    },
    {
      id: 'owner',
      name: 'Equity',
      date: '2026-11-03',
      kind: 'contribution',
      amount: 1000,
    },
  ]
  data.expenses = [
    {
      id: 'canonical',
      name: 'Linked',
      date: '2026-11-03',
      transactionId: 'linked',
      amount: 8,
    },
  ]
  const result = financeDashboard(data, '2026-11-01', '2026-11-30')
  expect(result.expenses.value).toBe(43)
  expect(result.unreconciled).toHaveLength(4)
  expect(result.trend.reduce((n, p) => n + (p.expenses || 0), 0)).toBe(
    43,
  )
  expect(
    result.categories.reduce((n, p) => n + (p.value || 0), 0),
  ).toBe(43)
  expect(
    result.activity.find((r) => r.id === 'owner')?.exclusion,
  ).toContain('equity')
})
it('converts timestamp instants into business dates and preserves calendar dates at boundaries', () => {
  const data = w()
  data.settings[0].timezone = 'America/Chicago'
  data.sales = [
    {
      id: 'utc',
      name: 'UTC',
      date: '2026-11-02T01:30:00Z',
      amount: 10,
      tax: 0,
    },
    {
      id: 'calendar',
      name: 'Calendar',
      date: '2026-11-02',
      amount: 20,
      tax: 0,
    },
  ]
  const result = financeDashboard(data, '2026-11-01', '2026-11-01')
  expect(result.income.value).toBe(10)
  expect(result.rows[0].date).toBe('2026-11-01')
  expect(
    financeDashboard(data, '0001-01-01', '9999-12-31').income.value,
  ).toBe(30)
})
