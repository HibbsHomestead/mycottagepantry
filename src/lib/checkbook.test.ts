import { planFinance } from './finance'
import { describe, it, expect } from 'vitest'
import { bookRows, bookSummary, cents, planBookkeeping } from './checkbook'
import { demoData } from './demo'
import type { Workspace, Item } from './domain'
let sequence = 0
const id = () => `book-${++sequence}`
function setup() {
  const w = demoData()
  for (const key of [
    'journals',
    'finance_transactions',
    'finance_reviews',
    'sales',
    'expenses',
    'ledger',
    'accounts',
    'receipt_extractions',
  ])
    w[key] = []
  return w
}
function apply(w: Workspace, action: string, d: Partial<Item>) {
  const p = planBookkeeping(
    w,
    action,
    {
      date: '2026-11-12',
      account: 'Cash',
      name: 'Test',
      requestId: id(),
      ...d,
    },
    id,
  )
  for (const x of p.writes) {
    const rows = (w[x.table] ||= [])
    const i = rows.findIndex((r) => r.id === x.record.id)
    if (i < 0) rows.push(x.record)
    else rows[i] = x.record
  }
  return p
}
const summary = (w: Workspace) => bookSummary(w, '2026-11-01', '2026-11-30')
describe('checkbook stored posting calculations', () => {
  it('calculates splits, balances, and neutral transfers/owner money to the cent', () => {
    const w = setup()
    apply(w, 'financeBookEntry', { kind: 'contribution', amount: '100' })
    apply(w, 'financeBookEntry', {
      kind: 'income',
      category: 'Sales',
      amount: '23.19',
    })
    apply(w, 'financeBookEntry', {
      kind: 'expense',
      category: 'Software',
      amount: '10.13',
      splits: [
        { category: 'Software', amount: '5.10' },
        { category: 'Bank fees', amount: '5.03' },
      ],
    })
    apply(w, 'financeBookEntry', {
      kind: 'transfer',
      destination: 'Bank account',
      amount: '20',
    })
    apply(w, 'financeBookEntry', { kind: 'draw', amount: '4' })
    const b = summary(w)
    expect(b.profit).toBe(1306)
    expect(b.accounts.find((a) => a.name === 'Cash')?.balance).toBe(8906)
    expect(b.accounts.find((a) => a.name === 'Bank account')?.balance).toBe(
      2000,
    )
    expect(b.spending.reduce((n, r) => n + r.amount, 0)).toBe(b.expenses)
    expect(bookRows(w).filter((r) => r.source === 'transfer')).toHaveLength(2)
  })
  it('rejects imprecise money and mismatched split totals', () => {
    expect(() => cents('1.001')).toThrow()
    const w = setup()
    expect(() =>
      apply(w, 'financeBookEntry', {
        kind: 'expense',
        amount: 10,
        category: 'Software',
        splits: [{ category: 'Software', amount: 9.99 }],
      }),
    ).toThrow(/add up/)
    expect(w.journals).toHaveLength(0)
  })
  it('recognizes unpaid bills separately and records one idempotent payment', () => {
    const w = setup()
    expect(() =>
      apply(w, 'financeBookEntry', {
        kind: 'bill',
        amount: 30,
        category: 'Software',
        dueDate: '2026-11-01',
      }),
    ).toThrow(/Turn on/)
    apply(w, 'financeBookSettings', { bills: true })
    apply(w, 'financeBookEntry', {
      kind: 'bill',
      amount: 30,
      category: 'Software',
      dueDate: '2026-11-01',
    })
    expect(summary(w).expenses).toBe(0)
    const bill = w.finance_transactions[0]
    const payment = { id: bill.id, amount: 10, requestId: 'fixed-payment' }
    apply(w, 'financeBookPay', payment)
    apply(w, 'financeBookPay', payment)
    expect(bookRows(w)).toHaveLength(1)
    expect(summary(w).expenses).toBe(1000)
    expect(summary(w).obligations[0].open).toBe(2000)
    apply(w, 'financeBookPay', { id: bill.id, amount: 20 })
    expect(summary(w).obligations[0].aging).toBe('Paid')
  })
  it('recognizes invoice receipts on payment without counting unpaid income', () => {
    const w = setup()
    apply(w, 'financeBookSettings', { invoices: true })
    apply(w, 'financeBookEntry', {
      kind: 'invoice',
      category: 'Sales',
      amount: 100,
      dueDate: '2026-11-20',
    })
    expect(summary(w).income).toBe(0)
    apply(w, 'financeBookPay', {
      id: w.finance_transactions[0].id,
      amount: 40,
    })
    expect(summary(w).income).toBe(4000)
    expect(summary(w).obligations[0].open).toBe(6000)
  })
  it('balances a statement and rejects backdated postings and voids of cleared history', () => {
    const w = setup()
    apply(w, 'financeBookEntry', {
      kind: 'income',
      category: 'Sales',
      amount: 12.34,
    })
    const row = bookRows(w)[0]
    expect(() =>
      apply(w, 'financeBookReconcile', { balance: 12, rowIds: [row.id] }),
    ).toThrow(/difference/)
    apply(w, 'financeBookReconcile', { balance: 12.34, rowIds: [row.id] })
    expect(bookRows(w)[0].reconciled).toBe(true)
    expect(() =>
      apply(w, 'financeBookEntry', {
        kind: 'income',
        category: 'Sales',
        amount: 1,
      }),
    ).toThrow(/balanced statement/)
    expect(() =>
      apply(w, 'financeBookVoid', {
        id: w.finance_transactions[0].id,
        reason: 'Wrong',
        date: '2026-11-13',
      }),
    ).toThrow(/balanced statement/)
  })
  it('keeps original and opposite records for voids', () => {
    const w = setup()
    apply(w, 'financeBookEntry', {
      kind: 'income',
      category: 'Sales',
      amount: 10,
    })
    apply(w, 'financeBookVoid', {
      id: w.finance_transactions[0].id,
      reason: 'Wrong amount',
    })
    expect(summary(w).profit).toBe(0)
    expect(w.journals).toHaveLength(2)
    expect(w.finance_transactions[0].reversedBy).toBeTruthy()
    expect(bookRows(w).at(-1)?.balance).toBe(0)
  })
  it('records gross, fees, tax and processor payout without changing profit on payout', () => {
    const w = setup()
    apply(w, 'financeBookAccount', {
      name: 'Processor',
      type: 'payment processor',
    })
    apply(w, 'financeBookEntry', {
      kind: 'market',
      channel: 'Online',
      amount: 108,
      tax: 8,
      cash: 0,
      fees: 3,
      cardAccount: 'Processor',
    })
    expect(summary(w)).toMatchObject({
      income: 10000,
      expenses: 300,
      tax: 800,
      profit: 9700,
    })
    apply(w, 'financeBookEntry', {
      kind: 'transfer',
      account: 'Processor',
      destination: 'Bank account',
      amount: 105,
    })
    expect(summary(w).profit).toBe(9700)
    expect(
      summary(w).accounts.find((a) => a.name === 'Processor')?.balance,
    ).toBe(0)
  })
  it('requires explicit review and detects imported duplicate keys', () => {
    const w = setup()
    apply(w, 'financeBookEntry', {
      kind: 'income',
      category: 'Sales',
      amount: 20,
      importKey: 'statement-line',
    })
    expect(() =>
      apply(w, 'financeBookEntry', {
        kind: 'income',
        category: 'Sales',
        amount: 20,
        importKey: 'statement-line',
      }),
    ).toThrow(/already reviewed/)
    const row = bookRows(w)[0]
    expect(() =>
      apply(w, 'financeBookMatch', {
        rowId: row.id,
        date: row.date,
        amount: 21,
        importKey: 'other',
      }),
    ).toThrow(/matching/)
    apply(w, 'financeBookMatch', {
      rowId: row.id,
      date: row.date,
      amount: 20,
      importKey: 'other',
    })
    expect(w.journals).toHaveLength(1)
  })
  it('does not expense inventory purchases twice and uses locked sale costs', () => {
    const w = setup()
    w.journals = [
      {
        id: 'purchase',
        name: 'Ingredients',
        date: '2026-11-12',
        status: 'posted',
        sourceId: 'receipt',
        lines: [
          { account: 'Inventory asset', debit: 42.18, credit: 0 },
          { account: 'Cash', debit: 0, credit: 42.18 },
        ],
      },
    ]
    w.sales = [
      { id: 'sale', name: 'Cookies', date: '2026-11-13', historicalCogs: 12 },
    ]
    w.journals.push({
      id: 'sold',
      name: 'Cookies',
      date: '2026-11-13',
      status: 'posted',
      sourceId: 'sale',
      lines: [
        { account: 'Cash', debit: 30, credit: 0 },
        { account: 'Sales revenue', debit: 0, credit: 30 },
      ],
    })
    expect(summary(w)).toMatchObject({
      income: 3000,
      expenses: 1200,
      profit: 1800,
    })
    expect(summary(w).moneyOut).toBe(4218)
  })
  it('does not silently convert legacy unlinked records into spending', () => {
    const w = setup()
    w.finance_transactions = [
      {
        id: 'legacy',
        kind: 'expense',
        date: '2026-11-12',
        name: 'Old ambiguous expense',
        amount: 40,
      },
    ]
    expect(summary(w).legacyReview).toHaveLength(1)
    expect(summary(w).expenses).toBe(0)
  })
  it('calculates mileage with the entered rate and no profit impact', () => {
    const w = setup()
    apply(w, 'financeBookMileage', {
      purpose: 'Market',
      miles: '10.5',
      rate: '0.67',
    })
    expect(summary(w).mileageTotal).toBe(704)
    expect(summary(w).profit).toBe(0)
  })
  it('keeps workspaces isolated when resolving account and payment references', () => {
    const w = setup(),
      other = setup()
    apply(other, 'financeBookAccount', {
      name: 'Private bank',
      type: 'checking',
    })
    expect(() =>
      apply(w, 'financeBookEntry', {
        kind: 'income',
        category: 'Sales',
        amount: 10,
        account: 'Private bank',
      }),
    ).toThrow(/business account/)
    expect(() =>
      apply(w, 'financeBookPay', { id: 'other-business-bill', amount: 10 }),
    ).toThrow(/unpaid balance/)
  })
  it('retains receipt review as the business-allocation source of truth', () => {
    const w = setup()
    const receipt = {
      id: 'r',
      name: 'Store receipt',
      vendor: 'Shop',
      date: '2026-11-12',
      status: 'draft',
      subtotal: 100,
      tax: 10,
      total: 110,
      printedTotal: 110,
      arithmeticVersion: 2,
      lines: [
        {
          id: 'a',
          description: 'Software',
          quantity: 1,
          amount: 60,
          allocation: 'business',
          decision: 'expense',
          category: 'Software',
          taxable: true,
        },
        {
          id: 'b',
          description: 'Personal',
          quantity: 1,
          amount: 40,
          allocation: 'personal',
          decision: 'personal',
          taxable: true,
        },
      ],
    }
    w.receipt_extractions = [receipt]
    expect(() =>
      apply(w, 'financeBookEntry', {
        kind: 'expense',
        category: 'Software',
        amount: 110,
        receiptId: 'r',
      }),
    ).toThrow(/Receipt inbox/)
    expect(w.journals).toHaveLength(0)
  })
})

