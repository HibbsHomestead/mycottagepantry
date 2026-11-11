import { expect, it } from 'vitest'
import {
  receiptTotals,
  receiptLineCents,
  receiptAllocations,
} from './receipt-totals'
import { planFinance } from './finance'
import { demoData } from './demo'
const direct = (amount: unknown, decision = 'expense') => ({
  description: 'Supplies',
  amountMode: 'direct',
  enteredAmount: amount,
  decision,
  category: 'Supplies expense',
})
const receipt = (patch: Record<string, any> = {}) => ({
  id: 'r',
  name: 'Mill',
  status: 'draft',
  vendor: 'Mill',
  date: '2026-11-10',
  receivedDate: '2026-11-10',
  arithmeticVersion: 2,
  taxTreatment: 'exclusive',
  tax: 0,
  lines: [direct(10)],
  ...patch,
})
it('totals direct amounts without requiring or multiplying stock quantity', () => {
  expect(
    receiptLineCents({ ...direct('12.35'), quantity: 9, printedQuantity: 3 }),
  ).toBe(1235)
  expect(receiptTotals(receipt()).total).toBe(10)
  expect(receiptTotals(receipt({ lines: [direct(null)] })).total).toBeNull()
})
it('rounds decimal products per line, then updates quantity, discounts and removal without float drift', () => {
  const a = {
    description: 'Bags',
    amountMode: 'quantity',
    printedQuantity: '3',
    unitPrice: '0.335',
    lineDiscount: '0.01',
  }
  expect(receiptLineCents(a)).toBe(100)
  expect(receiptTotals(receipt({ lines: [a, direct('.1')] })).total).toBeNull() // malformed money is not zero
  expect(receiptTotals(receipt({ lines: [a, direct('0.10')] })).total).toBe(1.1)
  expect(receiptLineCents({ ...a, printedQuantity: '4' })).toBe(133)
  expect(receiptLineCents({ ...a, unitPrice: '1.25' })).toBe(374)
  expect(receiptTotals(receipt({ lines: [a] })).total).toBe(1)
  expect(receiptLineCents({ ...a, lineDiscount: 2 })).toBeNull()
})
it('applies only additional discounts, taxes and shipping once; keeps printed reconciliation separate', () => {
  const r = receipt({
    lines: [{ amount: 20, discounts: 3 }],
    discounts: 3,
    receiptDiscount: 2,
    tax: 1.8,
    otherCharges: 4,
    printedTotal: 23.8,
  })
  expect(receiptTotals(r)).toMatchObject({
    subtotal: 20,
    total: 23.8,
    difference: 0,
  })
  expect(
    receiptTotals({ ...r, taxTreatment: 'inclusive', printedTotal: 22 }),
  ).toMatchObject({ total: 22, difference: 0 })
  expect(receiptTotals({ ...r, printedTotal: 25 })).toMatchObject({
    total: 23.8,
    difference: -1.2,
  })
  expect(receiptTotals({ ...r, tax: null }).total).toBeNull()
  expect(receiptTotals({ ...r, taxTreatment: '' }).total).toBeNull()
})
it('keeps personal amounts in receipt arithmetic while allocating only business lines to expense', () => {
  const r = receipt({
    tax: 1,
    receiptDiscount: 2,
    otherCharges: 1,
    lines: [direct(6), direct(4, 'personal')],
  })
  const allocated = receiptAllocations(r)
  expect(allocated.map((l) => l.postedAmount)).toEqual([6, 4])
  expect(allocated.reduce((n, l) => n + l.postedAmount, 0)).toBe(
    receiptTotals(r).total,
  )
})
it('validates server totals independently, saves incomplete drafts without effects, and posts/retries once', () => {
  const w = demoData()
  w.receipt_extractions = [receipt()]
  let n = 0
  const id = () => `fixture-${++n}`
  const draft = planFinance(
    w,
    'receiptDraft',
    receipt({ tax: null, subtotal: 999, total: 999 }),
    id,
  )
  expect(draft.journal).toBeUndefined()
  expect(draft.writes).toHaveLength(1)
  expect(draft.writes[0].record.total).toBeNull()
  expect(() =>
    planFinance(w, 'receiptPost', receipt({ printedTotal: 11 }), id),
  ).toThrow('differs')
  expect(() =>
    planFinance(w, 'receiptPost', receipt({ adjustment: 0.01 }), id),
  ).toThrow('explanation')
  const result = planFinance(
    w,
    'receiptPost',
    receipt({ subtotal: 999, total: 999 }),
    id,
  )
  expect(result.journal?.lines).toContainEqual({
    account: 'Cash',
    debit: 0,
    credit: 10,
  })
  const saved = result.writes.find(
    (x) => x.table === 'receipt_extractions',
  )!.record
  w.receipt_extractions = [saved]
  expect(planFinance(w, 'receiptPost', { id: 'r' }, id).writes).toHaveLength(0)
  expect(saved.printedTotal).toBeUndefined()
})
it('requires explicit existing inventory selection and confirmed stock quantities, refusing guessed conversions', () => {
  const w = demoData()
  w.receipt_extractions = [receipt()]
  const inventory = {
    ...direct(10),
    decision: 'inventory',
    createNew: true,
    usedAs: 'ingredient',
    quantity: 1,
    unit: 'g',
  }
  expect(() =>
    planFinance(w, 'receiptPost', receipt({ lines: [inventory] }), () =>
      crypto.randomUUID(),
    ),
  ).toThrow('Create and approve')
  const existing = {
    ...inventory,
    createNew: false,
    itemId: w.ingredients[0].id,
  }
  expect(() =>
    planFinance(w, 'receiptPost', receipt({ lines: [existing] }), () =>
      crypto.randomUUID(),
    ),
  ).toThrow('Confirm the actual')
  expect(() =>
    planFinance(
      w,
      'receiptPost',
      receipt({
        lines: [{ ...existing, stockQuantityConfirmed: true, unit: 'unknown' }],
      }),
      () => crypto.randomUUID(),
    ),
  ).toThrow()
})
it('allocates heavily discounted small lines without negative remainders', () => {
  const allocated = receiptAllocations(
    receipt({
      lines: [direct(0.01), direct(0.01), direct(0.01), direct(0.01)],
      receiptDiscount: 0.02,
    }),
  )
  expect(allocated.map((l) => l.postedAmount)).toEqual([0.01, 0, 0.01, 0])
  expect(allocated.every((l) => l.postedAmount >= 0)).toBe(true)
})
it('posts included tax once and applies only explained rounding within the existing five-cent policy', () => {
  const w = demoData()
  w.receipt_extractions = [receipt()]
  const inclusive = planFinance(
    w,
    'receiptPost',
    receipt({ taxTreatment: 'inclusive', tax: 2, printedTotal: 10 }),
    () => crypto.randomUUID(),
  )
  expect(inclusive.journal?.lines).toContainEqual({
    account: 'Cash',
    debit: 0,
    credit: 10,
  })
  expect(
    inclusive.writes.find((x) => x.table === 'expenses')?.record.amount,
  ).toBe(10)
  const rounded = planFinance(
    w,
    'receiptPost',
    receipt({
      printedTotal: 10.01,
      adjustment: 0.01,
      adjustmentReason: 'Printed cent rounding',
    }),
    () => crypto.randomUUID(),
  )
  expect(rounded.journal?.lines).toContainEqual({
    account: 'Cash',
    debit: 0,
    credit: 10.01,
  })
})
it('warns about merchant/date/amount duplicates and requires explicit review while preventing a posted file from being posted again', () => {
  const w = demoData()
  w.receipt_extractions = [
    receipt(),
    receipt({ id: 'posted', status: 'posted', total: 10 }),
  ]
  expect(() =>
    planFinance(w, 'receiptPost', receipt(), () => crypto.randomUUID()),
  ).toThrow('possible duplicate')
  expect(
    planFinance(w, 'receiptPost', receipt({ duplicateReviewed: true }), () =>
      crypto.randomUUID(),
    ).journal,
  ).toBeDefined()
  w.receipt_extractions[0].fileHash = 'same-file'
  w.receipt_extractions[1].fileHash = 'same-file'
  expect(() =>
    planFinance(w, 'receiptPost', receipt({ duplicateReviewed: true }), () =>
      crypto.randomUUID(),
    ),
  ).toThrow('already posted')
})
