import type { Item, Workspace } from './domain'
import { receiptCents } from './receipt-totals'

export type FinanceRecord = Item & {
  source: string
  metric: string
  amount: number | null
}
const posted = (r: Item) =>
  !['draft', 'pending', 'cancelled', 'failed'].includes(r.status)
const numeric = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? receiptCents(v) : null
export function financeDashboard(w: Workspace, start: string, end: string) {
  const inRange = (r: Item) => r.date >= start && r.date <= end
  const rows: FinanceRecord[] = []
  const add = (
    r: Item,
    source: string,
    metric: string,
    value: unknown,
    category?: string,
  ) =>
    rows.push({
      ...r,
      id: source + ':' + r.id + ':' + metric,
      sourceId: r.id,
      source,
      metric,
      category: category || r.category,
      amount: numeric(value) == null ? null : numeric(value)! / 100,
    })
  // Canonical sale/expense rows only. Finance transactions, payouts, bank transfers and receipt headers are never summed again.
  for (const s of (w.sales || []).filter(posted).filter(inRange)) {
    add(s, 'sales', 'income', s.amount, 'Product sales')
    add(s, 'sales', 'tax', s.tax, 'Sales tax collected')
    if (s.fees != null)
      add(s, 'sales', 'expenses', s.fees, 'Payment processing fees')
  }
  for (const s of (w.consignment_sales || [])
    .filter(posted)
    .filter(inRange)) {
    add(
      s,
      'consignment_sales',
      'income',
      numeric(s.commission) != null && numeric(s.deductions) != null
        ? (numeric(s.commission)! + numeric(s.deductions)!) / 100
        : null,
      'Consignment commission income',
    )
    add(s, 'consignment_sales', 'tax', s.tax, 'Sales tax collected')
    add(
      s,
      'consignment_sales',
      'expenses',
      s.businessFee,
      'Payment processing fees',
    )
  }
  for (const e of (w.expenses || [])
    .filter(posted)
    .filter(inRange)
    .filter((e) => !e.inventory))
    add(e, 'expenses', 'expenses', e.amount)
  const metric = (name: string) => {
    const records = rows.filter((r) => r.metric === name)
    return {
      records,
      value: records.some((r) => r.amount == null)
        ? null
        : records.reduce((s, r) => s + receiptCents(r.amount)!, 0) / 100,
    }
  }
  const income = metric('income'),
    expenses = metric('expenses'),
    tax = metric('tax')
  const categories = [
    ...new Set(
      expenses.records.map((r) => r.category || 'Missing category'),
    ),
  ]
    .map((name) => {
      const records = expenses.records.filter(
        (r) => (r.category || 'Missing category') === name,
      )
      return {
        name,
        value: records.some((r) => r.amount == null)
          ? null
          : records.reduce((n, r) => n + receiptCents(r.amount)!, 0) / 100,
      }
    })
    .sort((a, b) => Math.abs(b.value || 0) - Math.abs(a.value || 0))
  const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort()
  const trend = months.map((month) => ({
    month,
    ...Object.fromEntries(
      ['income', 'expenses'].map((key) => {
        const records = rows.filter(
          (r) => r.date.startsWith(month) && r.metric === key,
        )
        return [
          key,
          records.some((r) => r.amount == null)
            ? null
            : records.reduce((n, r) => n + receiptCents(r.amount)!, 0) /
              100,
        ]
      }),
    ),
  })) as { month: string; income: number | null; expenses: number | null }[]
  const drafts = (w.receipt_extractions || []).filter(
    (r) => r.status === 'draft' && (inRange(r) || !r.date),
  )
  const transactions = (w.finance_transactions || []).filter(inRange)
  const unreconciled = transactions.filter(
    (t) =>
      posted(t) &&
      !t.reversedBy &&
      t.kind !== 'reversal' &&
      !(w.finance_reviews || []).some((r) => r.transactionId === t.id),
  )
  return {
    rows,
    income,
    expenses,
    tax,
    categories,
    trend,
    drafts,
    transactions,
    unreconciled,
    missingCategories: expenses.records.filter((r) => !r.category),
    failures: drafts.filter((r) =>
      ['failed', 'not_configured', 'upload_failed'].includes(
        r.extractionStatus,
      ),
    ),
    difference:
      income.value != null && expenses.value != null
        ? (receiptCents(income.value)! - receiptCents(expenses.value)!) /
          100
        : null,
  }
}
