import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Boxes } from 'lucide-react'
import {
  convert,
  ingredientUnits,
  money,
  type Item,
  type Workspace,
} from '@/lib/domain'
import { inventoryQuantity } from '@/lib/inventory-quantity'
import { ovenToday } from '@/lib/oven-dates'
import {
  activePrepLots,
  isFoodStockPrep,
  planStockPrep,
  prepLots,
  prepOutputUnits,
  prepReviewKey,
  prepSourceUnit,
  prepStockBalance,
  stockPrepUnavailable,
  StockPrepValidationError,
  UNPORTIONED,
  type StockPrepPlan,
} from '@/lib/stock-prep'
import { FormErrorNotice } from './form-error-notice'
import { matchingPreparedLots, preparedLabel, preparedMeasureUnit, type PreparedRequirement } from '@/lib/prepared-requirement'
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
  requirement,
  requiredQuantity,
}: {
  ingredient?: Item
  lots: Item[]
  value?: string
  change: (source: string) => void
  disabled?: boolean
  requirement?: PreparedRequirement
  requiredQuantity?: number
}) {
  const labelId = useId()
  if (!ingredient) return null
  const active = activePrepLots(lots, ingredient.id)
  const available = requirement ? matchingPreparedLots(ingredient, active, requirement) : active
  if (!available.length && !value && !requirement) return null
  let fresh: number | undefined
  let requiredPortions: number | undefined
  try {
    fresh = prepStockBalance(ingredient, lots).available
    if (requirement && requiredQuantity != null)
      requiredPortions = requiredQuantity / convert(requirement.perPortion, requirement.outputUnit, ingredient.unit, ingredient.conversions)
  } catch {
    /* The posted check reports inconsistent balances. */
  }
  return (
    <label className="field stock-prep-source">
      <span id={labelId}>{requirement ? `Prepared stock · ${preparedLabel(ingredient, requirement)}` : `Stock source · ${ingredient.name}`}</span>
      {requiredPortions !== undefined && <small>{inventoryQuantity(requiredPortions)} portion equivalents needed ({inventoryQuantity(requiredQuantity)} {preparedMeasureUnit(ingredient.unit)})</small>}
      <select
        aria-labelledby={labelId}
        aria-describedby={`${labelId}-help`}
        value={value || ''}
        onChange={(e) => change(e.target.value)}
        disabled={disabled}
      >
        <option value="">Choose stock source…</option>
        {!requirement && <option value={UNPORTIONED}>
          Unportioned ·{' '}
          {fresh === undefined
            ? 'review balance'
            : `${inventoryQuantity(fresh)} ${ingredient.unit}`}
        </option>}
        {available.map((lot) => (
          <option key={lot.id} value={lot.id}>
            {lot.location} · {lot.date} · {inventoryQuantity(lot.quantity)}{' '}
            {requirement ? preparedMeasureUnit(lot.unit) : lot.unit} remaining · Ref {lot.id.slice(-6)}
            {lot.expires && ` · Best before ${lot.expires}`}
            {requirement && ` · ${inventoryQuantity(lot.quantity / (lot.usable / lot.portions))} portion equivalents`}
            {requiredQuantity != null && lot.quantity + 1e-8 < requiredQuantity && ' · Insufficient'}
          </option>
        ))}
        {value &&
          (value !== UNPORTIONED || requirement) &&
          !available.some((l) => l.id === value) && (
            <option value={value}>
              Previously selected prepared lot is unavailable
            </option>
          )}
      </select>
      <small id={`${labelId}-help`}>
        {requirement && !available.some((lot) => lot.quantity + 1e-8 >= (requiredQuantity || 0))
          ? 'Not enough matching prepared stock in one lot. Use Prep / Portion Stock in inventory to prepare more, or change the allocation. Unportioned stock is not used.'
          : 'Choose one source for this line. Enter actual use in the line’s unit. A selected lot uses the first open portion before opening another.'}
      </small>
    </label>
  )
}

