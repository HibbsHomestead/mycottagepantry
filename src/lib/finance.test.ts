import { expect, it } from 'vitest'
import {
  planFinance,
  consignmentMath,
  consignmentBalance,
  duplicateReceipts,
} from './finance'
import { demoData } from './demo'
import type { Workspace } from './domain'
let counter = 0
const id = () => `new-${++counter}`
function apply(w: Workspace, action: string, data: any) {
  const p = planFinance(w, action, data, id)
  for (const x of p.writes) {
    const rows = (w[x.table] ||= [])
    const index = rows.findIndex((r) => r.id === x.record.id)
    if (index < 0) rows.push(x.record)
    else rows[index] = x.record
  }
  if (p.journal) (w.journals ||= []).push(p.journal)
  return p
}
function setup() {
  const w = demoData()
  w.consignors = [
    {
      id: 'maker',
      name: 'Family crochet',
      commissionType: 'percentage',
      commissionRate: 10,
    },
  ]
  w.consignment_items = [
    {
      id: 'hat',
      name: 'Crocheted hat',
      consignorId: 'maker',
      available: 4,
      received: 4,
      sold: 0,
      returned: 0,
      price: 30,
    },
  ]
  return w
}
it('records only a $3 commission as revenue for a $30 consignment sale, and pays $27 without an expense', () => {
  const w = setup(),
    sale = apply(w, 'consignmentSale', {
      itemId: 'hat',
      quantity: 1,
      gross: 30,
      tax: 2.475,
      date: '2026-10-29',
    })
  expect(sale.journal?.lines).toEqual([
    { account: 'Cash', debit: 32.48, credit: 0 },
    { account: 'Consignment Payable', debit: 0, credit: 27 },
    { account: 'Consignment Commission Income', debit: 0, credit: 3 },
    { account: 'Sales Tax Payable', debit: 0, credit: 2.48 },
  ])
  expect(consignmentBalance(w, 'maker')).toBe(27)
  const first = apply(w, 'consignmentPayout', {
    consignorId: 'maker',
    amount: 10,
    date: '2026-10-29',
    method: 'Cash',
  })
  expect(first.journal?.lines).toEqual([
    { account: 'Consignment Payable', debit: 10, credit: 0 },
    { account: 'Cash', debit: 0, credit: 10 },
  ])
  expect(w.consignment_sales[0].status).toBe('partially_paid')
  apply(w, 'consignmentPayout', {
    consignorId: 'maker',
    amount: 17,
    date: '2026-10-29',
    method: 'Cash',
  })
  expect(consignmentBalance(w, 'maker')).toBe(0)
  expect(w.consignment_sales[0].status).toBe('paid')
  expect(w.expenses).toHaveLength(demoData().expenses.length)
  expect(() =>
    apply(w, 'consignmentPayout', {
      consignorId: 'maker',
      amount: 1,
      date: '2026-10-29',
      method: 'Cash',
    }),
  ).toThrow('exceeds')
})
it('requires explicit consent for consignor fees and splits cents predictably', () => {
  expect(() =>
    consignmentMath({
      quantity: 1,
      gross: 30,
      commissionRate: 10,
      fees: 1.25,
      feeBearer: 'shared',
    }),
  ).toThrow('agreed processing-fee')
  const calc = consignmentMath({
    quantity: 1,
    gross: 30,
    commissionRate: 10,
    fees: 1.25,
    feeBearer: 'shared',
    feeAgreement: 'Signed agreement',
  })
  expect(calc.payable).toBe(26.37)
  expect(calc.businessFee).toBe(0.62)
  expect(calc.consignorFee).toBe(0.63)
  expect(() =>
    consignmentMath({
      quantity: 1,
      gross: 30,
      commissionRate: 10,
      deductions: 1,
    }),
  ).toThrow('approval')
})
it('posts a full refund with original commission and tax, restores stock and retains the original sale', () => {
  const w = setup()
  apply(w, 'consignmentSale', {
    itemId: 'hat',
    quantity: 1,
    gross: 30,
    tax: 2.4,
    date: '2026-10-29',
  })
  const original = structuredClone(w.consignment_sales[0])
  w.consignors[0].commissionRate = 50
  const p = apply(w, 'consignmentRefund', {
    id: original.id,
    date: '2026-10-30',
    reason: 'Customer returned item',
  })
  expect(p.journal?.lines).toContainEqual({
    account: 'Sales Tax Payable',
    debit: 2.4,
    credit: 0,
  })
  expect(p.journal?.lines).toContainEqual({
    account: 'Consignment Commission Income',
    debit: 3,
    credit: 0,
  })
  expect(w.consignment_sales[0]).toEqual(original)
  expect(consignmentBalance(w, 'maker')).toBe(0)
  expect(w.consignment_items[0].available).toBe(4)
  expect(() =>
    apply(w, 'consignmentRefund', {
      id: original.id,
      date: '2026-10-30',
      reason: 'Again',
    }),
  ).toThrow('already refunded')
})
it('receives 25 lb flour into grams, preserves old cost, splits expenses and personal purchases, and balances tax-inclusive acquisition cost', () => {
  const w = setup()
  w.ingredients = [
    {
      id: 'flour',
      name: 'Flour',
      unit: 'g',
      quantity: 1000,
      cost: 0.002,
      currentCost: 0.002,
      usedAs: 'ingredient',
    },
  ]
  w.receipt_extractions = [
    {
      id: 'receipt',
      name: 'Uploaded receipt',
      status: 'draft',
      fileHash: 'original',
      history: [],
    },
  ]
  const p = apply(w, 'receiptPost', {
    id: 'receipt',
    vendor: 'Mill',
    date: '2026-10-29',
    subtotal: 20.95,
    tax: 1.05,
    total: 22,
    lines: [
      {
        description: 'Flour',
        amount: 10.95,
        quantity: 25,
        unit: 'lb',
        decision: 'inventory',
        itemId: 'flour',
      },
      {
        description: 'Market fees',
        amount: 5,
        decision: 'expense',
        category: 'Market/vendor fees',
      },
      { description: 'Personal', amount: 5, decision: 'personal' },
    ],
  })
  expect(w.ingredients[0].quantity).toBeCloseTo(12339.80925)
  expect(w.ledger.at(-1)?.priorCost).toBe(0.002)
  expect(w.ingredients[0].cost).toBeCloseTo((2 + 11.5) / 12339.80925)
  expect(w.expenses.at(-1)?.amount).toBe(5.25)
  expect(p.journal?.lines).toContainEqual({
    account: 'Owner draws',
    debit: 5.25,
    credit: 0,
  })
  expect(p.journal?.lines).toContainEqual({
    account: 'Cash',
    debit: 0,
    credit: 22,
  })
  expect(w.receipt_extractions[0].status).toBe('posted')
  expect(w.receipt_extractions[0].fileHash).toBe('original')
  expect(() => apply(w, 'receiptPost', { id: 'receipt' })).toThrow('closed')
})
it('blocks missing density, mismatched totals, duplicate posting, and cross-workspace references', () => {
  const w = setup()
  w.ingredients = [
    { id: 'flour', name: 'Flour', unit: 'g', quantity: 0, cost: 0 },
  ]
  w.receipt_extractions = [
    { id: 'r', name: 'Receipt', status: 'draft', history: [] },
  ]
  const d = {
    id: 'r',
    vendor: 'Mill',
    date: '2026-10-29',
    subtotal: 10,
    tax: 0,
    total: 10,
    lines: [
      {
        description: 'Flour',
        amount: 10,
        quantity: 1,
        unit: 'cup',
        decision: 'inventory',
        itemId: 'flour',
      },
    ],
  }
  expect(() => planFinance(w, 'receiptPost', d, id)).toThrow(
    'verified unit conversion',
  )
  expect(() => planFinance(w, 'receiptPost', { ...d, total: 11 }, id)).toThrow(
    'Subtotal plus tax',
  )
  expect(() =>
    planFinance(
      w,
      'consignmentSale',
      { itemId: 'other-business', quantity: 1, gross: 30, date: '2026-10-29' },
      id,
    ),
  ).toThrow('oven')
  w.receipt_extractions.push({
    id: 'already',
    name: 'Posted',
    vendor: 'Mill',
    date: '2026-10-29',
    total: 10,
    status: 'posted',
  })
  expect(duplicateReceipts(w, d)).toHaveLength(1)
  expect(() =>
    planFinance(w, 'receiptPost', { ...d, duplicateReviewed: true }, id),
  ).toThrow('already posted')
})
it('keeps equity and bill payments out of income/expense, and reverses with a separate record', () => {
  const w = setup(),
    before = w.expenses.length
  const contribution = apply(w, 'financeEntry', {
    kind: 'contribution',
    name: 'Owner',
    date: '2026-10-29',
    amount: 500,
  })
  expect(contribution.journal?.lines).toContainEqual({
    account: 'Owner equity',
    debit: 0,
    credit: 500,
  })
  expect(w.expenses.length).toBe(before)
  apply(w, 'financeEntry', {
    kind: 'bill',
    name: 'Market rental',
    date: '2026-10-29',
    amount: 100,
    category: 'Market/vendor fees',
  })
  const bill = w.finance_transactions.find((t) => t.kind === 'bill')!
  apply(w, 'financeEntry', {
    kind: 'vendorPayment',
    name: 'Market',
    billId: bill.id,
    date: '2026-10-29',
    amount: 40,
  })
  expect(w.finance_transactions.find((t) => t.id === bill.id)?.paid).toBe(40)
  expect(w.expenses.length).toBe(before + 1)
  const payment = w.finance_transactions.find(
    (t) => t.kind === 'vendorPayment',
  )!
  const reversal = apply(w, 'financeReverse', {
    id: payment.id,
    date: '2026-10-30',
    reason: 'Wrong payment method',
  })
  expect(reversal.journal?.lines).toContainEqual({
    account: 'Accounts payable',
    debit: 0,
    credit: 40,
  })
  expect(w.finance_transactions.find((t) => t.id === bill.id)?.paid).toBe(0)
  expect(
    w.finance_transactions.find((t) => t.id === payment.id)?.reversedBy,
  ).toBeTruthy()
})
it('splits an expense into categories and reconciles it without rewriting its financial entry', () => {
  const w = setup(),
    plan = apply(w, 'financeEntry', {
      kind: 'expense',
      name: 'Market invoice',
      date: '2026-10-29',
      amount: 25,
      category: 'Market/vendor fees',
      splits: [
        { category: 'Market/vendor fees', amount: 20 },
        { category: 'Supplies expense', amount: 5 },
      ],
    })
  const tx = w.finance_transactions.at(-1)!,
    before = structuredClone(tx),
    journal = structuredClone(plan.journal)
  expect(plan.journal?.lines).toContainEqual({
    account: 'Supplies expense',
    debit: 5,
    credit: 0,
  })
  expect(() =>
    planFinance(
      w,
      'financeReconcile',
      { id: tx.id, amount: 24, reference: 'Bank statement' },
      id,
    ),
  ).toThrow('does not match')
  apply(w, 'financeReconcile', {
    id: tx.id,
    amount: 25,
    reference: 'Bank statement October 29',
    date: '2026-10-29',
  })
  expect(w.finance_transactions.at(-1)).toEqual(before)
  expect(w.journals.at(-1)).toEqual(journal)
  expect(w.finance_reviews.at(-1)).toMatchObject({
    transactionId: tx.id,
    amount: 25,
    status: 'reviewed',
  })
})
it('reverses a receipt with stock movements and a separate journal, preserving its original file and posting', () => {
  const w = setup()
  w.ingredients = [
    { id: 'bag', name: 'Bread bags', quantity: 100, cost: 0.08, unit: 'each' },
  ]
  w.receipt_extractions = [
    {
      id: 'receipt',
      name: 'Original',
      fileHash: 'file',
      status: 'draft',
      history: [],
    },
  ]
  apply(w, 'receiptPost', {
    id: 'receipt',
    vendor: 'Supplier',
    date: '2026-10-29',
    subtotal: 8,
    tax: 0,
    total: 8,
    lines: [
      {
        description: 'Bags',
        itemId: 'bag',
        quantity: 100,
        unit: 'each',
        amount: 8,
        decision: 'inventory',
      },
    ],
  })
  const originalReceipt = structuredClone(w.receipt_extractions[0]),
    tx = w.finance_transactions.at(-1)!
  const reverse = apply(w, 'financeReverse', {
    id: tx.id,
    date: '2026-10-30',
    reason: 'Duplicate business purchase',
  })
  expect(w.ingredients[0].quantity).toBe(100)
  expect(w.receipt_extractions[0]).toEqual(originalReceipt)
  expect(reverse.journal?.lines).toEqual([
    { account: 'Cash', debit: 8, credit: 0 },
    { account: 'Inventory asset', debit: 0, credit: 8 },
  ])
  expect(w.ledger.at(-1)).toMatchObject({
    type: 'receipt_reversal',
    quantity: -100,
    receiptId: 'receipt',
  })
})
it('saves missing receipt amounts as blanks and rejects confirmation until amounts are entered', () => {
  const w = setup()
  w.receipt_extractions = [
    {
      id: 'missing',
      name: 'Receipt',
      status: 'draft',
      vendor: 'Shop',
      date: '2026-10-29',
      subtotal: null,
      tax: null,
      total: null,
      lines: [
        {
          description: 'Supplies',
          amount: null,
          decision: 'expense',
          category: 'Supplies expense',
        },
      ],
    },
  ]
  apply(w, 'receiptDraft', { id: 'missing', total: '' })
  expect(w.receipt_extractions[0].total).toBeNull()
  expect(() => apply(w, 'receiptPost', { id: 'missing' })).toThrow(
    'unknown amounts',
  )
  expect(w.finance_transactions || []).toHaveLength(0)
})

