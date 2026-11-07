import { useState } from 'react'
import { ovenTimestamp } from '@/lib/oven-dates'
import { receivedDateReview } from '@/lib/received-dates'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { money, type Workspace, type Item } from '@/lib/domain'
import { tracksFinishedStock } from '@/lib/product-workflows'
import { PantryPhoto } from './pantry-photo'
import {
  stockEntrySummary,
  stockUnitLabel,
  suspiciousResaleCounts,
} from '@/lib/resale-stock'
export function FinishedInventory({
  workspace,
  open,
  role,
  search,
}: {
  workspace: Workspace
  open: (kind: string, item?: Item) => void
  role: string
  search: string
}) {
  const items = workspace.products.filter(
    (p) =>
      tracksFinishedStock(p) &&
      p.name.toLowerCase().includes(search.toLowerCase()),
  )
  const canMove = ['Owner', 'Manager', 'Production Staff'].includes(role)
  const suspicious = suspiciousResaleCounts(workspace)
  return (
    <>
      <p className="form-hint">
        Sellable items from handmade production and resale purchases. Legacy
        food products retain their existing batch workflow; no opening balances
        are inferred.
      </p>
      {suspicious.length > 0 && (
        <details className="panel resale-count-review">
          <summary>
            Review {suspicious.length} possible pack-count{' '}
            {suspicious.length === 1 ? 'mistake' : 'mistakes'}
          </summary>
          <p className="form-hint">
            Nothing has been changed. These counts may include pack contents
            multiplied twice. Approve a correction only after checking the
            shelf. Corrections use Adjust stock, which records an inventory
            ledger entry and audit record, and posts the value difference under
            your current adjustment accounting (inventory shrink for a
            decrease). Ask your accountant if the original entry should instead
            be reversed against its opening entry.
          </p>
          <ul>
            {suspicious.map((s) => (
              <li key={s.product.id}>
                <strong>{s.product.name}</strong>: {s.current} on hand.{' '}
                {s.reason} Proposed count: {s.proposed}.
                {canMove && s.product.stockCostKnown && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() =>
                        open('trade-adjust', {
                          ...s.product,
                          proposedAdjustment: s.proposed - s.current,
                          reason: `Owner-approved pack-count correction: ${s.current} → ${s.proposed}`,
                        })
                      }
                    >
                      Review correction
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="pantry-card-grid">
        {items.map((p) => (
          <article className="panel pantry-card" key={p.id}>
            <div className="pantry-card-top">
              <span
                className={`status ${Number(p.quantity || 0) <= Number(p.threshold || 0) ? 'amber' : 'green'}`}
              >
                {Number(p.quantity || 0) <= Number(p.threshold || 0)
                  ? 'Reorder'
                  : 'In stock'}
              </span>
            </div>
            <div className="pantry-card-photo-button">
              <PantryPhoto
                item={p}
                assets={workspace.graphic_assets || []}
                kind="product"
              />
            </div>
            <div className="pantry-card-main">
              <h2>{p.name}</h2>
              <p>
                {p.workflow} {p.variant && `· ${p.variant}`}{' '}
                {p.sku && `· ${p.sku}`}
              </p>
              <dl>
                <dt>On hand</dt>
                <dd>
                  {p.quantity || 0}{' '}
                  {p.workflow === 'resale'
                    ? stockUnitLabel(p, Number(p.quantity || 0))
                    : 'each'}
                </dd>
                <dt>Average unit cost</dt>
                <dd>
                  {p.stockCostKnown
                    ? money(p.cost)
                    : 'Awaiting receipt / production'}
                </dd>
                {p.stockEntry?.quantity > 0 && (
                  <>
                    <dt>
                      {p.stockEntry.choice === 'purchase'
                        ? 'First purchase'
                        : 'Starting stock'}
                    </dt>
                    <dd>{stockEntrySummary(p.stockEntry)}</dd>
                  </>
                )}
                <dt>Reorder threshold</dt>
                <dd>{p.threshold || 0}</dd>
                {p.workflow === 'resale' && p.purchaseQuantity && (
                  <>
                    <dt>Last purchase</dt>
                    <dd>
                      {p.purchaseQuantity} {p.purchaseUnit} × {p.itemsPerUnit}{' '}
                      {stockUnitLabel(p, Number(p.itemsPerUnit))} ·{' '}
                      {money(p.purchaseCost)}
                    </dd>
                    <dt>Supplier</dt>
                    <dd>
                      {workspace.vendors.find((v) => v.id === p.supplierId)
                        ?.name || 'Not assigned'}
                    </dd>
                  </>
                )}
              </dl>
            </div>
            <footer>
              {canMove && (
                <>
                  {p.workflow === 'resale' && (
                    <button
                      className="btn"
                      onClick={() => open('trade-receive', p)}
                    >
                      Receive stock
                    </button>
                  )}
                  <button
                    className="btn secondary"
                    onClick={() => open('trade-adjust', p)}
                  >
                    Adjust stock
                  </button>
                </>
              )}
            </footer>
          </article>
        ))}
      </div>
      {!items.length && (
        <div className="calm-empty">
          <h3>No tracked finished goods yet</h3>
          <p>
            Create a handmade or resale product, then complete production or
            receive stock.
          </p>
        </div>
      )}
    </>
  )
}
export function HandmadeProduction({
  workspace,
  open,
  role,
}: {
  workspace: Workspace
  open: (kind: string, item?: Item) => void
  role: string
}) {
  const designs = workspace.recipes.filter((r) => r.workflow === 'handmade')
  const runs = workspace.batches.filter((b) =>
    designs.some((r) => r.id === b.recipeId),
  )
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Handmade production</h2>
          <p>
            Actual material use, waste and finished stock in one transaction.
          </p>
        </div>
        {['Owner', 'Manager'].includes(role) && (
          <button className="btn" onClick={() => open('trade-run')}>
            Plan handmade run
          </button>
        )}
      </div>
      {runs.map((b) => (
        <div className="batch-row" key={b.id}>
          <div>
            <strong>{b.name}</strong>
            <p>
              {b.date} ·{' '}
              {b.status === 'completed'
                ? `${b.actualYield} good items · ${b.waste || 0} wasted · ${money(b.historicalCost)} locked cost`
                : `${b.yield} planned`}
            </p>
          </div>
          {b.status !== 'completed' &&
            ['Owner', 'Manager', 'Production Staff'].includes(role) && (
              <button
                className="btn secondary"
                onClick={() => open('trade-complete', b)}
              >
                Complete production
              </button>
            )}
          {b.status === 'completed' && (
            <details className="calculation-box">
              <summary>Locked production costs</summary>
              <p>
                Materials {money(b.costSnapshot?.ingredient || 0)} · labor{' '}
                {b.costSnapshot?.laborMinutes} minutes at{' '}
                {money(b.costSnapshot?.laborRate || 0)}/hour · other{' '}
                {money(b.costSnapshot?.overhead || 0)}
              </p>
              <p>Cost per good item: {money(b.costSnapshot?.perItem || 0)}</p>
              {(b.usage || []).map((line: Item) => (
                <p key={line.ingredientId}>
                  {line.name}: {line.used} used + {line.wasted} waste{' '}
                  {line.enteredUnit} · {money(line.cost)}
                </p>
              ))}
              {b.wasteReason && <p>{b.wasteReason}</p>}
            </details>
          )}
        </div>
      ))}
      {!runs.length && (
        <p className="calm-empty">
          Save a design and handmade product, then plan a production run.
        </p>
      )}
    </section>
  )
}

export function PurchaseStockReceipts({
  workspace,
  open,
  role,
  correctDate,
}: {
  workspace: Workspace
  open: (kind: string, item?: Item) => void
  role: string
  correctDate?: (data: Record<string, Item[string]>) => Promise<void>
}) {
  const [record, setRecord] = useState<Item | null>(null)
  const [date, setDate] = useState(''),
    [reason, setReason] = useState(''),
    [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [operationId, setOperationId] = useState('')
  const resale = workspace.products.filter((p) => p.workflow === 'resale')
  const receipts = workspace.ledger
    .filter((l) => l.type === 'purchase_receipt')
    .sort(
      (a, b) =>
        (b.receivedDate || b.date || '').localeCompare(
          a.receivedDate || a.date || '',
        ) ||
        (b.addedAt || b.occurredAt || '').localeCompare(
          a.addedAt || a.occurredAt || '',
        ),
    )
    .slice(0, 20)
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Inventory purchase receipts</h2>
          <p>
            Shared receipt history for ingredients, craft materials, packaging
            and resale goods. Purchase orders remain planning records; line
            receiving is unavailable.
          </p>
        </div>
      </div>
      {['Owner', 'Manager', 'Production Staff'].includes(role) && (
        <div className="toolbar">
          <button
            className="btn secondary"
            onClick={() => open('receive-picker')}
          >
            Receive input stock
          </button>
          {resale.length > 0 && (
            <label className="field">
              <span>Receive resale stock</span>
              <select
                defaultValue=""
                onChange={(event) => {
                  const product = resale.find(
                    (p) => p.id === event.target.value,
                  )
                  if (product) open('trade-receive', product)
                  event.target.value = ''
                }}
              >
                <option value="">Choose resale product…</option>
                {resale.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {receipts.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Received</th>
                <th>Acquisition cost</th>
                <th>Received date</th>
                <th>Purchase date</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td>
                    {l.quantity} {l.unit}
                  </td>
                  <td>{money(l.amount)}</td>
                  <td>
                    {l.receivedDate || l.date}
                    {receivedDateReview(l, workspace.settings[0]) && (
                      <small> · Local date needs review</small>
                    )}
                    <button
                      className="text-button"
                      onClick={() => {
                        setRecord(l)
                        setDate(
                          receivedDateReview(l, workspace.settings[0]) ||
                            l.receivedDate ||
                            l.date,
                        )
                        setReason('')
                        setApproved(false)
                        setError('')
                        setOperationId(crypto.randomUUID())
                      }}
                    >
                      Details / review date
                    </button>
                  </td>
                  <td>{l.purchaseDate || 'Not recorded'}</td>
                  <td>{l.sourceId || l.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="calm-empty">
          Purchase stock receipts appear here after receiving. Uploading a
          receipt alone does not add stock.
        </p>
      )}
      {record && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setRecord(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Purchase receipt details</DialogTitle>
              <DialogDescription>
                Calendar dates and the original system timestamp are kept
                separately. A date correction adds an audit annotation; stock
                and accounting entries stay intact.
              </DialogDescription>
            </DialogHeader>
            <p>
              <strong>{record.name}</strong>
            </p>
            <p>
              Added at:{' '}
              {ovenTimestamp(
                record.addedAt || record.occurredAt,
                workspace.settings[0],
              )}
            </p>
            <p>
              Received date: {record.receivedDate || record.date} · Purchase
              date: {record.purchaseDate || 'Not recorded'}
            </p>
            {record.dateCorrection && (
              <p>
                Original date: {record.originalReceivedDate}. Approved{' '}
                {ovenTimestamp(record.dateCorrection.at, workspace.settings[0])}
                : {record.dateCorrection.reason}
              </p>
            )}
            {receivedDateReview(record, workspace.settings[0]) && (
              <p>
                Proposed received date:{' '}
                {receivedDateReview(record, workspace.settings[0])}, based on
                when this entry was added in the Oven timezone. Confirm the
                physical receiving date; the upload time alone cannot establish
                it.
              </p>
            )}
            {correctDate && ['Owner', 'Manager'].includes(role) && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (busy) return
                  setBusy(true)
                  setError('')
                  try {
                    await correctDate({
                      id: record.id,
                      expectedDate: record.receivedDate || record.date,
                      receivedDate: date,
                      reason,
                      confirmed: approved,
                      operationId,
                    })
                    setRecord(null)
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : 'Correction failed. Your entries are preserved.',
                    )
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <label className="field">
                  <span>Correct received date</span>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Correction reason</span>
                  <input
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={(e) => setApproved(e.target.checked)}
                  />{' '}
                  I approve this received date correction.
                </label>
                {error && <p role="alert">{error}</p>}
                <button className="btn" disabled={busy || !approved}>
                  {busy ? 'Saving…' : 'Approve date correction'}
                </button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