export function StockPrepPanel({
  ingredient,
  workspace,
  save,
  canEdit,
  onStandaloneClose,
}: {
  ingredient: Item
  workspace: Workspace
  save: (action: string, data: Record<string, unknown>) => Promise<void>
  canEdit: boolean
  onStandaloneClose?: () => void
}) {
  const today = ovenToday(workspace.settings[0])
  const sourceUnit = prepSourceUnit(ingredient)
  const newForm = () => ({
    operationId: crypto.randomUUID(),
    date: today,
    outputUnit: sourceUnit,
  })
  const [form, setForm] = useState<Record<string, string>>(() =>
    onStandaloneClose ? newForm() : {},
  )
  const [mode, setMode] = useState<'post' | 'reverse' | ''>(
    onStandaloneClose ? 'post' : '',
  )
  const [review, setReview] = useState<StockPrepPlan | null>(null)
  const [reversal, setReversal] = useState<Item | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [notice, setNotice] = useState('')
  const [lossOpen, setLossOpen] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const fieldId = useId()
  const food = isFoodStockPrep(ingredient)
  const lots = prepLots(workspace.lots, ingredient.id)
  const unavailable = stockPrepUnavailable(ingredient, workspace.lots)
  const units = mode === 'post' && !review ? prepOutputUnits(ingredient) : []
  const otherUnits =
    mode === 'post' && !review
      ? Object.keys(ingredientUnits(ingredient.conversions)).filter(
          (unit) => !units.includes(unit),
        )
      : []
  useEffect(() => {
    if (error && body.current)
      body.current.scrollTop = body.current.scrollHeight
  }, [error])

  let available: number | undefined
  try {
    available = prepStockBalance(ingredient, workspace.lots).available
  } catch {
    /* Show a review state below. */
  }
  const change = (key: string, value: string) => {
    setForm({ ...form, [key]: value })
    setReview(null)
    setError(null)
  }
  const start = (lot?: Item) => {
    setMode(lot ? 'reverse' : 'post')
    setReversal(lot || null)
    setConfirmed(false)
    setReview(null)
    setError(null)
    setLossOpen(false)
    setNotice('')
    setForm(newForm())
  }
  const close = () => {
    setMode('')
    onStandaloneClose?.()
  }
  const invalid = (key: string) =>
    error instanceof StockPrepValidationError && error.fields.includes(key)
  const input = (
    key: string,
    label: string,
    options: React.InputHTMLAttributes<HTMLInputElement> = {},
    help?: ReactNode,
  ) => (
    <div className="field">
      <label htmlFor={`${fieldId}-${key}`}>{label}</label>
      <input
        id={`${fieldId}-${key}`}
        name={key}
        value={form[key] || ''}
        onChange={(e) => change(key, e.target.value)}
        aria-invalid={invalid(key) || undefined}
        aria-describedby={
          [help && `${fieldId}-${key}-help`, invalid(key) && `${fieldId}-error`]
            .filter(Boolean)
            .join(' ') || undefined
        }
        {...options}
      />
      {help && <small id={`${fieldId}-${key}-help`}>{help}</small>}
    </div>
  )
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (mode === 'post' && !review) {
      try {
        const malformed = Array.from(
          e.currentTarget.querySelectorAll('input'),
        ).find((input) => input.validity.badInput)
        if (malformed)
          throw new StockPrepValidationError(
            'Enter a valid value in the highlighted field before reviewing prep.',
            [malformed.name],
          )
        setReview(planStockPrep(ingredient, workspace.lots, form, today))
      } catch (e) {
        setError(e as Error)
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
      close()
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {!onStandaloneClose && (
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
            {canEdit && (
              <button
                type="button"
                className="btn secondary"
                disabled={Boolean(unavailable)}
                onClick={() => start()}
              >
                <Boxes size={17} aria-hidden="true" /> Prep / portion stock
              </button>
            )}
          </div>
          {canEdit && unavailable && <p className="muted">{unavailable}</p>}
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
                        Some stock was used. This prep can no longer be
                        reversed.
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
        </section>
      )}
      <Dialog
        open={Boolean(mode)}
        onOpenChange={(open) => {
          if (!open && !busy) close()
        }}
      >
        <DialogContent className="stock-prep-dialog">
          <DialogHeader>
            <DialogTitle>
              {mode === 'reverse' ? 'Reverse prep' : 'Prep / portion stock'}
            </DialogTitle>
            <DialogDescription>
              {ingredient.name} ·{' '}
              {mode === 'reverse'
                ? 'Correct an untouched prep entry with a linked stock movement.'
                : 'Move stock into portions under the same item.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} noValidate={mode === 'post'}>
            <div className="stock-prep-body" ref={body}>
              {mode === 'reverse' && reversal ? (
                <fieldset disabled={busy}>
                  <p>
                    Return {inventoryQuantity(reversal.used)} {reversal.unit} to
                    unportioned stock and remove the {reversal.portions}{' '}
                    prepared portions at {reversal.location}.
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
                        {review.portions} ×{' '}
                        {inventoryQuantity(review.perPortion)}{' '}
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
                    {review.expires ? ` · Best before ${review.expires}` : ''}
                    {review.method ? ` · ${review.method}` : ''}
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
                      <>
                        Use the actual source amount. Leave blank to divide
                        usable stock equally in {ingredient.unit}. Keep
                        estimates in the note.
                      </>,
                    )}
                    <label className="field">
                      <span>Portion unit</span>
                      <select
                        value={form.outputUnit || ingredient.unit}
                        onChange={(e) => change('outputUnit', e.target.value)}
                        disabled={!form.perPortion}
                        aria-invalid={invalid('outputUnit') || undefined}
                        aria-describedby={
                          invalid('outputUnit') ? `${fieldId}-error` : undefined
                        }
                      >
                        <optgroup label="Compatible units">
                          {units.map((unit) => (
                            <option key={unit}>{unit}</option>
                          ))}
                        </optgroup>
                        {otherUnits.length > 0 && (
                          <optgroup label="Other units — verified conversion required">
                            {otherUnits.map((unit) => (
                              <option key={unit}>{unit}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </label>
                    {input(
                      'method',
                      food
                        ? 'Preparation method'
                        : 'Preparation / handling (optional)',
                      {
                        required: food,
                        placeholder: food
                          ? 'e.g. frozen, chopped, or cooked'
                          : 'e.g. cut, bundled, or sorted',
                        maxLength: 200,
                      },
                    )}
                    {input('location', 'Destination storage location', {
                      required: true,
                      placeholder: food
                        ? 'e.g. freezer drawer'
                        : 'e.g. shelf or bin',
                      maxLength: 200,
                    })}
                    {input('date', 'Prep date', {
                      type: 'date',
                      required: true,
                      max: today,
                    })}
                    {food &&
                      input(
                        'expires',
                        'Best-before (optional)',
                        {
                          type: 'date',
                          min: form.date,
                        },
                        'Leave blank if no best-before date applies.',
                      )}
                  </div>
                  <label className="field">
                    <span>Descriptive note (optional)</span>
                    <textarea
                      value={form.note || ''}
                      onChange={(e) => change('note', e.target.value)}
                      placeholder="Reference only; does not change stock quantities"
                      maxLength={1000}
                    />
                  </label>
                  <details
                    open={lossOpen}
                    onToggle={(event) => setLossOpen(event.currentTarget.open)}
                  >
                    <summary
                      className={
                        invalid('loss') ? 'stock-prep-loss-invalid' : undefined
                      }
                    >
                      Record measured prep loss (optional)
                    </summary>
                    <p>
                      Record only quantities actually removed from stock. Do not
                      record the same loss twice.
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
              {error && (
                <div id={`${fieldId}-error`}>
                  <FormErrorNotice message={error.message} reveal={false} />
                </div>
              )}
            </div>
            <div className="button-row stock-prep-actions">
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  if (review) {
                    setReview(null)
                    setError(null)
                  } else close()
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
    </>
  )
}
