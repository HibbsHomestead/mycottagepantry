import { useId, useState } from 'react'
import { Snowflake } from 'lucide-react'
import { convert, money, type Item, type Workspace } from '@/lib/domain'
import { inventoryQuantity } from '@/lib/inventory-quantity'
import { ovenToday } from '@/lib/oven-dates'
import {
  activePrepLots,
  canPrepStock,
  planStockPrep,
  prepLots,
  prepOutputUnits,
  prepReviewKey,
  prepSourceUnit,
  prepStockBalance,
  UNPORTIONED,
  type StockPrepPlan,
} from '@/lib/stock-prep'
import { FormErrorNotice } from './form-error-notice'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import './stock-prep.css'

export function PrepStockSourceSelect({
  ingredient,
  lots,
  value,
  change,
  disabled,
}: {
  ingredient?: Item
  lots: Item[]
  value?: string
  change: (source: string) => void
  disabled?: boolean
}) {
  const labelId = useId()
  if (!ingredient) return null
  const available = activePrepLots(lots, ingredient.id)
  if (!available.length && !value) return null
  let fresh: number | undefined
  try {
    fresh = prepStockBalance(ingredient, lots).available
  } catch {
    /* The posted check reports inconsistent balances. */
  }
  return (
    <label className="field stock-prep-source">
      <span id={labelId}>Stock source · {ingredient.name}</span>
      <select
        aria-labelledby={labelId}
        aria-describedby={`${labelId}-help`}
        value={value || ''}
        onChange={(e) => change(e.target.value)}
        disabled={disabled}
      >
        <option value="">Choose stock source…</option>
        <option value={UNPORTIONED}>
          Unportioned ·{' '}
          {fresh === undefined
            ? 'review balance'
            : `${inventoryQuantity(fresh)} ${ingredient.unit}`}
        </option>
        {available.map((lot) => (
          <option key={lot.id} value={lot.id}>
            {lot.location} · {lot.date} · {inventoryQuantity(lot.quantity)}{' '}
            {lot.unit} remaining · Ref {lot.id.slice(-6)}
          </option>
        ))}
        {value &&
          value !== UNPORTIONED &&
          !available.some((l) => l.id === value) && (
            <option value={value}>
              Previously selected prepared lot is unavailable
            </option>
          )}
      </select>
      <small id={`${labelId}-help`}>
        Choose one source for this ingredient line. Enter actual use in the
        recipe unit. A selected lot uses the first open portion before opening
        another.
      </small>
    </label>
  )
}

