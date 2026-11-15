import { cleanup, render, screen } from '@testing-library/react'
import { LinkedPurchaseRecords } from './linked-purchase-records'
import { expect, it } from 'vitest'
import { demoData } from '@/lib/demo'
import { purchaseTransactions } from './linked-purchase-records'
it('follows only explicit references and retains every linked transaction', () => {
  const w = demoData()
  w.finance_transactions = [
    { id: 'direct', name: 'Supplier', amount: 20 },
    {
      id: 'receipt-payment',
      name: 'Payment',
      receiptId: 'receipt',
      amount: 15,
    },
    {
      id: 'receipt-correction',
      name: 'Correction',
      receiptId: 'receipt',
      amount: -5,
    },
    { id: 'lookalike', name: 'Supplier', amount: 20 },
  ]
  expect(
    purchaseTransactions(w, {
      id: 'purchase',
      name: 'Stock',
      transactionId: 'direct',
      receiptId: 'receipt',
    }).map((t) => t.id),
  ).toEqual(['direct', 'receipt-payment', 'receipt-correction'])
  expect(
    purchaseTransactions(w, { id: 'unlinked', name: 'Supplier', amount: 20 }),
  ).toEqual([])
})

it('shows a safe explanation for unavailable or unauthorized linked records', () => {
  const w = demoData()
  w.finance_transactions = [
    { id: 'private-entry', name: 'Private financial details', amount: 40 },
  ]
  history.replaceState(
    null,
    '',
    '#Purchasing/Purchases%20%26%20Receipts?linked=finance&record=private-entry',
  )
  render(
    <LinkedPurchaseRecords
      workspace={w}
      role="Production Staff"
      onReceipt={() => {}}
    />,
  )
  expect(
    screen.getByText(
      'This record is unavailable or you do not have access to it.',
    ),
  ).toBeTruthy()
  expect(screen.queryByText('Private financial details')).toBeNull()
  cleanup()
  history.replaceState(
    null,
    '',
    '#Finance/Register?linked=finance&record=other-business-entry',
  )
  render(
    <LinkedPurchaseRecords workspace={w} role="Owner" onReceipt={() => {}} />,
  )
  expect(
    screen.getByText(
      'This record is unavailable or you do not have access to it.',
    ),
  ).toBeTruthy()
  expect(screen.queryByText('other-business-entry')).toBeNull()
  cleanup()
  history.replaceState(null, '', '/')
})

it('opens an operating expense receipt without inventing a purchase', () => {
  const w = demoData()
  w.ledger = []
  w.finance_transactions = [
    {
      id: 'expense-only',
      name: 'Market stall rent',
      kind: 'expense',
      amount: 35,
      receiptId: 'expense-proof',
    },
  ]
  w.receipt_extractions = [{ id: 'expense-proof', name: 'Market rent receipt' }]
  history.replaceState(
    null,
    '',
    '#Finance/Register?linked=finance&record=expense-only',
  )
  render(
    <LinkedPurchaseRecords workspace={w} role="Owner" onReceipt={() => {}} />,
  )
  expect(
    screen.getByRole('button', { name: 'View receipt' }),
  ).toBeTruthy()
  expect(screen.queryByRole('button', { name: /View purchase/ })).toBeNull()
  expect(w.ledger).toEqual([])
  cleanup()
  history.replaceState(null, '', '/')
})
