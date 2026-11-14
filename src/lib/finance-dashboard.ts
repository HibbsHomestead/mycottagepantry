import type { Item, Workspace } from './domain'
import { receiptCents } from './receipt-totals'
import { ovenToday } from './oven-dates'

export type FinanceRecord = Item & {
  source: string
  metric: string
  amount: number | null
}
const posted = (r: Item) =>
  !['draft', 'pending', 'cancelled', 'failed'].includes(r.status)
const numeric = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? receiptCents(v) : null
export function financeDashboard(
  w: Workspace,
  start: string,
  end: string,
) {
  const calendarDate = (value: unknown) => {
    if (typeof value !== 'string') return ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
    return Number.isFinite(Date.parse(value))
      ? ovenToday(w.settings[0], new Date(value))
      : ''
  }
  const inRange = (r: Item) => {
    const date = calendarDate(r.date)
    return !!date && date >= start && date <= end
  }
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
      date: calendarDate(r.date),
      id: source + ':' + r.id + ':' + metric,
      sourceId: r.sourceId || r.id,
      source,
      metric,
      category: category || r.category,
      amount: numeric(value) == null ? null : numeric(value)! / 100,
    })
  // Prefer canonical sale/expense rows; linked Money Activity headers never count twice.
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
  // Older manual expense/bill headers may predate the materialized expense rows.
  // Only these established operating-expense kinds can supply missing rows.
  for (const t of (w.finance_transactions || [])
    .filter(posted)
    .filter(inRange)) {
    if (
      !['expense', 'bill'].includes(t.kind) ||
      t.inventory ||
      (w.expenses || []).some(
        (e) =>
          e.transactionId === t.id ||
          e.id === t.id ||
          (t.receiptId && e.receiptId === t.receiptId),
      )
    )
      continue
    const splits =
      Array.isArray(t.splits) && t.splits.length
        ? t.splits
        : [{ amount: t.amount, category: t.category }]
    splits.forEach((split: Item, index: number) =>
      add(
        { ...t, id: t.id + ':' + index, sourceId: t.id },
        'finance_transactions',
        'expenses',
        split.amount,
        split.category,
      ),
    )
  }
  const metric = (name: string) => {
    const records = rows.filter((r) => r.metric === name)
    return {
      records,
      value: records.some((r) => r.amount == null)
        ? null
        : records.reduce((s, r) => s + receiptCents(r.amount)!, 0) /
          100,
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
          : records.reduce((n, r) => n + receiptCents(r.amount)!, 0) /
            100,
      }
    })
    .sort((a, b) => Math.abs(b.value || 0) - Math.abs(a.value || 0))
  const daily = (Date.parse(end) - Date.parse(start)) / 86400000 <= 62
  const bucket = (date: string) => date.slice(0, daily ? 10 : 7)
  const months = [
    ...new Set(
      rows.filter((r) => r.metric !== 'tax').map((r) => bucket(r.date)),
    ),
  ].sort()
  const trend = months.map((month) => ({
    month,
    ...Object.fromEntries(
      ['income', 'expenses'].map((key) => {
        const records = rows.filter(
          (r) => bucket(r.date) === month && r.metric === key,
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
  })) as {
    month: string
    income: number | null
    expenses: number | null
  }[]
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
  // Receipt documents explain the figures; they are never an additional expense.
  // Review/processing status is historical once the receipt has been posted.
  const receiptRecords = (w.receipt_extractions || []).map((receipt) => {
    const linked = (w.finance_transactions || []).filter(
      (t) =>
        t.receiptId === receipt.id ||
        t.id === receipt.transactionId ||
        t.id === receipt.matchedTransactionId,
    )
    const contributes = expenses.records.filter(
      (e) =>
        e.receiptId === receipt.id ||
        linked.some((t) => e.transactionId === t.id || e.sourceId === t.id),
    )
    const inventoryLines = linked
      .filter(posted)
      .flatMap((t) =>
        (t.lineSnapshots || []).filter((l: Item) => l.decision === 'inventory'),
      )
    const inventoryAmount = inventoryLines.some(
      (l: Item) => numeric(l.postedAmount) == null,
    )
      ? null
      : inventoryLines.reduce(
          (sum: number, l: Item) => sum + numeric(l.postedAmount)!,
          0,
        ) / 100
    const withinPeriod = inRange(receipt)
    const awaitingReview = receipt.status === 'draft'
    const reason = awaitingReview
      ? 'Awaiting review and posting; saved document only. Open the existing receipt to review.'
      : receipt.status === 'cancelled'
        ? 'Cancelled receipt; excluded from financial figures.'
        : !withinPeriod
          ? 'Receipt date is outside the selected period.'
          : contributes.length
            ? 'Linked posted expense details contribute once. The receipt total is not added again.'
            : inventoryLines.length
              ? 'Posted inventory purchase; recorded as an asset, not an operating expense.'
              : 'No eligible operating expense linked; review the existing receipt and purchase details.'
    return {
      receipt,
      withinPeriod,
      awaitingReview,
      reason,
      contributes: contributes.length > 0,
      expenseAmount: contributes.some((r) => r.amount == null)
        ? null
        : contributes.reduce((sum, r) => sum + receiptCents(r.amount)!, 0) /
          100,
      inventoryAmount,
      inventoryLines: inventoryLines.length,
    }
  })
  return {
    rows,
    daily,
    activity: transactions.map((t): Item & { exclusion: string } => ({
      ...t,
      exclusion: !posted(t)
        ? 'Draft or pending: excluded from posted figures'
        : ['expense', 'bill', 'receipt'].includes(t.kind)
          ? 'Expense details or inventory assets are recorded separately; this header is not added again'
          : t.kind === 'contribution'
            ? 'Owner contribution: equity, not sales income'
            : t.kind === 'draw'
              ? 'Owner draw: equity withdrawal, not operating expense'
              : t.kind === 'transfer'
                ? 'Transfer between business accounts, not income or expense'
                : t.kind === 'vendorPayment'
                  ? 'Bill payment: expense recorded with the bill'
                  : t.kind === 'squarePayout'
                    ? 'Processor payout: sales recorded separately'
                    : 'Activity record: see its underlying accounting details',
    })),
    income,
    expenses,
    tax,
    categories,
    trend,
    drafts,
    receiptRecords,
    outsidePeriod: receiptRecords.filter(
      (r) =>
        !r.withinPeriod && ['posted', 'attached'].includes(r.receipt.status),
    ),
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
        ? (receiptCents(income.value)! -
            receiptCents(expenses.value)!) /
          100
        : null,
  }
}
