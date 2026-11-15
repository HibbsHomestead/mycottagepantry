import { useEffect, useState } from 'react'
import { money, type Item, type Workspace } from '@/lib/domain'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'

/** Only explicit references from the business-scoped workspace resolve here. */
export function purchaseTransactions(w: Workspace, purchase: Item) {
  return (w.finance_transactions || []).filter(
    (t) =>
      t.id === purchase.transactionId ||
      t.id === purchase.matchedTransactionId ||
      (purchase.receiptId && t.receiptId === purchase.receiptId),
  )
}
export function RecordLink({
  kind,
  id,
  children,
  onOpen,
}: {
  kind: 'purchase' | 'finance'
  onOpen?: () => void
  id: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="book-link"
      onClick={() => {
        onOpen?.()
        const url = new URL(location.href)
        const [path, search] = url.hash.split('?')
        const params = new URLSearchParams(search)
        params.set('linked', kind)
        params.set('record', id)
        history.pushState(
          {
            linkedRecord: true,
            linkedDepth: (history.state?.linkedDepth || 0) + 1,
          },
          '',
          path + '?' + params,
        )
        window.dispatchEvent(new Event('linkedrecord'))
      }}
    >
      {children}
    </button>
  )
}
export function LinkedPurchaseRecords({
  workspace: w,
  role,
  onReceipt,
}: {
  workspace: Workspace
  role: string
  onReceipt: (id: string) => void
}) {
  const [target, setTarget] = useState(new URLSearchParams())
  useEffect(() => {
    const update = () =>
      setTarget(new URLSearchParams(location.hash.split('?')[1]))
    update()
    for (const event of ['hashchange', 'popstate', 'linkedrecord'])
      window.addEventListener(event, update)
    return () => {
      for (const event of ['hashchange', 'popstate', 'linkedrecord'])
        window.removeEventListener(event, update)
    }
  }, [])
  const kind = target.get('linked'),
    id = target.get('record')
  const allowed = ['Owner', 'Manager', 'Read-only Accountant'].includes(role)
  const record = allowed
    ? (kind === 'purchase'
        ? w.ledger.filter((l) => l.type === 'purchase_receipt')
        : w.finance_transactions || []
      ).find((r) => r.id === id)
    : undefined
  const close = () => {
    if (history.state?.linkedRecord)
      history.go(-(history.state.linkedDepth || 1))
    else {
      const [path, search] = location.hash.split('?')
      const params = new URLSearchParams(search)
      params.delete('linked')
      params.delete('record')
      history.replaceState(null, '', path + (params.size ? '?' + params : ''))
      window.dispatchEvent(new Event('linkedrecord'))
    }
  }
  const purchases =
    record && kind === 'finance'
      ? w.ledger.filter(
          (l) =>
            l.type === 'purchase_receipt' &&
            (l.transactionId === record.id ||
              (record.receiptId && l.receiptId === record.receiptId)),
        )
      : []
  const receipts = record
    ? (w.receipt_extractions || []).filter(
        (r) =>
          r.id === record.receiptId ||
          r.transactionId === record.id ||
          r.matchedTransactionId === record.id,
      )
    : []
  return (
    <Dialog
      open={!!kind}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind === 'purchase' ? 'Purchase details' : 'Finance entry'}
          </DialogTitle>
          <DialogDescription>
            Linked records from this business. Viewing does not post money or
            receive stock.
          </DialogDescription>
        </DialogHeader>
        {!record ? (
          <p>This record is unavailable or you do not have access to it.</p>
        ) : (
          <>
            <h3>{record.name || record.vendor}</h3>
            <p>
              {record.date} · {money(record.amount)}
            </p>
            {kind === 'purchase' ? (
              <>
                <p>
                  Received: {record.quantity} {record.unit} ·{' '}
                  {record.receivedDate || record.date}
                </p>
                <p>Supplier: {record.vendor || 'Not recorded'}</p>
                <p>
                  Payment:{' '}
                  {purchaseTransactions(w, record).some((t) =>
                    ['receipt', 'vendorPayment'].includes(t.kind),
                  )
                    ? 'See linked financial activity'
                    : 'Not established by receiving'}
                </p>
                {purchaseTransactions(w, record).length ? (
                  <>
                    <p>
                      {purchaseTransactions(w, record).length} linked financial
                      entries
                    </p>
                    {purchaseTransactions(w, record).map((t) => (
                      <p key={t.id}>
                        <RecordLink kind="finance" id={t.id}>
                          View in Finance · {t.date} · {money(t.amount)}
                        </RecordLink>
                      </p>
                    ))}
                  </>
                ) : (
                  <p>No financial entry linked</p>
                )}
              </>
            ) : (
              <>
                <p>
                  {(
                    {
                      receipt: 'Receipt purchase',
                      expense: 'Expense',
                      reversal: 'Correction',
                      vendorPayment: 'Vendor payment',
                      bill: 'Vendor bill',
                    } as Record<string, string>
                  )[record.kind] || 'Financial activity'}{' '}
                  ·{' '}
                  {record.account ||
                    record.fromAccount ||
                    'Account not recorded'}
                </p>
                <p>
                  Status:{' '}
                  {record.status ||
                    (record.reversedBy ? 'Corrected' : 'Recorded')}
                </p>
                {purchases.length > 1 && (
                  <p>{purchases.length} linked purchase items</p>
                )}
                {purchases.map((p) => (
                  <p key={p.id}>
                    <RecordLink kind="purchase" id={p.id}>
                      View purchase · {p.name}
                    </RecordLink>
                  </p>
                ))}
              </>
            )}
            {receipts.length > 1 && <p>{receipts.length} linked receipts</p>}
            {receipts.map((receipt) => (
              <button
                key={receipt.id}
                className="btn secondary"
                onClick={() => {
                  const [path, search] = location.hash.split('?')
                  const params = new URLSearchParams(search)
                  params.delete('linked')
                  params.delete('record')
                  history.replaceState(
                    null,
                    '',
                    path + (params.size ? '?' + params : ''),
                  )
                  window.dispatchEvent(new Event('linkedrecord'))
                  onReceipt(receipt.id)
                }}
              >
                View receipt
                {receipts.length > 1
                  ? ` · ${receipt.vendor || receipt.name} · ${receipt.date || 'Date not recorded'}`
                  : ''}
              </button>
            ))}
          </>
        )}
        <button className="btn secondary" onClick={close}>
          Back to{' '}
          {location.hash.startsWith('#Purchasing') ? 'Purchasing' : 'Finance'}
        </button>
      </DialogContent>
    </Dialog>
  )
}
