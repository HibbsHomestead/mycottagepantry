import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import {
  detectSquare,
  squareCsv,
  squareFields,
  squareReportTotals,
  suggestSquare,
  reconcileSquare,
  type SquareOptions,
  type SquareBatch,
  type SquareChoice,
} from '@/lib/square-sales'
import type { Workspace } from '@/lib/domain'
import './square-sales-import.css'
const steps = [
  'Upload file',
  'Map columns',
  'Match products',
  'Review',
  'Confirm import',
]
export function SquareSalesImport({
  workspace: w,
  onWorkspace,
  ready,
  role,
  demo = false,
}: {
  workspace: Workspace
  onWorkspace: (w: Workspace) => void
  ready: boolean
  role: string
  demo?: boolean
}) {
  const [open, setOpen] = useState(false),
    [step, setStep] = useState(0),
    [csv, setCsv] = useState(''),
    [filename, setFilename] = useState(''),
    [options, setOptions] = useState<SquareOptions | null>(null),
    [batchId, setBatchId] = useState(''),
    [choices, setChoices] = useState<Record<string, SquareChoice>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [ack, setAck] = useState(false),
    [undo, setUndo] = useState(''),
    [inspect, setInspect] = useState('')
  const batches = (w.sales_imports || []) as SquareBatch[]
  const batch = batches.find((b) => b.id === batchId)
  const allowed = ready && ['Owner', 'Manager'].includes(role)
  async function action(name: string, data: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: name, table: 'sales_imports', data }),
      })
      const j = await r.json()
      if (!r.ok)
        throw new Error(j.error || 'Import could not be saved. Retry safely.')
      onWorkspace(j.workspace)
      return j.workspace as Workspace
    } catch (e) {
      setError((e as Error).message)
      throw e
    } finally {
      setBusy(false)
    }
  }
  async function load(text: string, name: string) {
    try {
      setOptions(detectSquare(text))
      setCsv(text)
      setFilename(name)
      setStep(1)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function next() {
    try {
      if (step === 1) {
        const updated = await action('squareStage', { csv, filename, options })
        const staged = (updated.sales_imports || []).find(
          (b) => b.name === filename && b.status === 'staged',
        ) as SquareBatch
        if (!staged) throw new Error('The staged import was not returned.')
        setBatchId(staged.id)
        setChoices(staged.choices)
        setStep(2)
      } else if (step === 2) {
        await action('squareReview', { id: batchId, choices })
        setAck(false)
        setStep(3)
      } else if (step === 3) setStep(4)
      else if (step === 4) {
        await action('squareCommit', {
          id: batchId,
          choices,
          confirm: true,
          acknowledge: ack,
        })
        setOpen(false)
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const mappedRows = batch
    ? [
        ...new Map(
          batch.rows
            .filter(() => batch.options.type === 'items')
            .map((r) => [r.mappingKey, r]),
        ).values(),
      ]
    : []
  const history = batches.find((b) => b.id === inspect)
  let unmatched: ReturnType<typeof reconcileSquare>['sales'] = []
  try {
    unmatched = reconcileSquare(batches).sales.filter(
      (s) => s.grain === 'item' && !s.productId,
    )
  } catch {
    /* Saved source records remain available for inspection if reconciliation needs review. */
  }
  return (
    <section className="square-import-access">
      <a className="btn secondary" href="#Settings/Integrations?integration=Square">Connect / manage Square</a>
      <div className="button-row">
        <button
          className="btn secondary"
          disabled={!allowed}
          onClick={() => {
            setOpen(true)
            setStep(0)
            setError('')
            setAck(false)
          }}
        >
          Import sales
        </button>
        <span>
          Square CSV · Reporting only
        </span>
      </div>
      {!!unmatched.length && (
        <details>
          <summary>Unmatched Square item sales ({unmatched.length})</summary>
          <p>
            Included in financial sales totals; excluded from matched product
            performance. Quantities below are Square selling units.
          </p>
          <div className="square-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Location</th>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Net sales</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map((s) => (
                  <tr key={s.id}>
                    <td>{s.date}</td>
                    <td>{s.location || 'Not provided'}</td>
                    <td>{s.name}</td>
                    <td>{s.sourceQuantity ?? 'Unknown'}</td>
                    <td>
                      {s.currency} {Number(s.amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {!!batches.length && (
        <details>
          <summary>Sales import history ({batches.length})</summary>
          <div className="square-table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    'File',
                    'Imported / staged',
                    'Period',
                    'Imported by',
                    'Status',
                    'Rows',
                    'Actions',
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>{b.importedAt || b.stagedAt}</td>
                    <td>{period(b)}</td>
                    <td>{b.importedBy || b.actor}</td>
                    <td>{b.status}</td>
                    <td>
                      {b.rows.length} valid · {b.errors.length} excluded
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setInspect(b.id)}
                      >
                        Inspect
                      </button>
                      {b.status === 'staged' && allowed && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            setBatchId(b.id)
                            setChoices(b.choices)
                            setOpen(true)
                            setStep(2)
                            setError('')
                          }}
                        >
                          Resume
                        </button>
                      )}
                      {b.status === 'committed' && allowed && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setUndo(b.id)}
                        >
                          Undo import
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v)
        }}
      >
        <DialogContent className="square-import-dialog">
          <DialogTitle>Import Square sales</DialogTitle>
          <DialogDescription>
            Upload and review before posting. This bakery’s seller sales are
            separate from Cottage Pantry subscription billing. No ingredients or
            packaging are deducted, and refunds never restock inventory.
          </DialogDescription>
          <ol className="square-steps">
            {steps.map((s, i) => (
              <li key={s} aria-current={step === i ? 'step' : undefined}>
                {i + 1}. {s}
              </li>
            ))}
          </ol>
          {error && (
            <p role="alert" className="warning-text">
              {error}
            </p>
          )}
          {step === 0 && (
            <>
              <p>
                Choose Square CSV: individual item-detail rows, transaction
                rows, or an aggregate summary. Aggregates stay separately
                identified in import history and never add to transaction
                totals. Up to 2 MB / 2,000 rows. Date and Net sales columns are
                required.
              </p>
              <label className="field">
                Square CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (f) {
                      if (f.size > 2_000_000)
                        setError('Choose a file up to 2 MB.')
                      else await load(await f.text(), f.name)
                    }
                  }}
                />
              </label>
              <details>
                <summary>Export from Square Dashboard</summary>
                <p>
                  Sign in to Square Dashboard, open Reports, choose the report
                  and date/location filters, then the export icon. Use the gear
                  icon to export all columns, then Start export for CSV. Choose
                  item-detail rows with transaction/order and line-item IDs for
                  product tracking. An Item Sales summary without sale
                  identifiers is aggregate data, not transaction detail. Headers
                  vary by region; review mappings below.
                </p>
                <a
                  href="https://squareup.com/help/us/en/article/8362-print-export-or-email-your-reports"
                  target="_blank"
                  rel="noreferrer"
                >
                  Square’s official export instructions
                </a>
                <p>
                  Verified 22 November 2026. No transaction status-page export
                  is assumed.
                </p>
              </details>
              {demo && (
                <div className="calculation-box">
                  <strong>Simulated Square fixtures · fictional data</strong>
                  <p>
                    Sample reports contain multiple items, locations, discounts,
                    tax, tips, a partial refund and overlapping sales. Nothing
                    imports until confirmation.
                  </p>
                  {['items', 'transactions', 'overlap', 'summary'].map(
                    (kind) => (
                      <button
                        key={kind}
                        className="text-button"
                        onClick={async () => {
                          try {
                            const r = await fetch(`/demo/square-${kind}.csv`)
                            if (!r.ok)
                              throw new Error('Sample file unavailable.')
                            await load(
                              await r.text(),
                              `simulated-square-${kind}.csv`,
                            )
                          } catch (e) {
                            setError((e as Error).message)
                          }
                        }}
                      >
                        Use simulated {kind} CSV
                      </button>
                    ),
                  )}
                </div>
              )}
            </>
          )}
          {step === 1 && options && (
            <>
              <p>
                {filename} · {squareCsv(csv).records.length} rows. Confirm the
                actual report grain. All money uses decimal points and two
                decimal places; local timestamps retain their wall-clock
                reporting date in the selected time zone.
              </p>
              <div className="square-mapping-grid">
                <label>
                  Report type
                  <select
                    value={options.type}
                    onChange={(e) =>
                      setOptions({
                        ...options,
                        type: e.target.value as SquareOptions['type'],
                      })
                    }
                  >
                    <option value="items">Individual item detail</option>
                    <option value="transactions">Transactions</option>
                    <option value="summary">Aggregate summary only</option>
                  </select>
                </label>
                <label>
                  Square seller reference
                  <input
                    value={options.account}
                    onChange={(e) =>
                      setOptions({ ...options, account: e.target.value })
                    }
                  />
                  <small>
                    Reuse this name for this seller’s later CSV files.
                  </small>
                </label>
                <label>
                  Currency for rows without a code
                  <input
                    maxLength={3}
                    value={options.currency}
                    onChange={(e) =>
                      setOptions({
                        ...options,
                        currency: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </label>
                <label>
                  Date format
                  <select
                    value={options.dateFormat}
                    onChange={(e) =>
                      setOptions({
                        ...options,
                        dateFormat: e.target
                          .value as SquareOptions['dateFormat'],
                      })
                    }
                  >
                    {['MDY', 'DMY', 'ISO'].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Reporting time zone
                  <input
                    value={options.timezone}
                    onChange={(e) =>
                      setOptions({ ...options, timezone: e.target.value })
                    }
                  />
                </label>
                <label>
                  Tax, tip, fee and service-charge columns on item reports
                  <select
                    value={options.extrasGrain}
                    onChange={(e) =>
                      setOptions({
                        ...options,
                        extrasGrain: e.target.value as 'transaction' | 'item',
                      })
                    }
                  >
                    <option value="transaction">
                      Whole transaction amounts (count once)
                    </option>
                    <option value="item">
                      Individual item amounts (sum items)
                    </option>
                  </select>
                </label>
                <label>
                  Processing fee signs
                  <select
                    value={options.feesSign || 'expense'}
                    onChange={(e) =>
                      setOptions({
                        ...options,
                        feesSign: e.target.value as 'expense' | 'deduction',
                      })
                    }
                  >
                    <option value="expense">
                      Positive amounts are expenses
                    </option>
                    <option value="deduction">
                      Negative amounts are deducted fees
                    </option>
                  </select>
                  <small>
                    Source values stay intact. The second choice reverses the
                    source fee sign for expense reporting, including fee
                    credits.
                  </small>
                </label>
                {squareFields.map((field) => (
                  <label key={field}>
                    {field.replace(/([A-Z])/g, ' $1').replace(/Id$/, 'ID')}
                    <select
                      value={options.columns[field] || ''}
                      onChange={(e) =>
                        setOptions({
                          ...options,
                          columns: {
                            ...options.columns,
                            [field]: e.target.value || undefined,
                          },
                        })
                      }
                    >
                      <option value="">Not present</option>
                      {squareCsv(csv).headers.map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                    <small>
                      Sample:{' '}
                      {options.columns[field]
                        ? squareCsv(csv).records[0][
                            options.columns[field]!
                          ].slice(0, 120)
                        : 'Unknown'}
                    </small>
                  </label>
                ))}
              </div>
            </>
          )}
          {step === 2 && batch && (
            <>
              <p>
                One Square unit means one sellable package unless you explicitly
                change the conversion. Names never imply pack sizes. Products
                from Food, Handmade, Resale and Kits are available. Leaving
                unmatched does not block financial reporting.
              </p>
              {!mappedRows.length && (
                <p>This report has no individual item rows to match.</p>
              )}
              {mappedRows.map((row) => {
                const c = choices[row.mappingKey] || {
                  productId: '',
                  multiplier: 1,
                }
                return (
                  <div className="square-product-match" key={row.mappingKey}>
                    <strong>
                      {row.item} {row.variation} · SKU{' '}
                      {row.sku || 'not provided'}
                    </strong>
                    <small>
                      {
                        suggestSquare(
                          row,
                          w.products,
                          w.sales_product_mappings || [],
                        ).suggestion
                      }
                    </small>
                    <label>
                      Cottage Pantry product
                      <select
                        value={c.productId}
                        onChange={(e) =>
                          setChoices({
                            ...choices,
                            [row.mappingKey]: {
                              ...c,
                              productId: e.target.value,
                            },
                          })
                        }
                      >
                        <option value="">Leave unmatched</option>
                        {w.products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {p.workflow || 'food'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Sellable packages per one Square unit
                      <input
                        type="number"
                        min="0.000001"
                        step="any"
                        value={c.multiplier}
                        onChange={(e) =>
                          setChoices({
                            ...choices,
                            [row.mappingKey]: {
                              ...c,
                              multiplier: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={c.save === true}
                        onChange={(e) =>
                          setChoices({
                            ...choices,
                            [row.mappingKey]: { ...c, save: e.target.checked },
                          })
                        }
                      />
                      Save mapping for future imports
                    </label>
                  </div>
                )
              })}
            </>
          )}
          {(step === 3 || step === 4) && batch && (
            <>
              <ImportReview batch={batch} choices={choices} />
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                I reviewed mappings, source amounts, unknown values, excluded
                rows and overlap warnings.
              </label>
              {step === 4 && (
                <p>
                  Confirming adds reporting records only. Historical product
                  costs are unavailable, so profit reports remain incomplete for
                  imported sales. No prices, recipe costs, purchase costs, stock
                  or bookkeeping journals change.
                </p>
              )}
            </>
          )}
          <div className="button-row">
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Close
            </button>
            {step > 0 && (
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => setStep(step === 4 ? 2 : step - 1)}
              >
                Back
              </button>
            )}
            {step > 0 && (
              <button
                type="button"
                className="btn"
                disabled={busy || !allowed || (step >= 3 && !ack)}
                onClick={next}
              >
                {busy
                  ? 'Saving…'
                  : step === 4
                    ? 'Import sales'
                    : step === 1
                      ? 'Stage file'
                      : step === 2
                        ? 'Review import'
                        : 'Continue to confirmation'}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!inspect}
        onOpenChange={(v) => {
          if (!v) setInspect('')
        }}
      >
        <DialogContent className="square-import-dialog">
          <DialogTitle>Imported source records</DialogTitle>
          <DialogDescription>
            Source values and audit history are retained. Aggregate data never
            claims individual transaction detail.
          </DialogDescription>
          {history && (
            <>
              <ImportReview batch={history} choices={history.choices} />
              <details>
                <summary>Original rows and provenance</summary>
                <div className="square-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>CSV row</th>
                        <th>Date</th>
                        <th>Transaction / order</th>
                        <th>Item</th>
                        <th>Source quantity</th>
                        <th>Original source cells</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.rows.map((r) => (
                        <tr key={r.row}>
                          <td>{r.row}</td>
                          <td>{r.date}</td>
                          <td>
                            {r.transactionId ||
                              r.orderId ||
                              r.paymentId ||
                              'Not provided'}
                          </td>
                          <td>{r.item}</td>
                          <td>{r.quantity ?? 'Unknown'}</td>
                          <td>
                            <pre>{JSON.stringify(r.raw, null, 2)}</pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <p>
                History:{' '}
                {(history.history || [])
                  .map((h: any) => `${h.action} · ${h.at} · ${h.actor}`)
                  .join('; ')}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!undo}
        onOpenChange={(v) => {
          if (!v) setUndo('')
        }}
      >
        <DialogContent>
          <DialogTitle>Undo this sales import?</DialogTitle>
          <DialogDescription>
            Removes only this import’s reporting contributions. Manual sales,
            audit history, saved product mappings and information supplied by
            other imports remain. Inventory stays unchanged.
          </DialogDescription>
          {error && <p role="alert">{error}</p>}
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => setUndo('')}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              try {
                await action('squareUndo', { id: undo, confirm: true })
                setUndo('')
              } catch {
                /* error remains visible */
              }
            }}
          >
            Confirm undo import
          </button>
        </DialogContent>
      </Dialog>
    </section>
  )
}
function period(batch: SquareBatch) {
  const dates = batch.rows.map((r) => r.date).sort()
  return dates.length ? `${dates[0]} – ${dates.at(-1)}` : 'Unknown'
}
function ImportReview({
  batch,
  choices,
}: {
  batch: SquareBatch
  choices: Record<string, SquareChoice>
}) {
  let data: ReturnType<typeof reconcileSquare> | null = null,
    totals: ReturnType<typeof squareReportTotals> = []
  try {
    data =
      batch.options.type === 'summary'
        ? null
        : reconcileSquare([{ ...batch, choices, status: 'committed' }])
    totals = squareReportTotals(batch, choices)
  } catch (e) {
    return <p role="alert">{(e as Error).message}</p>
  }

  return (
    <div className="square-import-review">
      <h3>{batch.name}</h3>
      <p>
        Square {batch.options.type} · {period(batch)} · Locations:{' '}
        {[...new Set(batch.rows.map((r) => r.location || 'Not provided'))].join(
          ', ',
        )}
      </p>
      <p>
        {data
          ? `${data.transactions} transaction groups · ${data.itemRows} item rows`
          : 'Aggregate rows only; transaction count unknown'}{' '}
        · {batch.rows.filter((r) => choices[r.mappingKey]?.productId).length}{' '}
        matched rows ·{' '}
        {
          batch.rows.filter(
            (r) =>
              batch.options.type === 'items' &&
              !choices[r.mappingKey]?.productId,
          ).length
        }{' '}
        unmatched item rows · {batch.errors.length} excluded rows
      </p>
      {batch.reviewImpact?.map((impact: any) => (
        <p key={impact.currency}>
          <strong>{impact.currency} sales change:</strong>{' '}
          {(impact.change / 100).toFixed(2)} (Square ledger total{' '}
          {(impact.before / 100).toFixed(2)} → {(impact.after / 100).toFixed(2)}
          ; manual sales unchanged)
        </p>
      ))}
      <h4>Amounts at report grain (currency shown, unknown values retained)</h4>
      {totals.map((t) => (
        <p key={t.currency}>
          <strong>{t.currency}</strong>:{' '}
          {Object.entries(t.values)
            .map(
              ([k, v]) =>
                `${k}: ${v === null ? 'Unknown' : (v / 100).toFixed(2)}`,
            )
            .join(' · ')}
        </p>
      ))}
      <p>
        Existing duplicate source records identified:{' '}
        {batch.duplicates ?? 'Review pending'}. Complementary reports enrich the
        same sale. Transaction tax/fees are counted once; item-to-transaction
        differences stay unallocated.
      </p>
      <ul>
        {[
          ...new Set([
            ...batch.warnings,
            ...batch.errors,
            ...(data?.warnings || []),
          ]),
        ].map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  )
}