it('voids a payment with its cash-basis recognition and reopens the bill balance', () => {
  const w = setup()
  apply(w, 'financeBookSettings', { bills: true })
  apply(w, 'financeBookEntry', {
    kind: 'bill',
    category: 'Software',
    amount: 30,
    dueDate: '2026-11-20',
  })
  const bill = w.finance_transactions[0]
  apply(w, 'financeBookPay', { id: bill.id, amount: 10 })
  const payment = w.finance_transactions.find((t) => t.kind === 'payment')!
  apply(w, 'financeBookVoid', { id: payment.id, reason: 'Incorrect payment' })
  expect(summary(w).expenses).toBe(0)
  expect(summary(w).obligations[0].open).toBe(3000)
  expect(bookRows(w).at(-1)?.balance).toBe(0)
})

it('allocates tiny partial payments without negative splits or cumulative rounding drift', () => {
  const w = setup()
  apply(w, 'financeBookSettings', { bills: true })
  apply(w, 'financeBookEntry', {
    kind: 'bill',
    category: 'Software',
    amount: '0.30',
    dueDate: '2026-11-20',
    splits: [
      { category: 'Software', amount: '0.10' },
      { category: 'Bank fees', amount: '0.10' },
      { category: 'Office expense', amount: '0.10' },
    ],
  })
  const bill = w.finance_transactions[0]
  for (let i = 0; i < 30; i++)
    apply(w, 'financeBookPay', { id: bill.id, amount: '0.01' })
  expect(summary(w).expenses).toBe(30)
  expect(summary(w).spending.map((r) => r.amount)).toEqual([10, 10, 10])
  expect(
    w.journals
      .flatMap((j) => j.cashBasisLines || [])
      .every((l) => l.debit >= 0 && l.credit >= 0),
  ).toBe(true)
})

