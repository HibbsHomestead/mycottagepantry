import { useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  ReceiptText,
  Plus,
  ArrowRight,
  FileText,
  Search,
  CircleAlert,
} from 'lucide-react'
import { money, type Workspace, type Item } from '@/lib/domain'
import {
  datePeriods,
  dateRange,
  type DatePeriod,
} from '@/lib/date-ranges'
import { ovenToday } from '@/lib/oven-dates'
import {
  financeDashboard,
  type FinanceRecord,
} from '@/lib/finance-dashboard'

export function FinanceDashboard({
  workspace: w,
  ready,
  loadError,
  canWrite,
  onAction,
  onNavigate,
  onReceipt,
  onReconcile,
}: {
  workspace: Workspace
  loadError?: string
  ready: boolean
  canWrite: boolean
  onAction: (action: string) => void
  onNavigate: (section: string) => void
  onReceipt: (receipt: Item) => void
  onReconcile: (transaction: Item) => void
}) {
  const [period, setPeriod] = useState<DatePeriod | 'All time'>(
    'This month',
  )
  const [custom, setCustom] = useState({ start: '', end: '' })
  const [drill, setDrill] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [attention, setAttention] = useState('')
  const [bucketDetail, setBucketDetail] = useState('')
  const range =
    period === 'All time'
      ? { start: '0001-01-01', end: '9999-12-31' }
      : period === 'Custom'
        ? custom
        : dateRange(
            period,
            new Date(ovenToday(w.settings[0]) + 'T12:00:00'),
          )
  const valid = !!range.start && !!range.end && range.start <= range.end
  const data = financeDashboard(w, range.start, range.end)
  const value = (n: number | null, count: number) =>
    !ready
      ? loadError
        ? 'Unavailable'
        : 'Loading…'
      : !valid
        ? '—'
        : !count
          ? '—'
          : n == null
            ? 'Incomplete'
            : money(n)
  let records: FinanceRecord[] = data.rows.filter((r) =>
    !drill || drill === 'difference'
      ? r.metric !== 'tax'
      : r.metric === drill,
  )
  if (category)
    records = records.filter(
      (r) => (r.category || 'Missing category') === category,
    )
  const filtered = records
    .filter((r) =>
      `${r.name} ${r.category} ${r.date}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
  const show = (metric: string, cat = '') => {
    setAttention('')
    setDrill(metric)
    setCategory(cat)
    setSearch('')
    requestAnimationFrame(() =>
      document
        .getElementById('finance-source-records')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    )
  }
  const scale = Math.max(
    1,
    ...data.trend.flatMap((p) => [
      Math.abs(p.income || 0),
      Math.abs(p.expenses || 0),
    ]),
  )
  return (
    <div className="finance-dashboard" aria-busy={!ready}>
      <header className="finance-dashboard-heading">
        <div>
          <span className="eyebrow">YOUR BUSINESS, IN VIEW</span>
          <h2>Money made clear.</h2>
          <p>A closer look at the records behind your business.</p>
        </div>
        <label className="field">
          <span>Date range</span>
          <select
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as typeof period)
              setBucketDetail('')
              setDrill('')
              setCategory('')
            }}
          >
            {[...datePeriods, 'All time'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        {period === 'Custom' && (
          <div className="finance-range">
            {(['start', 'end'] as const).map((k) => (
              <label className="field" key={k}>
                <span>{k === 'start' ? 'From' : 'Through'}</span>
                <input
                  type="date"
                  value={custom[k]}
                  onChange={(e) =>
                    setCustom({ ...custom, [k]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
        )}
      </header>
      {loadError && (
        <p role="alert">
          Financial records could not load. {loadError}
        </p>
      )}
      {!ready && !loadError && (
        <p role="status">Loading financial records…</p>
      )}
      {!valid && (
        <p role="alert">
          Choose a complete date range with the start before the end.
        </p>
      )}
      <p className="finance-scope">
        {valid
          ? `${period === 'All time' ? 'All recorded dates' : `${range.start} – ${range.end}`} · `
          : ''}
        Posted records only · drafts and pending activity excluded from
        figures.
      </p>
      {ready && valid && !loadError && (
        <>
          {!data.expenses.records.length && (
            <p className="finance-scope" role="status">
              {data.drafts.length
                ? `Receipts awaiting review: ${data.drafts.length}. No posted operating expenses recorded in this period.`
                : 'No operating expenses recorded in this period.'}{' '}
              {data.receiptRecords.some(
                (r) => r.withinPeriod && r.inventoryLines > 0,
              ) &&
                'Posted inventory purchases are assets and appear in the receipt details below.'}
            </p>
          )}
          {!!data.outsidePeriod.length && (
            <p className="finance-scope">
              {data.outsidePeriod.length} posted{' '}
              {data.outsidePeriod.length === 1 ? 'receipt is' : 'receipts are'}{' '}
              outside the selected period.{' '}
              <button
                className="btn secondary"
                onClick={() => setPeriod('All time')}
              >
                Show all time
              </button>
            </p>
          )}
          <section className="finance-summary" aria-label="At a glance">
            {[
              {
                key: 'income',
                label: 'Recorded income',
                n: data.income.value,
                count: data.income.records.length,
                help: 'Product sales excluding tax, after recorded refunds and discounts, plus consignment commission income. Payouts and transfers excluded.',
                Icon: ArrowDownLeft,
              },
              {
                key: 'expenses',
                label: 'Recorded expenses',
                n: data.expenses.value,
                count: data.expenses.records.length,
                help: 'Operating expense rows plus sale processing fees. Inventory purchases and owner draws excluded. Bills are included when recorded, not again when paid.',
                Icon: ArrowUpRight,
              },
              {
                key: 'difference',
                label: 'Income less expenses',
                n: data.difference,
                count:
                  data.income.records.length +
                  data.expenses.records.length,
                help: 'Recorded income minus recorded operating expenses and fees. Before cost of goods sold; this is not accounting profit or available cash.',
                Icon: ReceiptText,
              },
              {
                key: 'tax',
                label: 'Sales tax collected',
                n: data.tax.value,
                count: data.tax.records.length,
                help: 'Tax on recorded product and consignment sales, including recorded refund adjustments. This period’s collections, not the outstanding liability.',
                Icon: FileText,
              },
            ].map((c) => (
              <button
                className={`finance-summary-card ${c.key}`}
                key={c.key}
                title={c.help}
                onClick={() => show(c.key)}
              >
                <span>
                  <c.Icon size={17} />
                  {c.label}
                </span>
                <strong>{value(c.n, c.count)}</strong>
                <small>
                  {!c.count
                    ? 'No records in this period'
                    : c.key === 'difference'
                      ? 'Before cost of goods sold'
                      : 'View underlying records'}
                  <ArrowRight size={14} />
                </small>
              </button>
            ))}
          </section>
          <div
            className="finance-quick-actions"
            aria-label="Quick actions"
          >
            <button
              className="btn"
              disabled={!canWrite}
              onClick={() => onNavigate('Receipt inbox')}
            >
              <ReceiptText size={17} />
              Scan / upload receipt
            </button>
            <button
              className="btn secondary"
              disabled={!canWrite}
              onClick={() => onAction('expense')}
            >
              <Plus size={17} />
              Add expense
            </button>
            <button
              className="btn secondary"
              disabled={!canWrite}
              onClick={() => onAction('sale')}
            >
              <Plus size={17} />
              Record sale
            </button>
            <button
              className="btn secondary"
              onClick={() => onNavigate('Reports')}
            >
              <FileText size={17} />
              View reports
            </button>
          </div>
          <div className="finance-visual-grid">
            <section className="panel finance-trend">
              <div className="panel-heading">
                <div>
                  <h3>Income & expenses</h3>
                  <p>
                    Recorded totals by {data.daily ? 'day' : 'month'}
                  </p>
                </div>
                <span className="finance-legend">
                  <i />
                  Income <i />
                  Expenses
                </span>
              </div>
              {!data.trend.length ? (
                <p className="finance-empty">
                  No recorded activity in this period.
                  <button
                    className="btn secondary"
                    onClick={() => setPeriod('All time')}
                  >
                    Show all time
                  </button>
                </p>
              ) : (
                <div className="finance-trend-bars">
                  {data.trend.map((p) => (
                    <button
                      key={p.month}
                      className="finance-month"
                      onMouseEnter={() => setBucketDetail(`${p.month}: Income ${p.income == null ? 'Incomplete' : money(p.income)}; expenses ${p.expenses == null ? 'Incomplete' : money(p.expenses)}`)}
                      onFocus={() => setBucketDetail(`${p.month}: Income ${p.income == null ? 'Incomplete' : money(p.income)}; expenses ${p.expenses == null ? 'Incomplete' : money(p.expenses)}`)}
                      onClick={() => {
                        show('difference')
                        setSearch(p.month)
                      }}
                      title={`${p.month}: income ${p.income == null ? 'Incomplete' : money(p.income)}, expenses ${p.expenses == null ? 'Incomplete' : money(p.expenses)}`}
                      aria-label={`${p.month}: income ${p.income == null ? 'incomplete' : money(p.income)}, expenses ${p.expenses == null ? 'incomplete' : money(p.expenses)}`}
                    >
                      <div className="finance-bar-pair">
                        {[p.income, p.expenses].map((n, i) => (
                          <span
                            key={i}
                            className={i ? 'out' : 'in'}
                            style={{
                              height: `${n == null ? 0 : (Math.abs(n) / scale) * 100}%`,
                            }}
                          >
                            {n != null && n < 0 ? '−' : ''}
                          </span>
                        ))}
                      </div>
                      <small>
                        {p.month}
                        {(p.income == null || p.expenses == null) && (
                          <span> · Incomplete</span>
                        )}
                      </small>
                    </button>
                  ))}
                </div>
              )}
              <p role="status" className="finance-chart-note">{bucketDetail}</p>
              <p className="finance-chart-note">
                Hover or focus for amounts; select a date bucket to see
                its records. Negative totals use a minus marker; missing
                amounts remain incomplete.
              </p>
            </section>
            <section className="panel finance-categories">
              <div className="panel-heading">
                <div>
                  <h3>Where expenses go</h3>
                  <p>Operating expenses & processing fees</p>
                </div>
              </div>
              {!data.categories.length ? (
                <p className="finance-empty">
                  Categories appear as expenses are recorded.
                </p>
              ) : (
                data.categories.map((c, i) => (
                  <button
                    className="finance-category"
                    key={c.name}
                    onClick={() => show('expenses', c.name)}
                  >
                    <span>
                      {c.name}
                      <strong>
                        {c.value == null
                          ? 'Incomplete'
                          : money(c.value)}
                      </strong>
                    </span>
                    <span className="finance-category-track">
                      <i
                        data-tone={i % 4}
                        style={{
                          width: `${c.value == null ? 0 : Math.max(1, (Math.abs(c.value) / Math.max(1, ...data.categories.map((x) => Math.abs(x.value || 0)))) * 100)}%`,
                        }}
                      />
                    </span>
                  </button>
                ))
              )}
            </section>
          </div>
          <section className="panel finance-attention">
            <div>
              <CircleAlert size={20} />
              <h3>Needs attention</h3>
              <small>Selected period; undated drafts included</small>
            </div>
            <div className="finance-attention-links">
              <button onClick={() => setAttention('receipts')}>
                <strong>{data.drafts.length}</strong> receipts awaiting
                review
                <ArrowRight size={15} />
              </button>
              <button onClick={() => setAttention('reconcile')}>
                <strong>{data.unreconciled.length}</strong> records not
                reconciled
                <ArrowRight size={15} />
              </button>
              <button
                onClick={() => show('expenses', 'Missing category')}
              >
                <strong>{data.missingCategories.length}</strong> missing
                categories
                <ArrowRight size={15} />
              </button>
              {!!data.failures.length && (
                <button onClick={() => setAttention('errors')}>
                  <strong>{data.failures.length}</strong> receipt
                  reading errors
                  <ArrowRight size={15} />
                </button>
              )}
            </div>
          </section>
          {attention && (
            <section className="panel finance-attention-records">
              <div className="panel-heading">
                <h3>
                  {attention === 'reconcile'
                    ? 'Records not reconciled'
                    : attention === 'errors'
                      ? 'Receipt reading errors'
                      : 'Receipts awaiting review'}
                </h3>
                <button
                  className="btn secondary"
                  onClick={() => setAttention('')}
                >
                  Close list
                </button>
              </div>
              <p className="finance-chart-note">
                {range.start} – {range.end}; undated receipt drafts
                included.
              </p>
              {(attention === 'reconcile'
                ? data.unreconciled
                : attention === 'errors'
                  ? data.failures
                  : data.drafts
              ).map((r) => (
                <button
                  className="finance-list-row"
                  key={r.id}
                  onClick={() =>
                    attention === 'reconcile'
                      ? onReconcile(r)
                      : onReceipt(r)
                  }
                >
                  <span>
                    <strong>{r.vendor || r.name}</strong>
                    <small>
                      {r.date || 'Date needed'} ·{' '}
                      {attention === 'reconcile'
                        ? r.kind
                        : r.extractionStatus || 'Manual entry'}
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
              {!(
                attention === 'reconcile'
                  ? data.unreconciled
                  : attention === 'errors'
                    ? data.failures
                    : data.drafts
              ).length && (
                <p className="finance-empty">
                  No items need attention in this period.
                </p>
              )}
            </section>
          )}
          <section className="panel" id="finance-source-records">
            <div className="panel-heading">
              <div>
                <h3>
                  {drill
                    ? category ||
                      {
                        income: 'Income records',
                        expenses: 'Expense records',
                        tax: 'Sales tax records',
                        difference: 'Income & expense records',
                      }[drill]
                    : 'Recent financial records'}
                </h3>
                <p>
                  {range.start} – {range.end} · {filtered.length} source
                  rows
                </p>
              </div>
              <button
                className="btn secondary"
                onClick={() => onNavigate('Money activity')}
              >
                All money activity
                <ArrowRight size={15} />
              </button>
            </div>
            <div className="finance-record-filters">
              <label className="search-field">
                <Search size={17} />
                <input
                  aria-label="Search financial records"
                  type="search"
                  placeholder="Search name, category or date"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <select
                aria-label="Financial record type"
                value={drill}
                onChange={(e) => {
                  setDrill(e.target.value)
                  setCategory('')
                }}
              >
                <option value="">Income & expenses</option>
                <option value="income">Income</option>
                <option value="expenses">Expenses</option>
                <option value="tax">Sales tax</option>
                <option value="difference">Income less expenses</option>
              </select>
            </div>
            {!filtered.length ? (
              <p className="finance-empty">
                No matching records. Try another date range or search.
              </p>
            ) : (
              filtered
                .slice(0, drill ? filtered.length : 8)
                .map((r) => (
                  <div className="finance-source-row" key={r.id}>
                    <span className={`finance-record-icon ${r.metric}`}>
                      {r.metric === 'income' ? (
                        <ArrowDownLeft size={17} />
                      ) : (
                        <ArrowUpRight size={17} />
                      )}
                    </span>
                    <span>
                      <strong>{r.name}</strong>
                      <small>
                        {r.date} · {r.category || 'Missing category'} ·{' '}
                        {r.source === 'consignment_sales'
                          ? 'Consignment'
                          : r.source === 'sales'
                            ? 'Sale'
                            : 'Expense'}
                      </small>
                    </span>
                    <strong>
                      {r.amount == null
                        ? 'Incomplete'
                        : money(r.amount)}
                    </strong>
                  </div>
                ))
            )}
          </section>
          {!!data.receiptRecords.length && (
            <section className="panel" aria-label="Saved receipt inclusion">
              <div className="panel-heading">
                <div>
                  <h3>Saved receipts & overview totals</h3>
                  <p>
                    All saved documents in this business. Contributions use the
                    selected date range; receipt totals are never added twice.
                  </p>
                </div>
                <button
                  className="btn secondary"
                  onClick={() => onNavigate('Receipt inbox')}
                >
                  Receipt inbox
                </button>
              </div>
              {data.receiptRecords.map((r) => (
                <div className="finance-source-row finance-receipt-row" key={r.receipt.id}>
                  <span>
                    <strong>{r.receipt.vendor || r.receipt.name}</strong>
                    <small>
                      {r.receipt.date || 'Date needs review'} ·{' '}
                      {r.receipt.status === 'draft'
                        ? 'Awaiting review and posting'
                        : r.receipt.status}{' '}
                      · {r.receipt.id.slice(0, 8)}
                    </small>
                    <small>{r.reason}</small>
                    {r.contributes && (
                      <small>
                        Operating expenses in this period:{' '}
                        {r.expenseAmount == null
                          ? 'Incomplete'
                          : money(r.expenseAmount)}
                      </small>
                    )}
                    {r.withinPeriod && r.inventoryLines > 0 && (
                      <small>
                        Inventory asset:{' '}
                        {r.inventoryAmount == null
                          ? 'Incomplete'
                          : money(r.inventoryAmount)}
                        . Payment activity is recorded separately.
                      </small>
                    )}
                    {!r.withinPeriod && !!r.receipt.date && (
                      <small>
                        Outside selected period; changing the period is required
                        to include eligible expense details.
                      </small>
                    )}
                    {r.awaitingReview && (
                      <small>
                        Reading status: {r.receipt.extractionStatus || 'manual'}
                        . Saved drafts do not affect totals.
                      </small>
                    )}
                  </span>
                  <button
                    className="btn secondary"
                    onClick={() => onReceipt(r.receipt)}
                  >
                    {r.awaitingReview
                      ? 'Review existing receipt'
                      : 'View existing receipt'}
                  </button>
                </div>
              ))}
            </section>
          )}
          {!!data.activity.length && (
            <details className="finance-definitions">
              <summary>
                Money activity and accounting classifications (
                {data.activity.length})
              </summary>
              <p>
                Reconciliation checks evidence independently of posting
                status. Unreconciled posted expenses and sales still
                contribute to the figures.
              </p>
              {data.activity.map((t) => (
                <div className="finance-source-row" key={t.id}>
                  <span>
                    <strong>{t.name}</strong>
                    <small>
                      {t.date} · {t.kind} · {t.exclusion}
                    </small>
                  </span>
                  <button
                    className="btn secondary"
                    onClick={() => onNavigate('Money activity')}
                  >
                    View activity
                  </button>
                </div>
              ))}
            </details>
          )}
          <details className="finance-definitions">
            <summary>How these figures are calculated</summary>
            <p>
              Income uses saved product-sale amounts excluding tax and
              consignment commissions plus approved deductions. Expenses
              use saved non-inventory expense rows and processing fees
              from sales. Signed refunds and reversing expense rows
              remain on their recorded dates. Receipt headers, matched
              purchases, payments, owner activity, transfers and
              processor payouts are not added again. Inventory
              acquisitions remain assets until used; cost of goods sold
              is not subtracted in this dashboard’s difference.
            </p>
            <p>
              Sales tax is the amount recorded as collected during this
              period, not a calculated tax bill. Missing amounts show
              “Incomplete”; no records show a dash; recorded zero values
              show $0.00. These figures cover recorded business activity
              and are not bank balances. Reconciliation status means
              checked against evidence; it does not mean an imported
              bank match.
            </p>
          </details>
        </>
      )}
    </div>
  )
}
