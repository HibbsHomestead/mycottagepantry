import { useState } from 'react'
import {
  Download,
  Settings,
  Receipt,
  ShieldCheck,
  TriangleAlert,
  ArrowRight,
  Check,
  Plug,
} from 'lucide-react'
import {
  money,
  type Workspace,
  type Item,
  roundMoney,
  applicableTaxes,
} from '@/lib/domain'
import { reportRows } from '@/lib/reports'
import { datePeriods, dateRange, type DatePeriod } from '@/lib/date-ranges'
export function TaxCenter({
  workspace: w,
  configure,
  exportData,
}: {
  workspace: Workspace
  configure: () => void
  exportData: (name: string, rows: Item[]) => void
}) {
  const [period, setPeriod] = useState<DatePeriod>('This month'),
    [custom, setCustom] = useState(dateRange('This month')),
    [report, setReport] = useState('Sales tax collected')
  const range = period === 'Custom' ? custom : dateRange(period)
  const sales = [
      ...w.sales,
      ...(w.consignment_sales || []).map((s): Item => ({
        ...s,
        amount: s.merchandise,
        taxSnapshot: [],
        taxStatus: 'manual_consignment',
      })),
    ].filter((s) => s.date >= range.start && s.date <= range.end),
    filtered = { ...w, sales, consignment_sales: [] }
  const collected = sales
      .filter((s) => !s.refundOf)
      .reduce((s, r) => s + (r.tax || 0), 0),
    payable = sales.reduce((s, r) => s + (r.tax || 0), 0)
  const unallocated = sales.filter((s) => s.tax > 0 && !s.taxSnapshot?.length)
  const missing = w.products.filter(
    (p) =>
      p.taxStatus !== 'exempt' &&
      p.taxStatus !== 'zero_rated' &&
      (() => {
        try {
          return !applicableTaxes(p, w.settings[0]).length
        } catch {
          return true
        }
      })(),
  )
  const changed =
    w.settings[0].taxRates?.filter(
      (r: any) => r.active !== false && r.end && r.end < range.end,
    ) || []
  const grouped = new Map<
    string,
    {
      id: string
      name: string
      rate: string
      taxable: number
      tax: number
      transactions: Item[]
      review: boolean
    }
  >()
  for (const sale of sales)
    for (const rate of sale.taxSnapshot?.length
      ? sale.taxSnapshot
      : sale.tax
        ? [
            {
              id: 'unallocated',
              jurisdiction: 'Unallocated',
              name: 'Legacy tax',
              ratePercent: 0,
              taxableBase: sale.amount,
              amount: sale.tax,
            },
          ]
        : []) {
      const key = `${rate.jurisdiction}-${rate.id}-${rate.ratePercent}`
      const row = grouped.get(key) || {
        id: key,
        name: rate.jurisdiction,
        rate: `${rate.ratePercent}% · ${rate.name}`,
        taxable: 0,
        tax: 0,
        transactions: [] as Item[],
        review: rate.id === 'unallocated',
      }
      row.taxable += rate.taxableBase
      row.tax += rate.amount
      row.transactions.push({ ...sale, allocatedTax: rate.amount })
      grouped.set(key, row)
    }
  return (
    <div className="tax-center-v2">
      <div className="section-toolbar">
        <label className="period-control">
          <Receipt size={18} />
          <span className="sr-only">Tax reporting period</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as DatePeriod)}
          >
            {datePeriods.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <span className="muted">
          {range.start} — {range.end}
        </span>
        <div className="toolbar-end">
          <button
            className="btn secondary"
            onClick={() => exportData(report, reportRows(report, filtered))}
          >
            <Download size={17} />
            Export report
          </button>
          <button className="btn" onClick={configure}>
            <Settings size={17} />
            Configure tax rates
          </button>
        </div>
      </div>
      {period === 'Custom' && (
        <div className="custom-dates">
          <label>
            From
            <input
              type="date"
              value={custom.start}
              max={custom.end}
              onChange={(e) => setCustom({ ...custom, start: e.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={custom.end}
              min={custom.start}
              onChange={(e) => setCustom({ ...custom, end: e.target.value })}
            />
          </label>
        </div>
      )}
      <div className="tax-metrics priority-grid">
        {[
          {
            name: 'Tax collected',
            value: money(collected),
            note: 'Before refund adjustments',
            icon: Receipt,
            tone: 'accent',
          },
          {
            name: 'Tax payable',
            value: money(payable),
            note: 'Collected less refunds · before remittances',
            icon: ShieldCheck,
            tone: 'success',
          },
          {
            name: 'Unallocated transactions',
            value: String(unallocated.length),
            note: unallocated.length
              ? 'Review before filing'
              : 'No unallocated tax in this period',
            icon: TriangleAlert,
            tone: unallocated.length ? 'warning' : 'success',
          },
        ].map(({ name, value, note, icon: Icon, tone }) => (
          <section className={`priority-card ${tone}`} key={name}>
            <span className="metric-label">
              <Icon size={20} />
              {name}
            </span>
            <strong>{value}</strong>
            <small>{note}</small>
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Tax by jurisdiction</h2>
            <p>Historical rates from recorded sales</p>
          </div>
          <span className="status blue">{sales.length} transactions</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Jurisdiction</th>
                <th>Rate</th>
                <th>Taxable sales</th>
                <th>Tax collected</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {[...grouped.values()].map((r) => (
                <tr key={r.id}>
                  <td data-label="Jurisdiction">
                    <strong>{r.name}</strong>
                  </td>
                  <td data-label="Rate">{r.rate}</td>
                  <td data-label="Taxable sales">{money(r.taxable)}</td>
                  <td data-label="Tax collected">{money(roundMoney(r.tax))}</td>
                  <td data-label="Status">
                    <span className={`status ${r.review ? 'amber' : 'green'}`}>
                      {r.review ? (
                        <TriangleAlert size={13} />
                      ) : (
                        <Check size={13} />
                      )}
                      {r.review ? 'Needs review' : 'Allocated'}
                    </span>
                  </td>
                  <td data-label="Details">
                    <details className="row-disclosure">
                      <summary>View details</summary>
                      {r.transactions.map((s, i) => (
                        <p key={s.id + i}>
                          {s.date} · {s.name} · {money(s.allocatedTax)}
                        </p>
                      ))}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!grouped.size && (
          <div className="calm-empty">
            <Receipt size={28} />
            <h3>No tax collected in this period.</h3>
            <p>Review your product tax setup or choose a different period.</p>
          </div>
        )}
      </section>
      {(unallocated.length > 0 || missing.length > 0 || changed.length > 0) && (
        <section className="review-panel">
          <div>
            <TriangleAlert size={22} />
            <h2>Needs review</h2>
          </div>
          {unallocated.length > 0 && (
            <p>
              {unallocated.length} transactions have tax amounts without a saved
              rate breakdown.
            </p>
          )}
          {missing.length > 0 && (
            <p>
              {missing.length} products have no active tax rates. Confirm
              whether they are exempt or need an assignment.
            </p>
          )}
          {changed.length > 0 && (
            <p>
              {changed.length} configured rates ended during or before this
              period. Review their replacements.
            </p>
          )}
          <button className="text-button" onClick={configure}>
            Review tax settings <ArrowRight size={16} />
          </button>
        </section>
      )}
      <section className="panel compact-export">
        <div>
          <h2>Ready for your records</h2>
          <p>Choose one report. Download as CSV.</p>
        </div>
        <label>
          <span className="sr-only">Tax export report</span>
          <select value={report} onChange={(e) => setReport(e.target.value)}>
            {[
              'Sales tax collected',
              'Sales tax by rate',
              'Sales tax by jurisdiction',
              'Tax-inclusive reconciliation',
              'Tax-exclusive reconciliation',
              'Tax-exempt / zero-rated sales',
              'Refund tax adjustments',
            ].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <button
          className="btn"
          onClick={() => exportData(report, reportRows(report, filtered))}
        >
          <Download size={17} />
          Export tax report
        </button>
      </section>
      <p className="tax-disclaimer">
        Tax settings and reports are for recordkeeping. Confirm requirements,
        rates, and filings with a qualified tax professional.
      </p>
      <details className="integration-footnote">
        <summary>
          <Plug size={17} />
          Tax reports &amp; exports{' '}
          <span className="status neutral">Available</span>
        </summary>
        <p>
          Reports are available for download. No tax service or filing
          integration exists. Cottage Pantry does not file or submit returns.
        </p>
      </details>
    </div>
  )
}
