import { PageOverview, PageActions } from './application-page'
import { useWorkspaceFilter } from '@/lib/use-workspace-filter'
import { RecordLink } from './linked-purchase-records'
import { customerMessage } from '@/lib/customer-message'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Item, Workspace } from '@/lib/domain'
import { csv } from '@/lib/domain'
import { ovenToday } from '@/lib/oven-dates'
import { parseCsv } from '@/lib/reports'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import './checkbook.css'
const money = (c: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    (c || 0) / 100,
  )
const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="field">
    {label}
    {children}
  </label>
)
const download = (name: string, rows: Item[]) => {
  const url = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name + '.csv'
  a.click()
  URL.revokeObjectURL(url)
}
export function Checkbook({
  workspace: w,
  onWorkspace,
  ready,
  role,
  onReceipts,
  onViewReceipt,
  onLegacySale,
  onUploadReceipt,
  onRecordTransaction,
  receiptRevision = 0,
  initialTab = 'Overview',
}: {
  workspace: Workspace
  onWorkspace: (w: Workspace) => void
  ready: boolean
  role: string
  onReceipts: () => void
  onViewReceipt?: (id: string) => void
  onLegacySale: () => void
  onUploadReceipt?: () => void
  onRecordTransaction?: () => void
  receiptRevision?: number
  onSectionChange?: (tab: string) => void
  initialTab?: string
}) {
  const today = ovenToday(w.settings?.[0]),
    [tab] = useState(initialTab),
    [modal, setModal] = useState(''),
    [d, setD] = useState<Partial<Item>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [query, setQuery] = useWorkspaceFilter('bookSearch'),
    [receiptPhoto, setReceiptPhoto] = useState<File | null>(null),
    [account, setAccount] = useWorkspaceFilter('bookAccount'),
    [category, setCategory] = useWorkspaceFilter('bookCategory'),
    [cleared, setCleared] = useWorkspaceFilter('bookCleared'),
    [from, setFrom] = useWorkspaceFilter('bookFrom', today.slice(0, 7) + '-01'),
    [to, setTo] = useWorkspaceFilter('bookTo', today),
    [csvRows, setCsvRows] = useState<Record<string, string>[]>([]),
    [mapping, setMapping] = useState({ date: '', name: '', amount: '' }),
    [selected, setSelected] = useState<string[]>([])
  const detailReceipts = (w.receipt_extractions || []).filter(
    (r) =>
      r.id === d.receiptId ||
      (d.transactionId &&
        (r.transactionId === d.transactionId ||
          r.matchedTransactionId === d.transactionId)),
  )
  const openedSubscriptionPayment = useRef(false)
  const refreshAfterReceipt = useEffectEvent(() => {
    void refresh()
  })
  useEffect(() => {
    if (receiptRevision) refreshAfterReceipt()
  }, [receiptRevision])
  const b = w.bookkeeping?.[0],
    canWrite = ready && ['Owner', 'Manager'].includes(role)
  const open = (kind: string, values: Partial<Item> = {}) => {
    setError('')
    setReceiptPhoto(null)
    setSelected(
      kind === 'reconcile'
        ? (b?.rows || [])
            .filter(
              (r: Item) =>
                r.account === values.account &&
                r.cleared &&
                !r.reconciled &&
                r.date <= (values.date || today),
            )
            .map((r: Item) => r.id)
        : [],
    )
    setD({
      date: today,
      account: b?.accounts?.[0]?.name || 'Cash',
      category:
        kind === 'income'
          ? 'Sales'
          : b?.categories?.find((c: Item) => c.type === 'expense')?.name,
      kind,
      requestId: crypto.randomUUID(),
      ...values,
    })
    setModal(kind)
  }
  async function save(action: string, values = d, keep = false) {
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (
        action === 'financeBookEntry' &&
        values.kind === 'expense' &&
        receiptPhoto
      ) {
        const form = new FormData()
        form.set('file', receiptPhoto)
        const uploaded = await fetch('/api/workspace?receiptUpload=1', {
          method: 'POST',
          body: form,
        })
        const result = await uploaded.json()
        if (!uploaded.ok)
          throw new Error(
            result.error || 'Unable to save the receipt. Please try again.',
          )
        const draftResponse = await fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'receiptDraft',
            data: {
              id: result.receipt.id,
              vendor: values.name,
              date: values.date,
              total: values.amount,
              paymentAccount: values.account,
              notes: values.notes,
            },
          }),
        })
        if (!draftResponse.ok)
          throw new Error(
            'Receipt saved. Open Receipt inbox to finish reviewing its details.',
          )
        const response = await fetch(
          '/api/workspace?bookFrom=' + from + '&bookTo=' + to,
        )
        const body = await response.json()
        if (!response.ok)
          throw new Error(
            body.error ||
              'Receipt saved. Reopen Receipt inbox to continue review.',
          )
        onWorkspace(body.workspace)
        setReceiptPhoto(null)
        setModal('')
        onReceipts()
        return
      }
      const response = await fetch(
        '/api/workspace?bookFrom=' + from + '&bookTo=' + to,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, data: values }),
        },
      )
      const body = await response.json()
      if (!response.ok)
        throw new Error(body.error || 'Unable to save. Please try again.')
      onWorkspace(body.workspace)
      if (!keep) setModal('')
      setMessage('Saved. Your balances are up to date.')
    } catch (e) {
      setError(
        e instanceof Error
          ? customerMessage(e)
          : 'Unable to save. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function refresh(start = from, end = to) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(
        '/api/workspace?bookFrom=' + start + '&bookTo=' + end,
      )
      const body = await response.json()
      if (!response.ok)
        throw new Error(body.error || 'Unable to load summaries.')
      onWorkspace(body.workspace)
    } catch (e) {
      setError(e instanceof Error ? customerMessage(e) : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }
  const openLinkedSubscription = useEffectEvent((row: Item) => {
    setFrom(row.date)
    setTo(row.date)
    open('detail', row)
  })
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('subscriptionPayment')
    if (!id || openedSubscriptionPayment.current || !ready) return
    const row = b?.rows?.find((r: Item) => r.subscriptionPaymentId === id)
    if (row) {
      openedSubscriptionPayment.current = true
      openLinkedSubscription(row)
    }
  }, [b, ready])
  const input = (key: string, label: string, type = 'text') => (
    <Field label={label}>
      <input
        type={type}
        step={type === 'number' ? '0.01' : undefined}
        value={d[key] ?? ''}
        required
        onChange={(e) => setD({ ...d, [key]: e.target.value })}
      />
    </Field>
  )
  const chooseAccount = (key = 'account', label = 'Account') => (
    <Field label={label}>
      <select
        value={d[key] || ''}
        onChange={(e) => setD({ ...d, [key]: e.target.value })}
        required
      >
        <option value="">Choose account</option>
        {(b?.accounts || []).map((a: Item) => (
          <option key={a.name}>{a.name}</option>
        ))}
      </select>
    </Field>
  )
  const cats = (kind: string) =>
    b?.categories?.filter(
      (c: Item) =>
        c.type ===
        (['income', 'invoice'].includes(kind) ? 'income' : 'expense'),
    ) || []
  const chooseCategory = (key = 'category') => (
    <Field label="Category">
      <select
        value={d[key] || ''}
        onChange={(e) => setD({ ...d, [key]: e.target.value })}
      >
        {cats(d.kind).map((c: Item) => (
          <option key={c.name}>{c.name}</option>
        ))}
      </select>
    </Field>
  )
  const rows = (b?.rows || []).filter(
    (r: Item) =>
      (!account || r.account === account) &&
      (!category || r.category.includes(category)) &&
      (!cleared || (cleared === 'yes') === r.cleared) &&
      r.date >= from &&
      r.date <= to &&
      (!query ||
        [r.name, r.category, r.account, r.notes]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase())),
  )
  const obligations = (b?.obligations || []).filter(
    (r: Item) => r.kind === (tab === 'Bills' ? 'bill' : 'invoice'),
  )
  const transactionKinds = [
    'income',
    'expense',
    'contribution',
    'draw',
    'transfer',
    'bill',
    'invoice',
    'payment',
    'market',
  ]
  const statementRows = (b?.rows || []).filter(
    (r: Item) => r.account === d.account && r.date <= d.date,
  )
  const statementTotal = statementRows
    .filter((r: Item) => r.reconciled || selected.includes(r.id))
    .reduce((n: number, r: Item) => n + r.moneyIn - r.moneyOut, 0)
  const reportRows = [
    { id: 'income', name: 'Income', amount: b?.income || 0 },
    { id: 'expense', name: 'Costs and spending', amount: -(b?.expenses || 0) },
    { id: 'profit', name: 'Net profit', amount: b?.profit || 0 },
  ]
  if (!['Owner', 'Manager', 'Read-only Accountant'].includes(role))
    return (
      <p>
        Bookkeeping is available to your business owner, manager, and
        accountant.
      </p>
    )
  return (
    <section className="checkbook">
      <div className="book-main">
        <header className="book-header">
          <div>
            <h2>{tab}</h2>
          </div>
        </header>
        <PageActions>
          {' '}
          <div className="button-row book-actions" aria-label="Finance actions">
            {onUploadReceipt && (
              <button disabled={!canWrite} onClick={onUploadReceipt}>
                Upload receipt
              </button>
            )}
            {onRecordTransaction && (
              <button disabled={!canWrite} onClick={onRecordTransaction}>
                Record a transaction
              </button>
            )}
            <button disabled={!canWrite} onClick={() => open('income')}>
              + Money in
            </button>
            <button disabled={!canWrite} onClick={() => open('expense')}>
              + Money out
            </button>
            <button
              className="secondary"
              disabled={!canWrite}
              onClick={() => open('transfer')}
            >
              Transfer
            </button>
          </div>
        </PageActions>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {!b && (
          <p>Connect your business to load the saved register and balances.</p>
        )}
        {b && (
          <>
            <form
              className="book-filters"
              onSubmit={(e) => {
                e.preventDefault()
                refresh()
              }}
            >
              <Field label="From">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label="Through">
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
              <button className="secondary" disabled={busy}>
                Update period
              </button>
              {['This month', 'This quarter', 'This year'].map((name, i) => (
                <button
                  type="button"
                  className="secondary"
                  key={name}
                  onClick={() => {
                    const month = Number(today.slice(5, 7))
                    const start =
                      i === 0
                        ? today.slice(0, 7) + '-01'
                        : i === 1
                          ? today.slice(0, 4) +
                            '-' +
                            String(
                              Math.floor((month - 1) / 3) * 3 + 1,
                            ).padStart(2, '0') +
                            '-01'
                          : today.slice(0, 4) + '-01-01'
                    setFrom(start)
                    setTo(today)
                    refresh(start, today)
                  }}
                >
                  {name}
                </button>
              ))}
            </form>
            {tab === 'Overview' && (
              <>
                <PageOverview>
                  <div className="book-stats">
                    {[
                      ['Money in this month', b.monthMoneyIn],
                      ['Money out this month', b.monthMoneyOut],
                      ['Net profit this month', b.monthProfit],
                      ['Net profit year to date', b.yearProfit],
                      ['Receipts needing review', b.receiptsNeedingReview],
                    ].map(([label, value]) => (
                      <article key={label as string}>
                        <span>{label}</span>
                        <strong>
                          {label === 'Receipts needing review'
                            ? value
                            : money(value as number)}
                        </strong>
                        <small>
                          {label === 'Net profit year to date'
                            ? today.slice(0, 4) + '-01-01'
                            : today.slice(0, 7) + '-01'}{' '}
                          – {today}
                        </small>
                      </article>
                    ))}
                  </div>
                </PageOverview>
                <div className="book-panel">
                  <h3>Your accounts</h3>
                  <div className="book-stats">
                    {b.accounts.map((a: Item) => (
                      <article key={a.name}>
                        <span>{a.name}</span>
                        <strong>{money(a.balance)}</strong>
                      </article>
                    ))}
                  </div>
                </div>
                {(b.settings.bills || b.settings.invoices) && (
                  <div className="book-panel">
                    <h3>Coming due</h3>
                    {b.obligations
                      .filter(
                        (o: Item) =>
                          o.open > 0 &&
                          o.dueDate <=
                            new Date(Date.parse(today) + 7 * 86400000)
                              .toISOString()
                              .slice(0, 10),
                      )
                      .map((o: Item) => (
                        <p key={o.id}>
                          {o.name} · {o.dueDate || o.date} · {money(o.open)}
                        </p>
                      ))}
                  </div>
                )}
                <div className="book-panel">
                  <h3>Keep everything connected</h3>
                  <p>
                    Confirmed receipt purchases and recorded product sales
                    appear here once. Inventory purchases become product costs
                    through your existing costing workflow.
                  </p>
                  <div className="button-row">
                    <button className="secondary" onClick={onReceipts}>
                      Review receipts ({b.receiptsNeedingReview})
                    </button>
                    <button
                      className="secondary"
                      disabled={!canWrite}
                      onClick={onLegacySale}
                    >
                      Record product sales
                    </button>
                    <button
                      className="secondary"
                      disabled={!canWrite}
                      onClick={() => open('market', { channel: 'Market' })}
                    >
                      Record market day sales
                    </button>
                  </div>
                  <p className="muted">
                    Merchant Stripe sales and automatic payout connectivity are
                    unavailable. Record verified sales and payouts manually;
                    subscription billing is separate.
                  </p>
                </div>
                {!!b.subscriptionReview?.length && (
                  <section className="book-panel">
                    <h3>
                      Subscription payments needing review (
                      {b.subscriptionReview.length})
                    </h3>
                    <p>
                      These drafts do not change balances.{' '}
                      <a href="/oven/billing">
                        Review in Billing &amp; Subscription
                      </a>
                      .
                    </p>
                  </section>
                )}
                {b.legacyReview.length > 0 && (
                  <div className="book-panel">
                    <h3>Older records need review ({b.legacyReview.length})</h3>
                    <p>
                      These records have no linked money movement. They are
                      preserved and excluded from this register until their
                      source is reviewed.
                    </p>
                    {b.legacyReview.slice(0, 10).map((r: Item) => (
                      <p key={r.id}>
                        {r.date} · {r.name}
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
            {(tab === 'Register' || tab === 'Overview') && (
              <div className="book-panel">
                <div className="book-heading">
                  <h3>
                    {tab === 'Overview'
                      ? 'Recent money activity'
                      : 'Your checkbook'}
                  </h3>
                  <div className="button-row">
                    <button
                      className="secondary"
                      disabled={!canWrite}
                      onClick={() => open('import')}
                    >
                      Import statement CSV
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        download(
                          'register',
                          rows.map((r: Item) => ({
                            id: r.id,
                            date: r.date,
                            name: r.name,
                            category: r.category,
                            account: r.account,
                            moneyIn: r.moneyIn / 100,
                            moneyOut: r.moneyOut / 100,
                            balance: r.balance / 100,
                            cleared: r.cleared,
                            source: r.source,
                          })),
                        )
                      }
                    >
                      Export CSV
                    </button>
                  </div>
                </div>
                <div className="book-filters">
                  <Field label="Search">
                    <input
                      value={query}
                      placeholder="Payee, customer or note"
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </Field>
                  <Field label="Account">
                    <select
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                    >
                      <option value="">All accounts</option>
                      {b.accounts.map((a: Item) => (
                        <option key={a.name}>{a.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Category">
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="">All categories</option>
                      {b.categories.map((c: Item) => (
                        <option key={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Cleared">
                    <select
                      value={cleared}
                      onChange={(e) => setCleared(e.target.value)}
                    >
                      <option value="">All</option>
                      <option value="yes">Cleared</option>
                      <option value="no">Uncleared</option>
                    </select>
                  </Field>
                </div>
                <p className="book-table-hint">
                  Scroll across the register to see balances, cleared status,
                  and receipts.
                </p>
                <div
                  className="book-table"
                  tabIndex={0}
                  aria-label="Register, scroll horizontally for all columns"
                >
                  <table>
                    <thead>
                      <tr>
                        {[
                          'Date',
                          'Payee / Customer',
                          'Category',
                          'Account',
                          'Money in',
                          'Money out',
                          'Running balance',
                          'Cleared',
                          'Receipt',
                        ].map((n) => (
                          <th key={n}>{n}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(tab === 'Overview' ? rows.slice(-10) : rows).map(
                        (r: Item) => (
                          <tr key={r.id}>
                            <td>{r.date}</td>
                            <td>
                              <button
                                className="book-link"
                                onClick={() => open('detail', r)}
                              >
                                {r.name}
                              </button>
                              <small>
                                {(
                                  {
                                    productSale: 'Product sale',
                                    contribution: 'Owner contribution',
                                    draw: 'Owner draw',
                                    market: 'Market sales',
                                    income: 'Money in',
                                    expense: 'Money out',
                                    reversal: 'Correction',
                                    expenseRefund: 'Expense refund',
                                  } as Record<string, string>
                                )[r.source] || r.source}
                              </small>
                            </td>
                            <td>{r.category}</td>
                            <td>{r.account}</td>
                            <td className="book-in">
                              {r.moneyIn ? money(r.moneyIn) : '—'}
                            </td>
                            <td>{r.moneyOut ? money(r.moneyOut) : '—'}</td>
                            <td>{money(r.balance)}</td>
                            <td>
                              <input
                                aria-label={'Cleared ' + r.name}
                                type="checkbox"
                                disabled={!canWrite || r.reconciled || busy}
                                checked={r.cleared}
                                onChange={(e) =>
                                  save('financeBookCleared', {
                                    rowId: r.id,
                                    cleared: e.target.checked,
                                    requestId: crypto.randomUUID(),
                                  })
                                }
                              />
                              {r.reconciled && (
                                <span className="book-badge">Balanced</span>
                              )}
                            </td>
                            <td>
                              {r.receiptId ? (
                                <button
                                  className="book-link"
                                  onClick={() => onViewReceipt?.(r.receiptId)}
                                >
                                  View receipt
                                </button>
                              ) : r.receiptUrl ? (
                                <a
                                  href={r.receiptUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Invoice / receipt
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
                {!rows.length && (
                  <p>
                    No money movements in this period. Add money in or out to
                    get started.
                  </p>
                )}
                <p className="muted">
                  Running balances include earlier activity in each account.
                  Transfers appear once in each account. Purchase details stay
                  linked to the original receipt.
                </p>
              </div>
            )}
            {tab === 'Accounts' && (
              <div className="book-panel">
                <div className="book-heading">
                  <h3>Where your money lives</h3>
                  <button
                    disabled={!canWrite}
                    onClick={() => open('account', { type: 'checking' })}
                  >
                    Add account
                  </button>
                </div>
                {b.accounts.map((a: Item) => (
                  <div className="book-account" key={a.name}>
                    <div>
                      <h3>{a.name}</h3>
                      <span>{a.accountKind || 'Business money'}</span>
                    </div>
                    <strong>{money(a.balance)}</strong>
                    <button
                      className="secondary"
                      disabled={!canWrite}
                      onClick={() =>
                        open('reconcile', { account: a.name, balance: '0' })
                      }
                    >
                      Reconcile
                    </button>
                  </div>
                ))}
                <p>
                  Business card balances show money available minus spending; a
                  negative balance is money owed. Enter an opening balance as
                  owner money or a transfer with a note.
                </p>
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={!canWrite}
                    onClick={() => open('contribution')}
                  >
                    Owner contribution
                  </button>
                  <button
                    className="secondary"
                    disabled={!canWrite}
                    onClick={() => open('draw')}
                  >
                    Owner draw
                  </button>
                </div>
              </div>
            )}
            {['Bills', 'Invoices'].includes(tab) && (
              <div className="book-panel">
                <div className="book-heading">
                  <h3>
                    {tab === 'Bills' ? 'Money you owe' : 'Money owed to you'}
                  </h3>
                  <button
                    disabled={!canWrite}
                    onClick={() =>
                      open(tab === 'Bills' ? 'bill' : 'invoice', {
                        category:
                          tab === 'Invoices'
                            ? 'Sales'
                            : cats('expense')[0]?.name,
                      })
                    }
                  >
                    Add {tab === 'Bills' ? 'bill' : 'invoice'}
                  </button>
                </div>
                <p>
                  Unpaid amounts are shown separately. Profit counts payments
                  when money moves.
                </p>
                {obligations.map((o: Item) => (
                  <div className="book-account" key={o.id}>
                    <div>
                      <h3>{o.name}</h3>
                      <p>
                        Due {o.dueDate || o.date} ·{' '}
                        <span className="book-badge">
                          {o.open
                            ? o.aging === 'Current'
                              ? 'Current'
                              : o.aging + ' days overdue'
                            : 'Paid'}
                        </span>
                      </p>
                    </div>
                    <strong>{money(o.open)}</strong>
                    {o.bookkeeping && !o.paid && (
                      <button
                        className="secondary"
                        disabled={!canWrite}
                        onClick={() => open('void', { id: o.id })}
                      >
                        Void
                      </button>
                    )}
                    {o.open > 0 && (
                      <button
                        disabled={!canWrite}
                        onClick={() =>
                          open('payment', {
                            id: o.id,
                            name: o.name,
                            amount: (o.open / 100).toFixed(2),
                          })
                        }
                      >
                        Record payment
                      </button>
                    )}
                  </div>
                ))}
                {!obligations.length && <p>No {tab.toLowerCase()} yet.</p>}
              </div>
            )}
            {tab === 'Mileage' && (
              <div className="book-panel">
                <div className="book-heading">
                  <h3>Your trip log</h3>
                  <button disabled={!canWrite} onClick={() => open('mileage')}>
                    Add trip
                  </button>
                </div>
                <p>
                  Use your own rate. Mileage estimates do not post spending or
                  determine deductibility.
                </p>
                <strong>Calculated total: {money(b.mileageTotal)}</strong>
                {b.mileage.map((r: Item) => (
                  <p key={r.id}>
                    {r.date} · {r.name} · {r.miles} miles × {money(r.rateCents)}{' '}
                    = {money(r.amountCents)}
                  </p>
                ))}
              </div>
            )}
            {tab === 'Reports' && (
              <>
                <p>
                  Bookkeeping summaries · cash basis · {b.from} through {b.to}.
                  These summaries are not tax filings and do not determine tax
                  deductibility.
                </p>
                <button
                  className="secondary book-print"
                  onClick={() => window.print()}
                >
                  Print / Save as PDF
                </button>
                {[
                  ['Profit & Loss', reportRows],
                  ['Spending by category', b.spending],
                  ['Income by sales channel', b.channels],
                  [
                    'Sales tax collected',
                    [
                      {
                        id: 'tax',
                        name: 'Collected less reversals / remittances',
                        amount: b.tax,
                      },
                    ],
                  ],
                  [
                    'Account balances',
                    b.accounts.map((a: Item) => ({ ...a, amount: a.balance })),
                  ],
                  [
                    'Mileage log',
                    b.mileage.map((r: Item) => ({
                      ...r,
                      amount: r.amountCents,
                    })),
                  ],
                  ...(b.settings.bills || b.settings.invoices
                    ? [
                        [
                          'Open bills and invoices',
                          b.obligations
                            .filter(
                              (o: Item) =>
                                o.open &&
                                b.settings[
                                  o.kind === 'bill' ? 'bills' : 'invoices'
                                ],
                            )
                            .map((o: Item) => ({
                              ...o,
                              name: o.name + ' · ' + o.aging,
                              amount: o.open,
                            })),
                        ],
                      ]
                    : []),
                ].map(([name, data]) => (
                  <div className="book-panel" key={name as string}>
                    <div className="book-heading">
                      <h3>{name as string}</h3>
                      <button
                        className="secondary"
                        onClick={() =>
                          download(
                            name as string,
                            (data as Item[]).map((r: Item) => ({
                              id: r.id,
                              name: r.name,
                              date: r.date || '',
                              amount: r.amount / 100,
                              ...(r.miles
                                ? { miles: r.miles, rate: r.rateCents / 100 }
                                : {}),
                              ...(r.aging
                                ? { aging: r.aging, dueDate: r.dueDate }
                                : {}),
                            })),
                          )
                        }
                      >
                        CSV
                      </button>
                    </div>
                    {(data as Item[]).map((r: Item) => (
                      <div className="book-report-row" key={r.id}>
                        <span>
                          {r.name}
                          {r.miles ? ' · ' + r.miles + ' miles' : ''}
                        </span>
                        <strong>{money(r.amount)}</strong>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
            {tab === 'Settings / Categories' && (
              <>
                <div className="book-panel">
                  <h3>Keep it as simple as you need</h3>
                  {['bills', 'invoices'].map((key) => (
                    <label className="book-toggle" key={key}>
                      <input
                        type="checkbox"
                        disabled={!canWrite || busy}
                        checked={!!b.settings[key]}
                        onChange={(e) =>
                          save('financeBookSettings', {
                            ...b.settings,
                            [key]: e.target.checked,
                            requestId: crypto.randomUUID(),
                          })
                        }
                      />
                      Turn on {key === 'bills' ? 'bill' : 'invoice'} tracking
                    </label>
                  ))}
                </div>
                <div className="book-panel">
                  <div className="book-heading">
                    <h3>Your categories</h3>
                    <button
                      disabled={!canWrite}
                      onClick={() => open('category', { type: 'expense' })}
                    >
                      Add category
                    </button>
                  </div>
                  <div className="book-tags">
                    {b.categories.map((c: Item) => (
                      <span className="book-badge" key={c.name}>
                        {c.name}
                      </span>
                    ))}
                  </div>
                  <p>
                    For ingredients and packaging added to stock, use Receipt
                    inbox or inventory purchasing so product costs stay
                    connected.
                  </p>
                </div>
                <div className="book-panel">
                  <div className="book-heading">
                    <h3>Recurring suggestions</h3>
                    <button
                      disabled={!canWrite}
                      onClick={() => open('recurring')}
                    >
                      Add suggestion
                    </button>
                  </div>
                  <p>
                    Suggestions never move money until you confirm. Each
                    occurrence stays visible in your register.
                  </p>
                  {b.recurring.map((r: Item) => (
                    <div className="book-account" key={r.id}>
                      <span>
                        {r.name} · {money(Math.round(r.amount * 100))} · from{' '}
                        {r.date}
                      </span>
                      <button
                        disabled={
                          !canWrite ||
                          r.date > today ||
                          (w.journals || []).some(
                            (j) =>
                              j.requestId ===
                              `recurring:${r.id}:${today.slice(0, 7)}`,
                          )
                        }
                        onClick={() =>
                          open('expense', {
                            name: r.name,
                            account: r.account,
                            category: r.category,
                            amount: r.amount,
                            requestId: `recurring:${r.id}:${today.slice(0, 7)}`,
                          })
                        }
                      >
                        Review this month
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <Dialog
          open={!!modal}
          onOpenChange={(v) => {
            if (!busy && !v) setModal('')
          }}
        >
          <DialogContent className="book-dialog">
            <DialogHeader>
              <DialogTitle>
                {
                  (
                    {
                      income: 'Money in',
                      expense: 'Money out',
                      transfer: 'Transfer',
                      market: 'Record market day sales',
                      bill: 'New bill',
                      invoice: 'New invoice',
                      payment: 'Record payment',
                      contribution: 'Owner contribution',
                      draw: 'Owner draw',
                      reconcile: 'Balance your statement',
                      mileage: 'Add trip',
                      account: 'Add account',
                      category: 'Add category',
                      recurring: 'Recurring suggestion',
                      detail: 'Transaction details',
                      void: 'Void transaction',
                      import: 'Import statement CSV',
                    } as Record<string, string>
                  )[modal]
                }
              </DialogTitle>
              <DialogDescription>
                Review the details before saving. All amounts use your business
                currency.
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const actions: Record<string, string> = {
                  account: 'Account',
                  category: 'Category',
                  mileage: 'Mileage',
                  reconcile: 'Reconcile',
                  recurring: 'Recurring',
                  void: 'Void',
                  payment: 'Pay',
                }
                save(
                  'financeBook' + (actions[modal] || 'Entry'),
                  modal === 'reconcile' ? { ...d, rowIds: selected } : d,
                )
              }}
            >
              {transactionKinds.includes(modal) && (
                <>
                  <div className="form-grid">
                    {input('date', 'Date', 'date')}
                    {input(
                      'name',
                      modal === 'transfer' ? 'Description' : 'Payee / Customer',
                    )}
                    {input(
                      'amount',
                      modal === 'market'
                        ? 'Gross sales including collected tax ($)'
                        : 'Amount ($)',
                      'number',
                    )}
                    {chooseAccount()}
                    {modal === 'transfer' &&
                      chooseAccount('destination', 'To account')}
                    {['bill', 'invoice'].includes(modal) &&
                      input('dueDate', 'Due date', 'date')}
                    {['income', 'expense', 'bill', 'invoice'].includes(modal) &&
                      chooseCategory()}
                    {['income', 'market', 'invoice'].includes(modal) && (
                      <Field label="Sales channel">
                        <select
                          value={d.channel || 'Other'}
                          onChange={(e) =>
                            setD({ ...d, channel: e.target.value })
                          }
                        >
                          {[
                            'Other',
                            'Online',
                            'Market',
                            'Wholesale',
                            'Custom orders',
                          ].map((n) => (
                            <option key={n}>{n}</option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {modal === 'market' && (
                      <>
                        {input('tax', 'Sales tax collected ($)', 'number')}
                        {input('cash', 'Cash received ($)', 'number')}
                        {input('fees', 'Card processing fees ($)', 'number')}
                        {chooseAccount('cardAccount', 'Card processor account')}
                      </>
                    )}
                  </div>
                  <Field label="Note">
                    <textarea
                      value={d.notes || ''}
                      onChange={(e) => setD({ ...d, notes: e.target.value })}
                    />
                  </Field>
                  {['income', 'expense', 'bill', 'invoice'].includes(modal) && (
                    <>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() =>
                          setD({
                            ...d,
                            splits: [
                              ...(d.splits || []),
                              { category: d.category, amount: '' },
                            ],
                          })
                        }
                      >
                        Split across categories
                      </button>
                      {(d.splits || []).map((s: Item, i: number) => (
                        <div className="book-filters" key={i}>
                          <Field label={'Split ' + (i + 1) + ' category'}>
                            <select
                              value={s.category}
                              onChange={(e) =>
                                setD({
                                  ...d,
                                  splits: d.splits.map((x: Item, j: number) =>
                                    i === j
                                      ? { ...x, category: e.target.value }
                                      : x,
                                  ),
                                })
                              }
                            >
                              {cats(d.kind).map((c: Item) => (
                                <option key={c.name}>{c.name}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label={'Split ' + (i + 1) + ' amount ($)'}>
                            <input
                              required
                              type="number"
                              step="0.01"
                              value={s.amount}
                              onChange={(e) =>
                                setD({
                                  ...d,
                                  splits: d.splits.map((x: Item, j: number) =>
                                    i === j
                                      ? { ...x, amount: e.target.value }
                                      : x,
                                  ),
                                })
                              }
                            />
                          </Field>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() =>
                              setD({
                                ...d,
                                splits: d.splits.filter(
                                  (_: Item, j: number) => i !== j,
                                ),
                              })
                            }
                          >
                            Remove split
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                  {modal === 'expense' && (
                    <Field label="Receipt photo (optional)">
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) =>
                          setReceiptPhoto(e.target.files?.[0] || null)
                        }
                      />
                    </Field>
                  )}
                  <p className="muted">
                    With a receipt photo, continue to Receipt inbox to review
                    its business portion and record the purchase once. Without a
                    photo, this form records the money out directly.
                  </p>
                  {modal === 'market' && (
                    <p>
                      Use product sales for quantities that need inventory
                      deducted. Do not enter the same sales here again.
                    </p>
                  )}
                  {['contribution', 'draw', 'transfer'].includes(modal) && (
                    <p>This moves money without changing profit.</p>
                  )}
                </>
              )}
              {modal === 'account' && (
                <>
                  {input('name', 'Account name')}
                  <Field label="Type">
                    <select
                      value={d.type}
                      onChange={(e) => setD({ ...d, type: e.target.value })}
                    >
                      {[
                        'checking',
                        'savings',
                        'cash box',
                        'business card',
                        'payment processor',
                      ].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              {modal === 'category' && (
                <>
                  {input('name', 'Category name')}
                  <Field label="Used for">
                    <select
                      value={d.type}
                      onChange={(e) => setD({ ...d, type: e.target.value })}
                    >
                      <option value="expense">Money out</option>
                      <option value="income">Money in</option>
                    </select>
                  </Field>
                </>
              )}
              {modal === 'mileage' && (
                <>
                  {input('date', 'Date', 'date')}
                  {input('purpose', 'Business purpose')}
                  {input('miles', 'Miles', 'number')}
                  {input('rate', 'Your rate per mile ($)', 'number')}
                </>
              )}
              {modal === 'recurring' && (
                <>
                  {input('name', 'Payee')}
                  {input('date', 'First suggestion date', 'date')}
                  {input('amount', 'Amount ($)', 'number')}
                  {chooseAccount()}
                  {chooseCategory()}
                  <p>Monthly suggestion; confirm each occurrence yourself.</p>
                </>
              )}
              {modal === 'reconcile' && (
                <>
                  {chooseAccount()}
                  {input('date', 'Statement ending date', 'date')}
                  {input('balance', 'Statement ending balance ($)', 'number')}
                  <h3>
                    Difference:{' '}
                    {money(
                      Math.round(Number(d.balance || 0) * 100) - statementTotal,
                    )}
                  </h3>
                  <p>
                    Check transactions shown on your statement. Earlier balanced
                    transactions are included automatically.
                  </p>
                  {statementRows.map((r: Item) => (
                    <label className="book-toggle" key={r.id}>
                      <input
                        type="checkbox"
                        checked={r.reconciled || selected.includes(r.id)}
                        disabled={r.reconciled}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, r.id]
                              : selected.filter((id) => id !== r.id),
                          )
                        }
                      />
                      {r.date} · {r.name} · {money(r.moneyIn - r.moneyOut)}
                    </label>
                  ))}
                </>
              )}
              {modal === 'detail' && (
                <>
                  <p>
                    {d.date} · {d.name}
                  </p>
                  <p>
                    {d.account} · {d.category}
                  </p>
                  <p>
                    {money(d.moneyIn - d.moneyOut)} · Balance {money(d.balance)}
                  </p>
                  <p>{d.notes}</p>
                  <p>Source: {d.source}</p>
                  {d.receiptUrl && (
                    <a href={d.receiptUrl} target="_blank" rel="noreferrer">
                      View invoice or receipt
                    </a>
                  )}
                  {w.ledger
                    .filter(
                      (l) =>
                        l.type === 'purchase_receipt' &&
                        ((d.transactionId &&
                          l.transactionId === d.transactionId) ||
                          (d.receiptId && l.receiptId === d.receiptId)),
                    )
                    .map((l) => (
                      <p key={l.id}>
                        <RecordLink
                          kind="purchase"
                          id={l.id}
                          onOpen={() => setModal('')}
                        >
                          View purchase · {l.name}
                        </RecordLink>
                      </p>
                    ))}
                  {detailReceipts.map((detailReceipt) => (
                    <button
                      key={detailReceipt.id}
                      type="button"
                      onClick={() => {
                        setModal('')
                        onViewReceipt?.(detailReceipt.id)
                      }}
                    >
                      View receipt
                      {detailReceipts.length > 1
                        ? ` · ${detailReceipt.vendor || detailReceipt.name}`
                        : ''}
                    </button>
                  ))}
                  <p>
                    Corrections keep the original transaction. For receipt or
                    product sales changes, use the linked source workflow.
                  </p>
                  {canWrite &&
                    !d.reconciled &&
                    (w.finance_transactions || []).some(
                      (t) =>
                        t.id === d.transactionId &&
                        t.bookkeeping &&
                        !t.reversedBy,
                    ) && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => open('void', { id: d.transactionId })}
                      >
                        Void with a reason
                      </button>
                    )}
                </>
              )}
              {modal === 'void' && (
                <>
                  {input('date', 'Correction date', 'date')}
                  {input('reason', 'Reason')}
                  <p>
                    This adds an opposite money movement and preserves the
                    original. Record the corrected transaction separately if
                    needed.
                  </p>
                </>
              )}
              {modal === 'import' && (
                <>
                  <p>
                    Map a date column (YYYY-MM-DD), a description, and a signed
                    amount (positive for money in, negative for money out).
                    Every line needs your review.
                  </p>
                  <Field label="Statement CSV">
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={async (e) => {
                        try {
                          const file = e.target.files?.[0]
                          if (!file) return
                          if (file.size > 2000000)
                            throw new Error('Choose a CSV smaller than 2 MB.')
                          const rows = parseCsv(await file.text())
                          if (rows.length > 1000)
                            throw new Error(
                              'Import at most 1,000 lines at once.',
                            )
                          setCsvRows(rows)
                          setMapping({ date: '', name: '', amount: '' })
                        } catch (e) {
                          setError(
                            e instanceof Error
                              ? e.message
                              : 'Unable to read CSV.',
                          )
                        }
                      }}
                    />
                  </Field>
                  {chooseAccount()}
                  {(['date', 'name', 'amount'] as const).map((key) => (
                    <Field label={key + ' column'} key={key}>
                      <select
                        value={mapping[key]}
                        onChange={(e) =>
                          setMapping({ ...mapping, [key]: e.target.value })
                        }
                      >
                        <option value="">Choose column</option>
                        {Object.keys(csvRows[0] || {}).map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </Field>
                  ))}
                  {mapping.date &&
                    mapping.name &&
                    mapping.amount &&
                    csvRows.map((r, i) => {
                      const date = r[mapping.date],
                        amount = Number(r[mapping.amount]),
                        name = r[mapping.name]
                      const key = JSON.stringify([
                        d.account,
                        date,
                        amount,
                        name,
                        i,
                      ])
                      const duplicate = (w.finance_reviews || []).some(
                        (v) => v.importKey === key,
                      )
                      const matches = (b?.rows || []).filter(
                        (v: Item) =>
                          v.account === d.account &&
                          v.date === date &&
                          v.moneyIn - v.moneyOut === Math.round(amount * 100),
                      )
                      return (
                        <div className="book-import-row" key={i}>
                          <p>
                            {date} · {name} · {money(Math.round(amount * 100))}
                          </p>
                          {duplicate ? (
                            <span className="book-badge">Already reviewed</span>
                          ) : (
                            <>
                              <span className="book-badge">
                                {matches.length
                                  ? 'Possible match'
                                  : 'Needs review'}
                              </span>
                              {matches.map((v: Item) => (
                                <button
                                  key={v.id}
                                  type="button"
                                  disabled={!canWrite || busy}
                                  onClick={() =>
                                    save(
                                      'financeBookMatch',
                                      {
                                        rowId: v.id,
                                        date,
                                        amount: String(amount),
                                        account: d.account,
                                        importKey: key,
                                        requestId: crypto.randomUUID(),
                                      },
                                      true,
                                    )
                                  }
                                >
                                  Match {v.name}
                                </button>
                              ))}
                              <button
                                type="button"
                                disabled={
                                  !canWrite ||
                                  !Number.isFinite(amount) ||
                                  !amount
                                }
                                onClick={() =>
                                  open(amount > 0 ? 'income' : 'expense', {
                                    date,
                                    name,
                                    account: d.account,
                                    amount: Math.abs(amount).toFixed(2),
                                    category:
                                      amount > 0
                                        ? 'Sales'
                                        : cats('expense')[0]?.name,
                                    importKey: key,
                                  })
                                }
                              >
                                Review as new
                              </button>
                            </>
                          )}
                        </div>
                      )
                    })}
                </>
              )}
              {!['detail', 'import'].includes(modal) && (
                <button disabled={!canWrite || busy} type="submit">
                  {busy
                    ? 'Saving…'
                    : modal === 'reconcile'
                      ? 'Finish balancing'
                      : receiptPhoto && modal === 'expense'
                        ? 'Continue to receipt review'
                        : 'Confirm & save'}
                </button>
              )}
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  )
}

export function FinanceNavigation({
  active,
  workspace,
  onNavigate,
  purchasing = false,
}: {
  purchasing?: boolean
  active: string
  workspace: Workspace
  onNavigate: (tab: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const settings = workspace.bookkeeping?.[0]?.settings
  const tabs = purchasing
    ? ['Purchases & Receipts', 'Suppliers', 'Purchase Orders']
    : [
        'Overview',
        'Register',
        'Accounts',
        ...(settings?.bills ? ['Bills'] : []),
        ...(settings?.invoices ? ['Invoices'] : []),
        'Mileage',
        'Reports',
        'Settings / Categories',
        'Advanced',
        'Advanced reports',
        'Receipt inbox',
      ]
  return (
    <aside
      className="book-nav"
      aria-label={purchasing ? 'Purchasing sections' : 'Finance sections'}
      data-expanded={expanded}
    >
      <span className="book-eyebrow">
        {purchasing ? 'RECEIPTS & RESTOCKING' : 'YOUR BUSINESS, BALANCED'}
      </span>
      <h2>{purchasing ? 'Purchasing' : 'Bookkeeping'}</h2>
      <button
        className="book-nav-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {purchasing ? 'Purchasing' : 'Bookkeeping'} · {active}
      </button>
      <div className="book-nav-links">
        {tabs.map((tab) => (
          <button
            key={tab}
            aria-current={active === tab ? 'page' : undefined}
            onClick={() => {
              onNavigate(tab)
              setExpanded(false)
            }}
          >
            {tab}
          </button>
        ))}
      </div>
    </aside>
  )
}
