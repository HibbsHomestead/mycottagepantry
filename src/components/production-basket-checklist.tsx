import { useState } from 'react'
import type { Item, Workspace } from '@/lib/domain'
import { inventoryQuantity } from '@/lib/inventory-quantity'
import {
  basketChecklist,
  checklistStages,
  type ChecklistStage,
} from '@/lib/production-checklist'

const labels = {
  reviewed: 'Reviewed',
  picked: 'Picked',
  packed: 'Packed & verified',
}

export function ProductionBasketChecklist({
  run,
  line,
  state,
  stage,
  busy,
  save,
}: {
  run: Item
  line: Item
  state: Workspace
  stage: ChecklistStage
  busy: boolean
  save?: (data: Record<string, unknown>) => Promise<unknown>
}) {
  const [selected, setSelected] = useState<ChecklistStage>()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const completed = run.status === 'completed'
  const started = run.status === 'scheduled'
  const current = selected || stage
  const entries = basketChecklist(line, state, current)
  if (!entries.length) return null
  const blocked =
    pending ||
    busy ||
    !save ||
    completed ||
    run.productionVersion !== 2 ||
    (!started && current !== 'reviewed')
  async function record(
    entry: (typeof entries)[number],
    checked: boolean,
    quantity: string | number,
  ) {
    if (!save || blocked) return
    setPending(true)
    setError('')
    try {
      await save({
        id: run.id,
        expectedRevision: run.revision,
        lineId: line.id,
        stage: current,
        key: entry.key,
        signature: entry.signature,
        checked,
        quantity,
      })
      setDrafts((prior) => {
        const next = { ...prior }
        delete next[`${current}:${entry.key}:${entry.signature}`]
        return next
      })
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setPending(false)
    }
  }
  return (
    <details className="basket-board-checklist">
      <summary>Basket checklist · {line.name}</summary>
      <p className="muted">
        Progress only. Checks do not reserve or move stock.
      </p>
      {!completed && run.productionVersion !== 2 && (
        <p>Open and save the basket plan to enable its checklist.</p>
      )}
      <div
        className="basket-checklist-tabs"
        role="group"
        aria-label={`Checklist stage for ${line.name}`}
      >
        {checklistStages
          .filter((entry) => started || completed || entry === 'reviewed')
          .map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={current === entry}
              onClick={() => {
                setSelected(entry)
                setError('')
              }}
            >
              {labels[entry]}
            </button>
          ))}
      </div>
      {error && (
        <p role="alert" className="warning-text">
          {error}
        </p>
      )}
      {[false, true].map((supply) => {
        const group = entries.filter((entry) => entry.supply === supply)
        if (!group.length) return null
        return (
          <section key={String(supply)}>
            <h4>{supply ? 'Packaging & supplies' : 'Included products'}</h4>
            <p className="muted" role="status">
              {supply ? 'Supplies' : 'Products'} {current}:{' '}
              {group.filter((entry) => entry.mark?.checked).length} of{' '}
              {group.length}
            </p>
            {group.map((entry) => {
              const key = `${current}:${entry.key}:${entry.signature}`
              const stockShort = entry.available + 1e-8 < entry.required
              const quantity = drafts[key] ?? String(entry.mark?.quantity || '')
              const partial =
                Number(quantity) > 0 && Number(quantity) + 1e-8 < entry.required
              return (
                <div className="basket-checklist-line" key={entry.key}>
                  <label data-checked={!!entry.mark?.checked}>
                    <input
                      type="checkbox"
                      checked={!!entry.mark?.checked}
                      disabled={
                        blocked ||
                        (!entry.mark?.checked &&
                          current !== 'reviewed' &&
                          (stockShort || partial))
                      }
                      onChange={(event) =>
                        void record(
                          entry,
                          event.target.checked,
                          event.target.checked ? entry.required : 0,
                        )
                      }
                    />
                    <span>
                      <strong>{entry.name}</strong>
                      {entry.variant && <small>{entry.variant}</small>}
                    </span>
                  </label>
                  <small>
                    {inventoryQuantity(entry.perBasket)} {entry.unit} per basket
                    · {inventoryQuantity(entry.required)} {entry.unit} required
                  </small>
                  {completed ? (
                    <small>
                      {entry.mark
                        ? `${inventoryQuantity(entry.mark.quantity)} ${entry.unit} recorded`
                        : 'No checklist progress recorded'}
                    </small>
                  ) : (
                    <small className={stockShort ? 'warning-text' : 'muted'}>
                      {inventoryQuantity(entry.available)} available
                      {stockShort
                        ? ` · ${inventoryQuantity(entry.required - entry.available)} still needed`
                        : ''}
                    </small>
                  )}
                  {entry.reReview && (
                    <small className="warning-text">
                      Requirements changed — review again.
                    </small>
                  )}
                  {!blocked && current !== 'reviewed' && !entry.mark?.checked && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        void record(entry, false, quantity)
                      }}
                      className="basket-checklist-quantity"
                    >
                      <label>
                        Actual {current} · {entry.name}
                        <input
                          type="number"
                          min="0"
                          max={entry.required}
                          step={entry.supply ? 'any' : '1'}
                          value={quantity}
                          onChange={(event) =>
                            setDrafts({ ...drafts, [key]: event.target.value })
                          }
                        />
                      </label>
                      <button type="submit" className="btn secondary">
                        Save quantity
                      </button>
                    </form>
                  )}
                </div>
              )
            })}
          </section>
        )
      })}
    </details>
  )
}