it('does not count production consumption and the sold product cost twice', () => {
  const w = setup()
  w.journals = [
    {
      id: 'batch',
      name: 'Production',
      date: '2026-11-12',
      status: 'posted',
      sourceId: 'run',
      lines: [
        { account: 'Ingredient COGS', debit: 42.18, credit: 0 },
        { account: 'Inventory asset', debit: 0, credit: 42.18 },
      ],
    },
    {
      id: 'sale',
      name: 'Sale',
      date: '2026-11-13',
      status: 'posted',
      sourceId: 'sold',
      lines: [
        { account: 'Cash', debit: 30, credit: 0 },
        { account: 'Sales revenue', debit: 0, credit: 30 },
      ],
    },
  ]
  w.sales = [
    { id: 'sold', name: 'Cookies', date: '2026-11-13', historicalCogs: 12 },
  ]
  expect(summary(w)).toMatchObject({
    income: 3000,
    expenses: 1200,
    profit: 1800,
  })
})

it('posts only reviewed business purchase and tax to the selected account once', () => {
  const w = setup()
  const receipt = {
    id: 'mixed-bank',
    name: 'Mixed receipt',
    vendor: 'Shop',
    date: '2026-11-12',
    status: 'draft',
    currency: 'USD',
    subtotal: 30,
    tax: 2.4,
    total: 32.4,
    printedTotal: 32.4,
    arithmeticVersion: 2,
    allocationVersion: 1,
    taxTreatment: 'exclusive',
    lines: [
      {
        description: 'Supplies',
        amount: 20,
        allocation: 'business',
        decision: 'expense',
        category: 'Supplies expense',
        taxRate: 8,
      },
      {
        description: 'Personal',
        amount: 10,
        allocation: 'personal',
        decision: 'personal',
        category: 'Supplies expense',
        taxRate: 8,
      },
    ],
  }
  w.receipt_extractions = [receipt]
  expect(() =>
    planFinance(
      w,
      'receiptPost',
      { id: receipt.id, paymentAccount: 'Foreign account' },
      id,
    ),
  ).toThrow(/business/)
  const plan = planFinance(
    w,
    'receiptPost',
    { id: receipt.id, paymentAccount: 'Bank account' },
    id,
  )
  for (const x of plan.writes) {
    const rows = (w[x.table] ||= [])
    const i = rows.findIndex((r) => r.id === x.record.id)
    if (i < 0) rows.push(x.record)
    else rows[i] = x.record
  }
  w.journals.push(plan.journal!)
  expect(plan.journal!.lines).toContainEqual({
    account: 'Bank account',
    debit: 0,
    credit: 21.6,
  })
  expect(summary(w).expenses).toBe(2160)
  expect(bookRows(w)[0].receiptId).toBe(receipt.id)
  const repeated = planFinance(w, 'receiptPost', { id: receipt.id }, id)
  expect(repeated.writes).toEqual([])
  expect(repeated.journal).toBeUndefined()
})
