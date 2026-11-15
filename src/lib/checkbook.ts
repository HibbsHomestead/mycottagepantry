import {
  balanced,
  defaultAccounts,
  expenseCategories,
  type FinancePlan,
  type Posting,
} from './finance'
import { ovenToday } from './oven-dates'
import { validateDate, type Item, type Workspace } from './domain'

// All money arithmetic in this module uses integer cents. Persisted journal amounts
// retain the existing decimal-dollar format, enforced by the database balance trigger.
export function cents(value: unknown): number {
  if (!/^-?\d+(\.\d{1,2})?$/.test(String(value)))
    throw new Error('Enter an amount with at most two decimal places.')
  const n = Math.round(Number(value) * 100)
  if (!Number.isSafeInteger(n) || Math.abs(n) > 100000000000)
    throw new Error('Enter a smaller amount.')
  return n
}
const clean = (v: unknown) =>
  String(v ?? '')
    .trim()
    .slice(0, 1000)
const plainCategory = (name: string) =>
  (
    ({
      'Owner equity': 'Owner contribution',
      'Owner draws': 'Owner draw',
      'Inventory asset': 'Ingredients / materials',
      'Sales revenue': 'Sales',
      'Accounts payable': 'Bill payment',
      'Accounts receivable': 'Invoice payment',
      'Sales Tax Payable': 'Sales tax collected',
    }) as Record<string, string>
  )[name] || name.replace(/ COGS$/, ' product costs')
export const cashDefaults = ['Cash', 'Bank account']
export function bookAccounts(w: Workspace): Item[] {
  return [
    ...cashDefaults.map((name) => ({
      id: name,
      name,
      type: 'asset',
      bookAccount: true,
    })),
    ...(w.accounts || []).filter(
      (a) => a.bookAccount && !cashDefaults.includes(a.name),
    ),
  ]
}
export function bookCategories(w: Workspace): Item[] {
  return [
    ...['Sales', 'Other income'].map((name) => ({
      id: name,
      name,
      type: 'income',
      mappedAccount: name === 'Sales' ? 'Sales revenue' : name,
    })),
    ...expenseCategories.map((name) => ({
      id: name,
      name,
      type: 'expense',
      mappedAccount: name,
    })),
    ...(w.accounts || []).filter((a) => a.bookCategory),
  ]
}
const accountTypes = (w: Workspace) =>
  new Map(
    [...defaultAccounts, ...(w.accounts || [])].map((a) => [a.name, a.type]),
  )