it('records balanced account transfers, rejects invalid accounts, and ignores repeated requests', () => {
  const w = setup(),
    data = {
      kind: 'transfer',
      sourceAccount: 'Cash',
      destinationAccount: 'Bank account',
      date: '2026-10-29',
      amount: 125.45,
      requestId: 'transfer-request-1',
    }
  expect(() =>
    apply(w, 'financeEntry', { ...data, destinationAccount: 'Cash' }),
  ).toThrow('different')
  expect(() =>
    apply(w, 'financeEntry', { ...data, sourceAccount: 'Inventory asset' }),
  ).toThrow('business cash')
  const result = apply(w, 'financeEntry', data)
  expect(result.journal?.lines).toEqual([
    { account: 'Bank account', debit: 125.45, credit: 0 },
    { account: 'Cash', debit: 0, credit: 125.45 },
  ])
  const count = w.finance_transactions.length,
    journals = w.journals.length
  apply(w, 'financeEntry', data)
  expect(w.finance_transactions).toHaveLength(count)
  expect(w.journals).toHaveLength(journals)
  expect(w.expenses || []).not.toContainEqual(
    expect.objectContaining({ transactionId: result.writes[0].record.id }),
  )
})

it('allocates consignor payment records only to selected unpaid sales and ignores retries', () => {
  const w = setup()
  apply(w, 'consignmentSale', {
    itemId: 'hat',
    quantity: 1,
    gross: 30,
    date: '2026-10-29',
    commissionRate: 10,
  })
  apply(w, 'consignmentSale', {
    itemId: 'hat',
    quantity: 1,
    gross: 30,
    date: '2026-10-29',
    commissionRate: 10,
  })
  const selected = w.consignment_sales[1].id
  expect(() =>
    apply(w, 'consignmentPayout', {
      consignorId: 'maker',
      date: '2026-10-29',
      amount: 40,
      method: 'Bank transfer',
      saleIds: [selected],
    }),
  ).toThrow('selected unpaid sales')
  const data = {
    consignorId: 'maker',
    date: '2026-10-29',
    amount: 27,
    method: 'Bank transfer',
    saleIds: [selected],
    requestId: 'selected-payout-1',
  }
  apply(w, 'consignmentPayout', data)
  expect(w.consignment_sales[0].paid).toBe(0)
  expect(w.consignment_sales[1].paid).toBe(27)
  expect(w.consignment_payouts[0].allocations.map((s: any) => s.id)).toEqual([
    selected,
  ])
  apply(w, 'consignmentPayout', data)
  expect(w.consignment_payouts).toHaveLength(1)
})