export function StockPrepPanel({
  ingredient,
  workspace,
  save,
  canEdit,
}: {
  ingredient: Item
  workspace: Workspace
  save: (action: string, data: Record<string, unknown>) => Promise<void>
  canEdit: boolean
}) {
  const today = ovenToday(workspace.settings[0])
  const sourceUnit = prepSourceUnit(ingredient)
  const [form, setForm] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'post' | 'reverse' | ''>('')
  const [review, setReview] = useState<StockPrepPlan | null>(null)
  const [reversal, setReversal] = useState<Item | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const lots = prepLots(workspace.lots, ingredient.id)
  if (!canPrepStock(ingredient) && !lots.length) return null
  let available: number | undefined
  try {
    available = prepStockBalance(ingredient, workspace.lots).available
  } catch {
    /* Show a review state below. */
  }
  const change = (key: string, value: string) => {
    setForm({ ...form, [key]: value })
    setReview(null)
    setError('')
  }
  const start = (lot?: Item) => {
    setMode(lot ? 'reverse' : 'post')
    setReversal(lot || null)
    setConfirmed(false)
    setReview(null)
    setError('')
    setNotice('')
    setForm({
      operationId: crypto.randomUUID(),
      date: today,
      outputUnit: sourceUnit,
    })
  }
  const input = (
    key: string,
    label: string,
    options: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <label className="field">
      <span>{label}</span>
      <input
        value={form[key] || ''}
        onChange={(e) => change(key, e.target.value)}
        {...options}
      />
    </label>
  )
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError('')
    if (mode === 'post' && !review) {
      try {
        setReview(planStockPrep(ingredient, workspace.lots, form, today))
      } catch (e) {
        setError((e as Error).message)
      }
      return
    }
    setBusy(true)
    try {
      if (mode === 'post' && review) {
        await save('stockPrepPost', {
          ...form,
          id: ingredient.id,
          review: prepReviewKey(review),
        })
        setNotice(
          `Prep recorded. ${review.portions} ${review.portions === 1 ? 'portion' : 'portions'} in ${review.location}.`,
        )
      } else if (reversal) {
        await save('stockPrepReverse', {
          id: ingredient.id,
          operationId: form.operationId,
          lotId: reversal.id,
          reason: form.reason,
          confirmPhysicalStock: confirmed,
        })
        setNotice('Prep reversed. The correction is recorded in stock history.')
      }
      setMode('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="stock-prep-panel ingredient-section"
      aria-label="Prepared stock"
    >
      <div className="stock-prep-heading">
        <div>
          <h3>Prepared stock</h3>
          <p className="muted">
            Portions stay part of {ingredient.name} and are included in the
            on-hand total.
          </p>
        </div>
        {canEdit && canPrepStock(ingredient) && (
          <button
            type="button"
            className="btn secondary"
            onClick={() => start()}
          >
            <Snowflake size={17} aria-hidden="true" /> Prep / Portion Stock
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {available !== undefined && (
        <p>
          <strong>
            {inventoryQuantity(available)} {ingredient.unit}
          </strong>{' '}
          unportioned
        </p>
      )}
      {!!lots.length && (
        <ul className="stock-prep-lots">
          {[...lots].reverse().map((lot) => (
            <li key={lot.id}>
              <div>
                <strong>
                  {lot.name} · {lot.location}
                </strong>
                <p>
                  {lot.date}
                  {lot.expires ? ` · Best before ${lot.expires}` : ''}
                  {' · Ref '}
                  {lot.id.slice(-6)}
                </p>
                <p>
                  {inventoryQuantity(lot.quantity)} {lot.unit} remaining ·{' '}
                  {lot.balances.filter((q: number) => q > 0).length} of{' '}
                  {lot.portions} portions left
                </p>
                {lot.note && <p>{lot.note}</p>}
                {lot.usedInProduction && (
                  <p className="muted">
                    Some stock was used. This prep can no longer be reversed.
                  </p>
                )}
                <details>
                  <summary>Portion balances</summary>
                  <ol>
                    {lot.balances.map((q: number, index: number) => (
                      <li key={index}>
                        {inventoryQuantity(q)} {lot.unit}
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
              {canEdit && !lot.usedInProduction && lot.quantity > 0 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => start(lot)}
                >
                  Reverse prep
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={Boolean(mode)}
        onOpenChange={(open) => {
          if (!open && !busy) setMode('')
        }}
      >
        <DialogContent className="stock-prep-dialog">
          <DialogHeader>
            <DialogTitle>
              {mode === 'reverse' ? 'Reverse prep' : 'Prep / Portion Stock'}
            </DialogTitle>
            <DialogDescription>
              {ingredient.name} ·{' '}
              {mode === 'reverse'
                ? 'Correct an untouched prep entry with a linked stock movement.'
                : 'Move stock into portions under the same ingredient.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            {mode === 'reverse' && reversal ? (
              <fieldset disabled={busy}>
                <p>
                  Return {inventoryQuantity(reversal.used)} {reversal.unit} to
                  unportioned stock and remove the {reversal.portions} prepared
                  portions at {reversal.location}.
                </p>
                {!!reversal.loss && (
                  <p>
                    Only reverse a mistaken entry. This would also restore the
                    recorded loss of {inventoryQuantity(reversal.loss)}{' '}
                    {reversal.unit}.
                  </p>
                )}
                {input('reason', 'Reason for reversal', {
                  required: true,
                  maxLength: 200,
                })}
                <label className="stock-prep-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    required
                  />{' '}
                  I verified that the full original quantity is physically
                  available.
                </label>
              </fieldset>
            ) : review ? (
              <div className="stock-prep-review">
                <h3>Review the stock movement</h3>
                <dl>
                  <div>
                    <dt>Unportioned stock used</dt>
                    <dd>
                      {inventoryQuantity(review.enteredUsed)}{' '}
                      {review.sourceUnit}
                    </dd>
                  </div>
                  <div>
                    <dt>Prepared stock created</dt>
                    <dd>
                      {review.portions} × {inventoryQuantity(review.perPortion)}{' '}
                      {review.outputUnit}
                      {!review.hasMeasurement &&
                        ' allocated per portion'} · {review.location}
                    </dd>
                  </div>
                  <div>
                    <dt>Unportioned stock left</dt>
                    <dd>
                      {inventoryQuantity(review.remaining)} {review.unit}
                    </dd>
                  </div>
                  <div>
                    <dt>Total on hand after prep</dt>
                    <dd>
                      {inventoryQuantity(review.totalAfter)} {review.unit}
                    </dd>
                  </div>
                  <div>
                    <dt>Cost carried into portions</dt>
                    <dd>{money(review.carriedCost)}</dd>
                  </div>
                  <div>
                    <dt>Measured loss</dt>
                    <dd>
                      {inventoryQuantity(review.enteredLoss)}{' '}
                      {review.sourceUnit}
                      {review.loss ? ` · ${review.lossReason}` : ''}
                    </dd>
                  </div>
                </dl>
                <p>
                  {review.date}
                  {review.expires
                    ? ` · Best before ${review.expires}`
                    : ''} · {review.method}
                </p>
                {review.note && <p>{review.note}</p>}
                <p className="muted">
                  {review.loss
                    ? 'The full cost of the source stock is carried into the usable portions. The measured loss has no separate expense.'
                    : 'Total stock quantity and value stay the same. No purchase, sale, or expense is recorded.'}
                </p>
              </div>
            ) : (
              <fieldset disabled={busy}>
                <p>
                  Source: unportioned stock
                  {ingredient.storageLocation
                    ? ` · ${ingredient.storageLocation}`
                    : ''}
                  .{' '}
                  {available === undefined
                    ? 'Review the inventory balance.'
                    : `${inventoryQuantity(convert(available, ingredient.unit, sourceUnit, ingredient.conversions))} ${sourceUnit} available.`}
                </p>
                <div className="form-grid">
                  {input('used', `Quantity used (${sourceUnit})`, {
                    type: 'number',
                    min: '0.00000001',
                    step: 'any',
                    required: true,
                  })}
                  {input('portions', 'Number of portions', {
                    type: 'number',
                    min: 1,
                    max: 200,
                    step: 1,
                    required: true,
                  })}
                  {input(
                    'perPortion',
                    'Measured amount per portion (optional)',
                    { type: 'number', min: '0.00000001', step: 'any' },
                  )}
                  <label className="field">
                    <span>Portion unit</span>
                    <select
                      value={form.outputUnit || ingredient.unit}
                      onChange={(e) => change('outputUnit', e.target.value)}
                      disabled={!form.perPortion}
                    >
                      {prepOutputUnits(ingredient).map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </label>
                  {input('method', 'Preparation method', {
                    required: true,
                    placeholder: 'Portioned and frozen',
                    maxLength: 200,
                  })}
                  {input('location', 'Destination storage location', {
                    required: true,
                    placeholder: 'Freezer',
                    maxLength: 200,
                  })}
                  {input('date', 'Prep date', {
                    type: 'date',
                    required: true,
                    max: today,
                  })}
                  {input('expires', 'Best-before (optional)', {
                    type: 'date',
                    min: form.date,
                  })}
                </div>
                <p className="muted">
                  Use the actual source amount. If you leave the measured amount
                  blank, stock is allocated equally across portions in{' '}
                  {ingredient.unit}. Keep approximate amounts in the note.
                </p>
                <label className="field">
                  <span>Descriptive note (optional)</span>
                  <textarea
                    value={form.note || ''}
                    onChange={(e) => change('note', e.target.value)}
                    placeholder="4 bananas, approximately 2 cups"
                    maxLength={1000}
                  />
                </label>
                <details open={Number(form.loss) > 0 || undefined}>
                  <summary>Record measured prep loss (optional)</summary>
                  <p>
                    Freezing is not a loss. If stock already represents the
                    edible amount, do not deduct peel again.
                  </p>
                  <div className="form-grid">
                    {input('loss', `Measured loss (${sourceUnit})`, {
                      type: 'number',
                      min: 0,
                      step: 'any',
                    })}
                    {input('lossReason', 'Loss reason', {
                      required: Number(form.loss) > 0,
                      maxLength: 200,
                    })}
                  </div>
                </details>
              </fieldset>
            )}
            <FormErrorNotice message={error} />
            <div className="button-row stock-prep-actions">
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  if (review) {
                    setReview(null)
                    setError('')
                  } else setMode('')
                }}
              >
                {review ? 'Edit details' : 'Cancel'}
              </button>
              <button
                className="btn"
                type="submit"
                disabled={busy || (mode === 'reverse' && !confirmed)}
              >
                {busy
                  ? 'Saving…'
                  : mode === 'reverse'
                    ? 'Confirm reversal'
                    : review
                      ? 'Confirm prep'
                      : 'Review prep'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