export function bookRows(w: Workspace): Item[] {
  const names = new Set(bookAccounts(w).map((a) => a.name)),
    balances: Record<string, number> = {}
  const rows: Item[] = []
  for (const j of [...(w.journals || [])]
    .filter((j) => j.status === 'posted')
    .sort(
      (a, b) =>
        String(a.date).localeCompare(String(b.date)) ||
        String(a.id).localeCompare(String(b.id)),
    )) {
    const source =
      (w.finance_transactions || []).find((t) => t.id === j.sourceId) ||
      (w.sales || []).find((t) => t.id === j.sourceId) ||
      (w.ledger || []).find((t) => t.id === j.sourceId) ||
      (w.consignment_sales || []).find((t) => t.id === j.sourceId)
    const categories = [
      ...new Set(
        (j.lines || [])
          .filter((l: Posting) => !names.has(l.account))
          .map((l: Posting) => l.account),
      ),
    ]
    for (const name of names) {
      const lines = (j.lines || []).filter((l: Posting) => l.account === name)
      if (!lines.length) continue
      const delta = lines.reduce(
        (s: number, l: Posting) =>
          s + cents(l.debit || 0) - cents(l.credit || 0),
        0,
      )
      if (!delta) continue
      balances[name] = (balances[name] || 0) + delta
      const id = j.id + ':' + name
      const marks = (w.finance_reviews || []).filter(
        (r) => r.kind === 'cleared' && r.rowId === id,
      )
      const reconciliation = (w.finance_reviews || []).find(
        (r) => r.kind === 'statement' && r.rowIds?.includes(id),
      )
      rows.push({
        id,
        name: j.feePosting
          ? j.name
          : source?.customer || source?.name || j.name,
        date: j.date,
        account: name,
        category:
          source?.category ||
          categories.map((name) => plainCategory(String(name))).join(' / ') ||
          'Transfer',
        moneyIn: Math.max(delta, 0),
        moneyOut: Math.max(-delta, 0),
        balance: balances[name],
        cleared: !!reconciliation || marks.at(-1)?.cleared === true,
        reconciled: !!reconciliation,
        movementType: (j.lines || []).every(
          (l: Posting) =>
            names.has(l.account) ||
            ['Owner equity', 'Owner draws'].includes(l.account),
        )
          ? 'neutral'
          : 'activity',
        sourceId: j.sourceId,
        transactionId: source?.id,
        receiptId: source?.receiptId,
        journalId: j.id,
        source: source
          ? source.kind || (source.productId ? 'Sale' : 'Purchase')
          : 'Needs source review',
        notes: source?.notes || '',
        channel: source?.channel || '',
        reversalOf: j.reversalOf,
      })
    }
  }
  return rows
}
export function bookSummary(w: Workspace, from: string, to: string) {
  validateDate(from)
  validateDate(to)
  if (from > to)
    throw new Error('Choose an ending date after the starting date.')
  const rows = bookRows(w),
    types = accountTypes(w)
  const within = (r: Item) => r.date >= from && r.date <= to
  const totals: Record<string, number> = {},
    channels: Record<string, number> = {}
  let income = 0,
    expenses = 0,
    tax = 0
  for (const j of (w.journals || []).filter(
    (j) => j.status === 'posted' && within(j),
  )) {
    // Unpaid bills/invoices are excluded; their settlement carries cash-basis
    // recognition from the original categories. Transfers/equity never enter P&L.
    const deferred = (j.lines || []).some((l: Posting) =>
      ['Accounts payable', 'Accounts receivable'].includes(l.account),
    )
    const payment = (w.finance_transactions || []).find(
      (t) => t.id === j.sourceId && t.kind === 'vendorPayment',
    )
    const bill =
      payment &&
      (w.finance_transactions || []).find((t) => t.id === payment.billId)
    let legacySettlement: Posting[] | undefined
    if (bill) {
      const allocations = bill.splits?.length
        ? bill.splits
        : [{ category: bill.category, amount: bill.amount }]
      let allocated = 0
      legacySettlement = allocations.map((s: Item, i: number) => {
        const n =
          i === allocations.length - 1
            ? cents(payment!.amount) - allocated
            : Math.round(
                (cents(payment!.amount) * cents(s.amount)) / cents(bill.amount),
              )
        allocated += n
        return { account: s.category, debit: n / 100, credit: 0 }
      })
    }
    const settlement = j.cashBasisLines || legacySettlement
    const lines = settlement || (deferred ? [] : j.lines || [])
    for (const l of lines) {
      if (
        /^(Ingredient|Packaging|Production labor) COGS$/.test(l.account) &&
        !(w.sales || []).some((s) => s.id === j.sourceId)
      )
        continue
      const type = types.get(l.account)
      const n = cents(l.credit || 0) - cents(l.debit || 0)
      if (type === 'income') income += n
      if (type === 'expense') {
        expenses -= n
        totals[l.account] = (totals[l.account] || 0) - n
      }
    }
    for (const l of j.lines || [])
      if (l.account === 'Sales Tax Payable')
        tax += cents(l.credit || 0) - cents(l.debit || 0)
    const amount = lines
      .filter((l: Posting) => types.get(l.account) === 'income')
      .reduce(
        (n: number, l: Posting) =>
          n + cents(l.credit || 0) - cents(l.debit || 0),
        0,
      )
    if (amount) {
      const sale =
        (w.sales || []).find((s) => s.id === j.sourceId) ||
        (w.finance_transactions || []).find((s) => s.id === j.sourceId)
      const channel = sale?.channel || 'Other / review channel'
      channels[channel] = (channels[channel] || 0) + amount
    }
  }
  // Existing sales lock their actual/estimated COGS in historicalCogs. Include
  // those snapshots only when no linked COGS posting already exists.
  let cogs = 0
  for (const s of (w.sales || []).filter(within)) {
    if (
      !(w.journals || []).some(
        (j) => j.status === 'posted' && j.sourceId === s.id,
      )
    )
      continue
    if (
      !(w.journals || []).some(
        (j) =>
          j.sourceId === s.id &&
          (j.lines || []).some((l: Posting) => /COGS/.test(l.account)),
      )
    ) {
      if (Number.isFinite(s.historicalCogs))
        cogs += Math.round(s.historicalCogs * 100)
    }
  }
  if (cogs) {
    expenses += cogs
    totals['Product costs'] = (totals['Product costs'] || 0) + cogs
  }
  const today = ovenToday(w.settings?.[0])
  const obligations = (w.finance_transactions || [])
    .filter((t) => ['bill', 'invoice'].includes(t.kind) && !t.reversedBy)
    .map((t) => {
      const open = cents(t.amount) - cents(t.paid || 0)
      const days = Math.max(
        0,
        Math.floor(
          (Date.parse(today) - Date.parse(t.dueDate || t.date)) / 86400000,
        ),
      )
      return {
        ...t,
        open,
        aging: !open
          ? 'Paid'
          : days === 0
            ? 'Current'
            : days <= 30
              ? '1–30'
              : days <= 60
                ? '31–60'
                : days <= 90
                  ? '61–90'
                  : '90+',
      }
    })
  const mileage = (w.finance_reviews || []).filter(
    (r) => r.kind === 'mileage' && within(r),
  )
  const missing = [
    ...(w.finance_transactions || []),
    ...(w.sales || []).filter((s) => !s.transactionId),
    ...(w.expenses || []).filter((e) => !e.transactionId && !e.inventory),
  ].filter(
    (t) =>
      !['bill', 'invoice'].includes(t.kind) &&
      !(w.journals || []).some((j) => j.sourceId === t.id) &&
      !(t.saleIds || []).some((id: string) =>
        (w.journals || []).some((j) => j.sourceId === id),
      ),
  )
  return {
    id: 'bookkeeping',
    name: 'Bookkeeping',
    from,
    to,
    rows,
    income,
    expenses,
    profit: income - expenses,
    tax,
    cogs,
    moneyIn: rows
      .filter(within)
      .filter((r) => r.movementType !== 'neutral')
      .reduce((n, r) => n + r.moneyIn, 0),
    moneyOut: rows
      .filter(within)
      .filter((r) => r.movementType !== 'neutral')
      .reduce((n, r) => n + r.moneyOut, 0),
    spending: Object.entries(totals).map(([name, amount]) => ({
      id: name,
      name: plainCategory(name),
      amount,
    })),
    channels: Object.entries(channels).map(([name, amount]) => ({
      id: name,
      name,
      amount,
    })),
    accounts: bookAccounts(w).map((a) => ({
      ...a,
      balance:
        rows.filter((r) => r.account === a.name && r.date <= to).at(-1)
          ?.balance || 0,
    })),
    obligations,
    mileage,
    mileageTotal: mileage.reduce((n, r) => n + r.amountCents, 0),
    receiptsNeedingReview: (w.receipt_extractions || []).filter(
      (r) => r.status === 'draft',
    ).length,
    legacyReview: missing.map((t) => ({
      id: t.id,
      name: t.name,
      date: t.date,
    })),
    settings: w.settings?.[0]?.bookkeeping || {},
    categories: bookCategories(w),
    recurring: (w.finance_reviews || []).filter((r) => r.kind === 'recurring'),
    statements: (w.finance_reviews || []).filter((r) => r.kind === 'statement'),
  }
}
function positive(v: unknown) {
  const n = cents(v)
  if (n <= 0) throw new Error('Enter an amount greater than zero.')
  return n
}
function openDate(w: Workspace, date: string, names?: string[]) {
  validateDate(date)
  if (
    (w.finance_reviews || []).some(
      (r) =>
        r.kind === 'statement' &&
        r.date >= date &&
        (!names || names.includes(r.account)),
    )
  )
    throw new Error(
      'This date is in a balanced statement period. Choose a later correction date.',
    )
}
export function planBookkeeping(
  w: Workspace,
  action: string,
  d: Partial<Item>,
  newId: () => string,
): FinancePlan {
  const writes: FinancePlan['writes'] = []
  const put = (table: string, record: Item) => {
    writes.push({ table, record })
    return record
  }
  if (d.importKey && clean(d.importKey) !== d.importKey)
    throw new Error(
      'This statement description is too long. Shorten it before importing.',
    )
  const id = newId(),
    today = ovenToday(w.settings?.[0])
  const settings = w.settings?.[0]
  const existing = (w.finance_reviews || []).find(
    (r) => r.requestId && r.requestId === d.requestId,
  )
  if (!clean(d.requestId)) throw new Error('Reopen this form before saving.')
  if (existing || (w.journals || []).some((j) => j.requestId === d.requestId))
    return { writes: [], description: 'Already saved' }
  const account = (v: unknown) => {
    const a = bookAccounts(w).find((a) => a.name === v)
    if (!a) throw new Error('Choose a business account.')
    return a.name as string
  }
  const category = (v: unknown, type: string) => {
    const c = bookCategories(w).find((c) => c.name === v && c.type === type)
    if (!c) throw new Error('Choose a category for this transaction.')
    return c.mappedAccount || c.name
  }
  const journal = (
    name: string,
    date: string,
    lines: Posting[],
    sourceId: string,
    extra: Partial<Item> = {},
  ) => {
    openDate(
      w,
      date,
      lines.map((l) => l.account),
    )
    return put('journals', {
      id: newId(),
      name,
      date,
      status: 'posted',
      sourceId,
      lines: balanced(lines),
      requestId: d.requestId,
      ...extra,
    })
  }
  const line = (account: string, n: number): Posting => ({
    account,
    debit: Math.max(n, 0) / 100,
    credit: Math.max(-n, 0) / 100,
  })
  if (action === 'financeBookSettings') {
    put('settings', {
      ...settings,
      bookkeeping: {
        ...settings.bookkeeping,
        bills: d.bills === true,
        invoices: d.invoices === true,
      },
    })
  } else if (
    action === 'financeBookAccount' ||
    action === 'financeBookCategory'
  ) {
    const name = clean(d.name)
    if (
      !name ||
      bookCategories(w).some(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
      ) ||
      (w.accounts || []).some(
        (a) => a.name.toLowerCase() === name.toLowerCase(),
      ) ||
      defaultAccounts.some((a) => a.name.toLowerCase() === name.toLowerCase())
    )
      throw new Error('Enter a new, unique name.')
    if (action === 'financeBookAccount') {
      if (
        ![
          'checking',
          'savings',
          'cash box',
          'business card',
          'payment processor',
        ].includes(d.type)
      )
        throw new Error('Choose an account type.')
      put('accounts', {
        id,
        name,
        type: d.type === 'business card' ? 'liability' : 'asset',
        bookAccount: true,
        accountKind: d.type,
      })
    } else {
      if (!['income', 'expense'].includes(d.type))
        throw new Error('Choose money in or money out.')
      put('accounts', {
        id,
        name,
        type: d.type,
        bookCategory: true,
        mappedAccount: name,
      })
    }
  } else if (action === 'financeBookMileage') {
    const miles = Number(d.miles),
      rate = positive(d.rate)
    if (
      !Number.isFinite(miles) ||
      miles <= 0 ||
      miles > 100000 ||
      !clean(d.purpose)
    )
      throw new Error('Enter the trip purpose and miles traveled.')
    validateDate(d.date)
    put('finance_reviews', {
      id,
      name: clean(d.purpose),
      kind: 'mileage',
      date: d.date,
      miles,
      rateCents: rate,
      amountCents: Math.round(miles * rate),
      requestId: d.requestId,
    })
  } else if (action === 'financeBookCleared') {
    const row = bookRows(w).find((r) => r.id === d.rowId)
    if (!row || row.reconciled)
      throw new Error('Choose a transaction outside a balanced statement.')
    put('finance_reviews', {
      id,
      name: 'Cleared status',
      kind: 'cleared',
      rowId: row.id,
      cleared: d.cleared === true,
      date: today,
      requestId: d.requestId,
    })
  } else if (action === 'financeBookReconcile') {
    const name = account(d.account)
    openDate(w, d.date, [name])
    const rows = bookRows(w).filter(
      (r) =>
        r.account === name &&
        r.date <= d.date &&
        (r.reconciled || (Array.isArray(d.rowIds) && d.rowIds.includes(r.id))),
    )
    const total = rows.reduce((n, r) => n + r.moneyIn - r.moneyOut, 0)
    if (total !== cents(d.balance))
      throw new Error('The difference must be $0.00 before finishing.')
    put('finance_reviews', {
      id,
      name: 'Balanced statement',
      kind: 'statement',
      account: name,
      date: d.date,
      balanceCents: total,
      rowIds: rows.map((r) => r.id),
      requestId: d.requestId,
    })
  } else if (action === 'financeBookRecurring') {
    const name = account(d.account),
      amount = positive(d.amount)
    validateDate(d.date)
    category(d.category, 'expense')
    if (!clean(d.name)) throw new Error('Enter a payee.')
    put('finance_reviews', {
      id,
      name: clean(d.name),
      kind: 'recurring',
      account: name,
      amount: amount / 100,
      category: d.category,
      date: d.date,
      requestId: d.requestId,
    })
  } else if (action === 'financeBookVoid') {
    const tx = (w.finance_transactions || []).find(
      (t) => t.id === d.id && t.bookkeeping,
    )
    if (
      !tx ||
      tx.reversedBy ||
      (['bill', 'invoice'].includes(tx.kind) && (tx.paid || 0) > 0)
    )
      throw new Error('Use the linked source correction for this record.')
    if (!clean(d.reason)) throw new Error('Enter a reason for the correction.')
    const originals = (w.journals || []).filter((j) => j.sourceId === tx.id)
    if (
      bookRows(w).some(
        (r) => originals.some((j) => j.id === r.journalId) && r.reconciled,
      )
    )
      throw new Error(
        'This transaction is in a balanced statement. Contact your accountant before correcting it.',
      )
    if (tx.kind === 'payment') {
      const obligation = (w.finance_transactions || []).find(
        (t) => t.id === tx.billId,
      )
      if (!obligation || cents(obligation.paid || 0) < cents(tx.amount))
        throw new Error('Review the original payment before correcting it.')
      put('finance_transactions', {
        ...obligation,
        paid: (cents(obligation.paid) - cents(tx.amount)) / 100,
      })
    }
    for (const j of originals)
      journal(
        'Void: ' + tx.name,
        d.date,
        (j.lines as Posting[]).map((l) => ({
          account: l.account,
          debit: l.credit,
          credit: l.debit,
        })),
        id,
        {
          reversalOf: j.id,
          ...(j.cashBasisLines
            ? {
                cashBasisLines: (j.cashBasisLines as Posting[]).map((l) => ({
                  account: l.account,
                  debit: l.credit,
                  credit: l.debit,
                })),
              }
            : {}),
        },
      )
    put('finance_transactions', { ...tx, reversedBy: id })
    put('finance_transactions', {
      id,
      name: 'Void: ' + tx.name,
      kind: 'reversal',
      date: d.date,
      amount: -tx.amount,
      originalId: tx.id,
      reason: clean(d.reason),
      bookkeeping: true,
      status: 'posted',
    })
  } else if (action === 'financeBookEntry' || action === 'financeBookPay') {
    const kind = action === 'financeBookPay' ? 'payment' : d.kind
    if (
      ![
        'income',
        'expense',
        'transfer',
        'contribution',
        'draw',
        'bill',
        'invoice',
        'market',
        'payment',
      ].includes(kind)
    )
      throw new Error('Choose a transaction type.')
    const when = validateDate(d.date),
      amount = positive(d.amount),
      name = account(d.account)
    if (!clean(d.name)) throw new Error('Enter a payee or customer.')
    const tx: Item = {
      id,
      name: clean(d.name),
      kind,
      date: when,
      amount: amount / 100,
      account: name,
      category: clean(d.category),
      notes: clean(d.notes),
      channel: clean(d.channel),
      bookkeeping: true,
      status: 'posted',
      paid: 0,
    }
    const extra: Partial<Item> = {}
    let lines: Posting[],
      feeLines: Posting[] = []
    if (kind === 'payment') {
      const bill = (w.finance_transactions || []).find(
        (t) =>
          t.id === d.id &&
          ['bill', 'invoice'].includes(t.kind) &&
          !t.reversedBy,
      )
      if (!bill || amount > cents(bill.amount) - cents(bill.paid || 0))
        throw new Error(
          'Payment exceeds the unpaid balance or this record changed. Refresh and try again.',
        )
      const sign = bill.kind === 'invoice' ? 1 : -1
      lines = [
        line(name, sign * amount),
        line(
          sign === 1 ? 'Accounts receivable' : 'Accounts payable',
          -sign * amount,
        ),
      ]
      // Recognize the settled portion using the original category allocation.
      const original = (w.journals || []).find((j) => j.sourceId === bill.id)
      const allocations = (original?.lines || []).filter(
        (l: Posting) =>
          !['Accounts payable', 'Accounts receivable'].includes(l.account),
      )
      const apportion = (paid: number): number[] => {
        let remaining = paid,
          weight = cents(bill.amount)
        return allocations.map((l: Posting) => {
          const value = Math.abs(cents(l.debit) - cents(l.credit))
          const portion = weight
            ? Number(
                (BigInt(remaining) * BigInt(value) +
                  BigInt(Math.floor(weight / 2))) /
                  BigInt(weight),
              )
            : 0
          remaining -= portion
          weight -= value
          return portion
        })
      }
      const before = apportion(cents(bill.paid || 0)),
        after = apportion(cents(bill.paid || 0) + amount)
      extra.cashBasisLines = allocations.map((l: Posting, i: number) =>
        line(l.account, (sign === 1 ? -1 : 1) * (after[i] - before[i])),
      )
      if (!allocations.length)
        throw new Error(
          'Review the original categories before recording this payment.',
        )
      tx.billId = bill.id
      tx.category = bill.category
      put('finance_transactions', {
        ...bill,
        paid: (cents(bill.paid || 0) + amount) / 100,
      })
    } else if (kind === 'transfer') {
      const destination = account(d.destination)
      if (destination === name)
        throw new Error('Choose two different accounts.')
      lines = [line(name, -amount), line(destination, amount)]
    } else if (kind === 'contribution' || kind === 'draw') {
      const sign = kind === 'contribution' ? 1 : -1
      lines = [
        line(name, sign * amount),
        line(sign === 1 ? 'Owner equity' : 'Owner draws', -sign * amount),
      ]
    } else if (kind === 'market') {
      const tax = cents(d.tax || 0),
        fees = cents(d.fees || 0),
        cash = cents(d.cash || 0)
      if (
        tax < 0 ||
        tax > amount ||
        fees < 0 ||
        cash < 0 ||
        cash > amount ||
        fees > amount - cash
      )
        throw new Error('Review gross sales, tax, cash, and fees.')
      const cardAccount = account(d.cardAccount)
      lines = [
        line(name, cash),
        line(cardAccount, amount - cash),
        line('Sales revenue', -(amount - tax)),
        line('Sales Tax Payable', -tax),
      ]
      if (fees)
        feeLines = [
          line('Payment processing fees', fees),
          line(cardAccount, -fees),
        ]
      tx.channel = clean(d.channel) || 'Market'
      tx.tax = tax / 100
      tx.fees = fees / 100
    } else {
      if (['bill', 'invoice'].includes(kind)) {
        if (!settings.bookkeeping?.[kind === 'bill' ? 'bills' : 'invoices'])
          throw new Error('Turn on this tracking in Settings first.')
        tx.dueDate = validateDate(d.dueDate)
        tx.account =
          kind === 'bill' ? 'Accounts payable' : 'Accounts receivable'
      }
      const incoming = ['income', 'invoice'].includes(kind),
        type = incoming ? 'income' : 'expense'
      const splits =
        Array.isArray(d.splits) && d.splits.length
          ? d.splits
          : [{ category: d.category, amount: d.amount }]
      if (splits.length > 30) throw new Error('Use at most 30 categories.')
      const allocations = splits.map((s: Item) => ({
        category: category(s.category, type),
        amount: positive(s.amount),
      }))
      if (allocations.reduce((n: number, s) => n + s.amount, 0) !== amount)
        throw new Error('Category amounts must add up to the total.')
      lines = [
        ...allocations.map((s) =>
          line(s.category, incoming ? -s.amount : s.amount),
        ),
        line(tx.account, incoming ? amount : -amount),
      ]
      tx.category = allocations
        .map((s) => plainCategory(s.category))
        .join(' / ')
      tx.splits = allocations.map((s) => ({
        ...s,
        amount: s.amount / 100,
      }))
    }
    if (d.receiptId) {
      const receipt = (w.receipt_extractions || []).find(
        (r) => r.id === d.receiptId && r.status === 'draft',
      )
      if (
        !receipt ||
        (w.finance_transactions || []).some((t) => t.receiptId === receipt.id)
      )
        throw new Error(
          'Use the existing receipt review to avoid recording this purchase twice.',
        )
      // Receipt review remains the only posting route for uploaded purchase documents.
      throw new Error(
        'Post this purchase from Receipt inbox so its business allocation and inventory are checked.',
      )
    }
    if (
      d.importKey &&
      (w.finance_reviews || []).some((r) => r.importKey === d.importKey)
    )
      throw new Error('This statement line was already reviewed.')
    journal(tx.name, when, lines, id, extra)
    if (feeLines.length)
      journal('Processing fee: ' + tx.name, when, feeLines, id, {
        feePosting: true,
      })
    put('finance_transactions', tx)
    if (d.importKey)
      put('finance_reviews', {
        id: newId(),
        name: tx.name,
        kind: 'import',
        importKey: clean(d.importKey),
        rowId: id,
        date: when,
        requestId: d.requestId,
      })
  } else if (action === 'financeBookMatch') {
    const row = bookRows(w).find((r) => r.id === d.rowId)
    if (
      !row ||
      row.date !== d.date ||
      row.moneyIn - row.moneyOut !== cents(d.amount) ||
      row.account !== d.account
    )
      throw new Error('Choose a matching account, date, and amount.')
    if (
      !clean(d.importKey) ||
      (w.finance_reviews || []).some((r) => r.importKey === d.importKey)
    )
      throw new Error('This statement line was already reviewed.')
    put('finance_reviews', {
      id,
      name: 'Statement line matched',
      kind: 'import',
      importKey: clean(d.importKey),
      rowId: row.id,
      date: today,
      requestId: d.requestId,
    })
  } else throw new Error('Choose an available bookkeeping action.')
  if (
    !writes.some(
      (x) =>
        x.table === 'journals' ||
        (x.table === 'finance_reviews' && x.record.requestId === d.requestId),
    )
  )
    put('finance_reviews', {
      id: newId(),
      name: 'Bookkeeping setting saved',
      kind: 'setting',
      date: today,
      requestId: d.requestId,
    })
  return { writes, description: 'Bookkeeping updated' }
}