it('keeps printed package counts separate from confirmed stock and supports explained cent rounding', () => {
  const w = demoData()
  const oldQuantity = w.ingredients[0].quantity
  w.receipt_extractions = [
    {
      id: 'reviewed',
      name: 'Mill',
      vendor: 'Mill',
      date: '2026-11-02',
      status: 'draft',
      subtotal: 10,
      tax: 1,
      total: 11.01,
      currency: 'USD',
      lines: [
        {
          description: '2 bags of flour',
          printedQuantity: 2,
          printedUnit: 'bags',
          amount: 10,
          quantity: null,
          unit: w.ingredients[0].unit,
          decision: 'inventory',
          itemId: w.ingredients[0].id,
        },
      ],
    },
  ]
  expect(() =>
    apply(w, 'receiptPost', {
      id: 'reviewed',
      adjustment: 0.01,
      adjustmentReason: 'Printed rounding',
    }),
  ).toThrow('Confirm the actual')
  expect(w.ingredients[0].quantity).toBe(oldQuantity)
  let result = apply(w, 'receiptDraft', {
    id: 'reviewed',
    adjustment: 0.01,
    adjustmentReason: 'Printed rounding',
    lines: [
      {
        ...w.receipt_extractions[0].lines[0],
        quantity: 5,
        stockQuantityConfirmed: true,
      },
    ],
  })
  expect(result.writes.some((r) => r.table === 'ledger')).toBe(false)
  result = apply(w, 'receiptPost', { id: 'reviewed' })
  expect(w.ingredients[0].quantity).toBe(oldQuantity + 5)
  expect(
    result.journal!.lines.reduce(
      (sum: number, l: { debit: number; credit: number }) =>
        sum + l.debit - l.credit,
      0,
    ),
  ).toBeCloseTo(0)
  expect(w.receipt_extractions[0].postedLines[0].printedQuantity).toBe(2)
  expect(() => apply(w, 'receiptPost', { id: 'reviewed' })).toThrow('closed')
})
