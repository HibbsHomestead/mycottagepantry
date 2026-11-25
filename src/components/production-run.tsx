import { PrepStockSourceSelect } from './stock-prep'
import { FormErrorNotice } from './form-error-notice'
import { useRef, useState, useEffect, type ComponentProps } from 'react'
import { type Item, money, units } from '../lib/domain'
import { ovenToday } from '../lib/oven-dates'
import { workflowOf } from '../lib/product-workflows'
import { productionDefinition } from '../lib/production'
import { basketChecklist, basketChecklistIssues, checklistStages } from '../lib/production-checklist'
import { basketAllocationIssues } from '../lib/basket-production'
import { BasketProductionWork } from './basket-production-work'
import { ProductionBasketChecklist } from './production-basket-checklist'
import { basketAssignments, eligibleBasketRuns, productionOrderInvoices } from '../lib/production-destinations'
import {
  combinedProductionRequirements,
  productionOutputIssue,
  productionReviewIssues,
  productionRunLines,
} from '../lib/production-run'
import { LegacyProductionRun } from './legacy-production-run'
import './production-run.css'

type Props = ComponentProps<typeof LegacyProductionRun> & {
  onDirtyChange?: (dirty: boolean) => void
  initialReview?: boolean
  heldDraft?: Item
  holdDraft?: (draft?: Item) => void
  initialEventId?: string
  openLinkedRun?: (run: Item) => void
  returnToBasket?: () => void
  openAssortment?: (productId?: string) => void
}
const blank = (productId = ''): Item => ({
  id: crypto.randomUUID(),
  name: '',
  productId,
  quantity: 1,
  output: '',
  waste: 0,
  laborMinutes: '',
  wasteReason: '',
  definition: undefined,
  mapping: { quantity: '', unit: '', verified: false },
  usage: {},
  materialWaste: {},
  note: '',
})
export function ProductionRun(props: Props) {
  const [copy, setCopy] = useState<Item>()
  if (copy) return <RunEditor {...props} run={copy} />
  if (
    props.run?.productionVersion === 1 &&
    ['completed', 'canceled'].includes(props.run.status)
  )
    return (
      <>
        <LegacyProductionRun {...props} />
        {props.run.status === 'completed' && props.openAssortment && <button type="button" className="btn secondary" onClick={() => props.openAssortment?.(props.run?.productId)}>Assortment labels for this run</button>}
        {['Owner', 'Manager'].includes(props.role || 'Owner') && (
          <button
            type="button"
            className="btn secondary"
            onClick={() =>
              setCopy({
                id: crypto.randomUUID(),
                name: props.run!.name + ' — copy',
                status: 'draft',
                productionVersion: 2,
                revision: 0,
                date: ovenToday(props.state.settings[0]),
                lines: productionRunLines(props.run).map((l) => ({
                  ...blank(l.productId),
                  quantity: l.quantity,
                  mapping: l.mapping,
                  note: l.note,
                })),
              })
            }
          >
            Duplicate as new draft
          </button>
        )}
      </>
    )
  return <RunEditor {...props} />
}
function RunEditor({
  state,
  run,
  productId,
  legacyRunId,
  mutate,
  edit,
  busy,
  onDirtyChange,
  initialReview,
  heldDraft,
  holdDraft,
  initialEventId,
  openLinkedRun,
  returnToBasket,
  openAssortment,
  role = 'Owner',
}: Props) {
  const [id, setId] = useState(run?.id || crypto.randomUUID())
  const initial = heldDraft || run
  const [revision, setRevision] = useState(Number(initial?.revision || 0))
  const [status, setStatus] = useState(run?.status || 'draft')
  const [name, setName] = useState(initial?.name || 'Production run')
  const [date, setDate] = useState(initial?.date || ovenToday(state.settings[0]))
  const [dueDate, setDueDate] = useState(initial?.dueDate || '')
  const [eventId, setEventId] = useState(initial?.eventId || initialEventId || '')
  const [orderId, setOrderId] = useState(initial?.orderId || '')
  const [note, setNote] = useState(initial?.note || '')
  const [lines, setLines] = useState<Item[]>(() =>
    initial ? structuredClone(productionRunLines(initial)) : [blank(productId)],
  )
  const [review, setReview] = useState(!!initialReview && !heldDraft)
  const [savedPlan, setSavedPlan] = useState(!!run && !legacyRunId && Number(run.revision) > 0)
  const [dirty, setDirty] = useState(!!heldDraft)
  const [error, setError] = useState('')
  const [reversalReason, setReversalReason] = useState('')
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => {
    if (run?.id === id && !['completed', 'canceled'].includes(status)) holdDraft?.(dirty ? { id, name, revision, date, dueDate, eventId, orderId, note, lines } : undefined)
  }, [run?.id, holdDraft, dirty, id, name, revision, date, dueDate, eventId, orderId, note, lines, status])
  const saving = useRef(false)
  const terminal = ['completed', 'canceled'].includes(status)
  const started = status === 'scheduled'
  const editorRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const canEdit = ['Owner', 'Manager'].includes(role) && !terminal
  const canRecordActuals =
    ['Owner', 'Manager', 'Production Staff'].includes(role) && !terminal
  const canFinalize =
    ['Owner', 'Manager', 'Production Staff'].includes(role) && !terminal
  const change = (lineId: string, patch: Partial<Item>) => {
    setLines((previous) =>
      previous.map((l) => (l.id === lineId ? { ...l, ...patch } : l)),
    )
    setDirty(true)
    setReview(false)
  }
  let calculation: ReturnType<typeof combinedProductionRequirements> | undefined
  let setupError = ''
  const prepared = lines.map((l) => {
    const product = state.products.find((p) => p.id === l.productId)
    try {
      return {
        ...l,
        definition:
          (product?.workflow !== 'kit' || terminal ? l.definition : undefined) ||
          (product && productionDefinition(product, state, l.mapping || {})),
      }
    } catch (e) {
      setupError ||= (e as Error).message
      return l
    }
  })
  try {
    if (!terminal) calculation = combinedProductionRequirements(prepared, state)
  } catch (e) {
    setupError ||= (e as Error).message
  }
  const outputMissing = lines.some((line) => !!productionOutputIssue(line))
  const reviewIssues = productionReviewIssues(prepared.map((line, index) => ({
    ...line, name: line.name || state.products.find((product) => product.id === line.productId)?.name || `Product ${index + 1}`,
  })), outputMissing ? undefined : calculation)
  const startIssues = [...new Set([
    setupError,
    ...(!lines.length ? ['Add at least one product.'] : []),
    ...prepared.flatMap((line, index) => !line.definition
      ? [`Product ${index + 1}: select a product and verify its recipe output or materials setup.`]
      : calculation?.products[index]?.error ? [calculation.products[index].error] : []),
  ].filter(Boolean))]
  const checklistIssues = terminal ? [] : basketChecklistIssues(prepared, state, checklistStages)
  const allocationIssues = terminal ? [] : basketAllocationIssues(prepared, state, id)
  const blockers = [...new Set([...startIssues, ...reviewIssues, ...checklistIssues, ...allocationIssues])]
  const basket = prepared.length === 1 && prepared[0].definition?.product?.workflow === 'kit'
  const reviewPending = basketChecklistIssues(prepared, state, ['reviewed'])
  const reviewing = started && review
  const making = basket && allocationIssues.length > 0
  const currentStep = status === 'completed' || reviewing ? 4 : started ? 3 : savedPlan && !dirty ? 2 : 1
  const workStep = making && started && !reviewing ? 2 : currentStep
  function focusOutput() {
    setReview(false)
    requestAnimationFrame(() => {
      const field = editorRef.current?.querySelector<HTMLInputElement>('[data-output-input][aria-invalid="true"], [data-output-input]')
      const invalid = editorRef.current?.querySelector<HTMLInputElement>('[data-output-input][aria-invalid="true"]')
      ;(invalid || field)?.focus()
    })
  }
  function focusMaterials() {
    setReview(false)
    requestAnimationFrame(() => {
      const details = editorRef.current?.querySelector<HTMLDetailsElement>('[data-material-fields]')
      if (!details) return
      details.open = true
      details.querySelector<HTMLElement>('select, input, summary')?.focus()
    })
  }
  function hasActuals(l: Item) {
    return (
      (l.output !== '' && l.output != null) ||
      Number(l.waste) > 0 ||
      Object.keys(l.usage || {}).length > 0 ||
      Object.values(l.prepSources || {}).some(Boolean) ||
      Object.keys(l.materialWaste || {}).length > 0 ||
      (l.laborMinutes !== '' && l.laborMinutes != null)
    )
  }
  async function act(action: string, nextStatus = status, planContents = false) {
    if (saving.current) return
    saving.current = true
    setError('')
    try {
      const result = await mutate(action, 'batches', {
        id,
        name: name === 'Production run' && lines.length ? lines.map((line) => state.products.find((product) => product.id === line.productId)?.name).filter(Boolean).join(', ') || name : name,
        date,
        dueDate,
        eventId,
        orderId,
        note,
        lines,
        ...(planContents ? { planContents: true } : {}),
        reason: reversalReason,
        status: nextStatus,
        expectedRevision: revision,
        legacyRunId:
          run && id !== run.id ? undefined : run?.legacyRunId || legacyRunId,
      })
      const confirmed = (result as { workspace?: { batches?: Item[] } } | undefined)?.workspace?.batches?.find((entry) => entry.id === id)
      setRevision(confirmed?.revision ?? revision + 1)
      if (confirmed) setLines(productionRunLines(confirmed))
      if (confirmed?.name) setName(confirmed.name)
      setSavedPlan(true)
      setDirty(false)
      setReview(false)
      setStatus(
        action === 'productionComplete'
          ? 'completed'
          : action === 'productionCancel'
            ? 'canceled'
            : nextStatus,
      )
      if (action === 'productionComplete' || (!started && nextStatus === 'scheduled'))
        requestAnimationFrame(() => headingRef.current?.focus())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      saving.current = false
    }
  }
  function duplicate() {
    setId(crypto.randomUUID())
    setRevision(0)
    setStatus('draft')
    setEventId('')
    setOrderId('')
    setDueDate('')
    setSavedPlan(false)
    setName(name + ' — copy')
    setLines(
      lines.map((l) => ({
        ...blank(l.productId),
        name: l.name,
        quantity: l.quantity,
        mapping: l.mapping,
        note: l.note,
      })),
    )
    setDirty(true)
    setReview(false)
  }
  const finalRun =
    state.batches.find((b) => b.id === id) || (run?.id === id ? run : undefined)
  return (
    <div className="production-run multi-production-run" ref={editorRef}>
      {returnToBasket && <button type="button" disabled={busy || dirty} className="btn secondary" onClick={returnToBasket}>Back to basket</button>}
      {status !== 'canceled' && <ol className="production-steps" aria-label="Production steps">
        {(basket ? ['Plan', 'Make contents', 'Pack baskets', 'Review & finalize'] : ['Plan', 'Start', 'Record output', 'Review & finalize']).map((step, index) => <li key={step} aria-current={workStep === index + 1 && status !== 'completed' ? 'step' : undefined}>
          <strong>{index + 1} — {step}</strong>
          <small>{status === 'completed' || workStep > index + 1 ? 'Complete' : workStep === index + 1 ? 'Current step' : 'Upcoming'}</small>
        </li>)}
      </ol>}
      <h3 tabIndex={-1} ref={headingRef}>{status === 'completed' ? 'Recorded result' : status === 'canceled' ? 'Cancelled run' : reviewing ? 'Review & finalize' : started ? basket ? making ? 'Make contents' : 'Pack baskets' : 'Record output' : currentStep === 2 ? 'Start the saved plan' : 'Plan production'}</h3>
      {dirty && holdDraft && finalRun && <div className="calculation-box">
        <p>Closing keeps these unsaved changes available on this page. Save the run to keep them after a reload.</p>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => {
          setName(finalRun.name); setDate(finalRun.date); setDueDate(finalRun.dueDate || ''); setEventId(finalRun.eventId || ''); setOrderId(finalRun.orderId || ''); setNote(finalRun.note || ''); setRevision(Number(finalRun.revision || 0)); setLines(productionRunLines(finalRun)); setDirty(false); setError(''); setReview(false)
        }}>Discard unsaved changes</button>
      </div>}
      {!terminal && !reviewing && <p>{started ? 'Enter actual good and rejected output for every product. Saving output does not post stock.' : 'Save the plan first. Starting the run does not finalize it, reserve materials or move stock.'}</p>}
      <p>
        <strong>
          {status === 'completed'
            ? 'Finalized'
            : status === 'scheduled'
              ? (!dirty && !blockers.length ? 'Ready to finalize' : 'In progress')
              : status === 'canceled'
                ? 'Cancelled'
                : 'Draft'}
        </strong>{' '}
        · {lines.length} product {lines.length === 1 ? 'line' : 'lines'}
      </p>
      {run?.id && status !== 'canceled' && openAssortment && <button type="button" className="btn secondary" onClick={() => openAssortment(lines.length === 1 ? lines[0].productId : undefined)}>Assortment labels for this run</button>}
      <details open={!started && !terminal} hidden={reviewing}>
      <summary>Run name, date & notes</summary>
      <div className="form-grid">
        <label>
          Run name / reference
          <input
            value={name}
            disabled={!canEdit}
            onChange={(e) => {
              setName(e.target.value)
              setDirty(true)
              setReview(false)
            }}
          />
        </label>
        <label>
          Production date
          <input
            type="date"
            value={date}
            disabled={!canEdit}
            onChange={(e) => {
              setDate(e.target.value)
              setDirty(true)
              setReview(false)
            }}
          />
        </label>
        <label>Due date (optional)
          <input type="date" value={dueDate} disabled={!canEdit} onChange={(event) => { setDueDate(event.target.value); setDirty(true) }} />
        </label>
        <label>Market or event (optional)
          <select value={eventId} disabled={!canEdit} onChange={(event) => { setEventId(event.target.value); setDirty(true) }}>
            <option value="">No market or event</option>
            {(state.events || []).map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
        </label>
        <label>Customer order invoice (optional)
          <select value={orderId} disabled={!canEdit} onChange={(event) => { setOrderId(event.target.value); setDirty(true) }}>
            <option value="">No customer order</option>
            {productionOrderInvoices(state).filter((order) => !order.reversedBy || order.id === orderId).map((order) => <option key={order.id} value={order.id}>{order.name}</option>)}
          </select>
        </label>
      </div>
      <details>
        <summary>Run notes</summary>
        <label>
          Run notes
          <textarea
            value={note}
            disabled={!canEdit}
            onChange={(e) => {
              setNote(e.target.value)
              setDirty(true)
              setReview(false)
            }}
          />
        </label>
      </details>
      </details>
      {!started && (legacyRunId || run?.legacyRunId) && (
        <p>
          Starting this replacement cancels the original recipe plan. Saving a
          draft leaves the original unchanged. No stock moves until
          finalization.
        </p>
      )}
      {!reviewing && lines.map((l, index) => {
        const product = state.products.find((p) => p.id === l.productId)
        const definition = prepared[index].definition
        const result = calculation?.products[index]
        const recipe =
          definition?.recipe ||
          state.recipes.find((r) => r.id === product?.recipeId)
        const needsMapping =
          product && workflowOf(product) !== 'kit' && !product.bom
        const snapshot = l.costSnapshot
        return (
          <fieldset key={l.id} className="production-product-line">
            <legend>
              {product?.name || l.name || `Product ${index + 1}`}
            </legend>
            <details open={!started && !terminal}>
              <summary>{basket ? 'Basket plan' : 'Product plan'} · {l.quantity} {basket ? 'baskets' : definition?.bom ? 'finished units' : 'selling packages'}</summary>
            <div className="form-grid">
              <label>
                Product
                <select
                  value={l.productId}
                  disabled={!canEdit || !!l.basketParentId}
                  onChange={(e) => {
                    if (
                      hasActuals(l) &&
                      !window.confirm(
                        'Changing this product clears its entered actual output, labor and material usage. Continue?',
                      )
                    )
                      return
                    change(l.id, { ...blank(e.target.value), id: l.id })
                  }}
                >
                  <option value="">Choose product</option>
                  {state.products
                    .filter(
                      (p) =>
                        !p.archived &&
                        ['food', 'handmade', 'kit'].includes(workflowOf(p)) &&
                        (workflowOf(p) !== 'kit' || lines.length === 1 || p.id === l.productId),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {workflowOf(p) === 'kit' ? 'Basket' : workflowOf(p)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {basket ? 'Planned baskets' : 'Planned selling packages / finished units'}
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={l.quantity}
                  disabled={!canEdit}
                  onChange={(e) => change(l.id, { quantity: e.target.value })}
                />
              </label>
            </div>
            {recipe && (
              <p>
                Recipe: {recipe.name} · {recipe.yield} {recipe.yieldUnit} per
                batch.{' '}
                {result?.multiplier != null &&
                  `${result.multiplier.toFixed(4)} batches planned.`}
              </p>
            )}
            {product && workflowOf(product) !== 'kit' && (() => {
              const destinations = eligibleBasketRuns(state, product.id, id)
              const assignments = basketAssignments(l)
              if (!destinations.length && !assignments.length) return null
              return <details>
                <summary>Assign output to basket runs ({assignments.length})</summary>
                <p>Planning only. Assigned packages are part of this batch, not additional output or reserved stock.</p>
                {assignments.map((assignment, index) => <div key={index} className="form-grid">
                  <label>Basket run
                    <select disabled={!canEdit} value={assignment.runId} onChange={(event) => change(l.id, { basketAssignments: assignments.map((entry, position) => position === index ? { ...entry, runId: event.target.value } : entry) })}>
                      {!destinations.some((run) => run.id === assignment.runId) && <option value={assignment.runId}>{state.batches.find((run) => run.id === assignment.runId)?.name || 'Unavailable basket'}</option>}
                      {destinations.map((run) => <option key={run.id} value={run.id}>{run.name}</option>)}
                    </select>
                  </label>
                  <label>Packages assigned
                    <input type="number" min="1" step="1" disabled={!canEdit} value={assignment.quantity} onChange={(event) => change(l.id, { basketAssignments: assignments.map((entry, position) => position === index ? { ...entry, quantity: Number(event.target.value) } : entry) })} />
                  </label>
                  {canEdit && <button type="button" className="btn secondary" onClick={() => change(l.id, { basketAssignments: assignments.filter((_, position) => position !== index) })}>Remove assignment</button>}
                </div>)}
                {canEdit && destinations.some((run) => !assignments.some((entry) => entry.runId === run.id)) && <button type="button" className="btn secondary" onClick={() => change(l.id, { basketAssignments: [...assignments, { runId: destinations.find((run) => !assignments.some((entry) => entry.runId === run.id))!.id, quantity: 1 }] })}>Add basket assignment</button>}
              </details>
            })()}
            {definition?.bom && (
              <p>
                BOM: {definition.bom.name || product?.name} ·{' '}
                {result?.multiplier?.toFixed(4)} BOM runs
              </p>
            )}
            {needsMapping && !terminal && (
              <details open={!definition}>
                <summary>Verified recipe output per selling package</summary>
                <div className="form-grid">
                  <label>
                    Recipe output per selling package
                    <input
                      type="number"
                      min="0.000001"
                      step="any"
                      disabled={!canEdit}
                      value={l.mapping?.quantity || ''}
                      onChange={(e) =>
                        change(l.id, {
                          definition: undefined,
                          mapping: {
                            ...l.mapping,
                            quantity: e.target.value,
                            verified: false,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Output unit
                    <select
                      value={l.mapping?.unit || ''}
                      disabled={!canEdit}
                      onChange={(e) =>
                        change(l.id, {
                          definition: undefined,
                          mapping: {
                            ...l.mapping,
                            unit: e.target.value,
                            conversions: [],
                            verified: false,
                          },
                        })
                      }
                    >
                      <option value="">Choose yield unit</option>
                      {[...new Set([recipe?.yieldUnit, ...Object.keys(units)])]
                        .filter(Boolean)
                        .map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                {l.mapping?.unit &&
                  recipe?.yieldUnit &&
                  l.mapping.unit !== recipe.yieldUnit && (
                    <div className="form-grid">
                      <label>
                        Measured {l.mapping.unit}
                        <input
                          type="number"
                          min="0.000001"
                          step="any"
                          disabled={!canEdit}
                          value={l.mapping.conversions?.[0]?.amountFrom || ''}
                          onChange={(e) =>
                            change(l.id, {
                              definition: undefined,
                              mapping: {
                                ...l.mapping,
                                verified: false,
                                conversions: [
                                  {
                                    ...l.mapping.conversions?.[0],
                                    from: l.mapping.unit,
                                    to: recipe.yieldUnit,
                                    amountFrom: e.target.value,
                                    verified: true,
                                  },
                                ],
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        Equivalent {recipe.yieldUnit}
                        <input
                          type="number"
                          min="0.000001"
                          step="any"
                          disabled={!canEdit}
                          value={l.mapping.conversions?.[0]?.amountTo || ''}
                          onChange={(e) =>
                            change(l.id, {
                              definition: undefined,
                              mapping: {
                                ...l.mapping,
                                verified: false,
                                conversions: [
                                  {
                                    ...l.mapping.conversions?.[0],
                                    from: l.mapping.unit,
                                    to: recipe.yieldUnit,
                                    amountTo: e.target.value,
                                    verified: true,
                                  },
                                ],
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                  )}
                <label>
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={l.mapping?.verified === true}
                    onChange={(e) =>
                      change(l.id, {
                        definition: undefined,
                        mapping: { ...l.mapping, verified: e.target.checked },
                      })
                    }
                  />
                  I verified this output quantity and unit for one selling
                  package.
                </label>
              </details>
            )}
            </details>
            {product?.workflow === 'kit' && <>
              <BasketProductionWork line={l} state={state} parentId={id} open={dirty ? undefined : openLinkedRun} disabled={busy} change={canEdit && !terminal && basket ? (basketPlan) => change(l.id, { basketPlan }) : undefined} />
              {!savedPlan && <div><strong>Outer packaging and supplies</strong><ul>{basketChecklist(prepared[index], state, 'reviewed').filter((entry) => entry.supply).map((entry) => <li key={entry.key}>{entry.name}: {entry.required} {entry.unit} required</li>)}</ul></div>}
              {finalRun && !dirty && <ProductionBasketChecklist run={finalRun} line={l} state={state} busy={busy} stage={terminal ? 'packed' : started ? making ? 'picked' : 'packed' : 'reviewed'} save={canRecordActuals ? async (data) => {
                const result = await mutate('productionChecklist', 'batches', { ...data, id, name }) as { workspace?: { batches?: Item[] } }
                const updated = result?.workspace?.batches?.find((entry) => entry.id === id)
                if (updated) { setLines(productionRunLines(updated)); setRevision(updated.revision) }
                return result
              } : undefined} />}
            </>}
            {(started || terminal) && <section className="production-actual-fields" aria-label={`${product?.name || l.name || 'Product'} output`}>
              <div className="form-grid">
                <div><label>
                  {basket ? 'Actual completed baskets' : `Actual good output (${definition?.bom ? 'finished units' : 'selling packages'})`}
                  <input
                    data-output-input
                    aria-invalid={!terminal && !!productionOutputIssue(l)}
                    aria-describedby={!terminal && productionOutputIssue(l) ? `output-${l.id}` : undefined}
                    type="number"
                    min="1"
                    step="1"
                    disabled={!canRecordActuals}
                    value={terminal ? (l.actualYield ?? '') : (l.output ?? '')}
                    onChange={(e) => change(l.id, { output: e.target.value })}
                  />
                </label>
                {!terminal && productionOutputIssue(l) && <small className="warning-text" id={`output-${l.id}`}>{productionOutputIssue(l)}</small>}
                </div>
                <label>
                  Rejected output ({definition?.bom ? 'finished units' : 'selling packages'})
                  <input
                    type="number"
                    min="0"
                    step="1"
                    disabled={!canRecordActuals}
                    value={l.waste || 0}
                    onChange={(e) => change(l.id, { waste: e.target.value })}
                  />
                </label>
                <label>
                  Actual labor (minutes)
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder={String(result?.cost?.laborMinutes || 0)}
                    disabled={!canRecordActuals}
                    value={
                      terminal
                        ? (snapshot?.laborMinutes ?? '')
                        : (l.laborMinutes ?? '')
                    }
                    onChange={(e) =>
                      change(l.id, { laborMinutes: e.target.value })
                    }
                  />
                </label>
                <label>
                  Waste reason
                  <input
                    value={l.wasteReason || ''}
                    disabled={!canRecordActuals}
                    onChange={(e) =>
                      change(l.id, { wasteReason: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                Product-specific notes
                <textarea
                  value={l.note || ''}
                  disabled={!canEdit}
                  onChange={(e) => change(l.id, { note: e.target.value })}
                />
              </label>
            </section>}
            {terminal ? (
              <>
                <p>
                  Actual locked cost: {money(l.historicalCost || 0)} · labor{' '}
                  {money(snapshot?.labor || 0)} · overhead{' '}
                  {money(snapshot?.overhead || 0)} · packaging{' '}
                  {money(snapshot?.packagingCost || 0)}
                </p>
                {(Array.isArray(l.usage) ? l.usage : []).map((u: Item) => (
                  <p key={u.id}>
                    {u.name}: {u.quantity} {u.unit} consumed · {money(u.cost)}
                  </p>
                ))}
              </>
            ) : (
              <>
                <details><summary>Cost estimate and calculation</summary><p>
                  Estimated cost:{' '}
                  {result
                    ? result.costKnown
                      ? money(result.estimate)
                      : `Incomplete · known estimated subtotal ${money(result.estimate)}`
                    : 'Complete setup'}
                  {result?.cost &&
                    ` · labor ${money(result.cost.labor)} · overhead ${money(result.cost.overhead)}`}
                  {result?.error && <span role="status">{result.error}</span>}.
                  Actual costs lock at finalization.
                </p></details>
                {result?.requirements && (
                  <details data-material-fields open={started && result.requirements.some((requirement: Item) => requirement.source?.prepared)}>
                    <summary>
                      Product requirements and actual material usage
                    </summary>
                    {result.requirements.map((r: Item) => (
                      <div key={r.id}>
                        <p>
                          {r.name}: {Number(r.quantity).toFixed(3)} {r.unit}{' '}
                          required
                        </p>
                        {r.kind === 'ingredient' && r.tracked && (
                          <PrepStockSourceSelect
                            ingredient={state.ingredients.find((i) => i.id === r.itemId)}
                            lots={state.lots}
                            requirement={r.source.prepared}
                            requiredQuantity={r.quantity}
                            value={l.prepSources?.[r.itemId]}
                            change={(source) => change(l.id, {
                              prepSources: { ...l.prepSources, [r.itemId]: source },
                            })}
                            disabled={!canRecordActuals}
                          />
                        )}
                        {r.kind === 'ingredient' &&
                          r.source.ingredientId &&
                          (definition?.bom ||
                            !definition?.product.packagingLines?.some(
                              (p: Item) => p.ingredientId === r.itemId,
                            )) && (
                            <div className="form-grid">
                              <label>
                                Actual {r.name} use ({r.unit})
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  disabled={!canRecordActuals}
                                  value={l.usage?.[r.itemId] ?? ''}
                                  placeholder={String(
                                    r.quantity -
                                      Number(l.materialWaste?.[r.itemId] || 0),
                                  )}
                                  onChange={(e) =>
                                    change(l.id, {
                                      usage: {
                                        ...l.usage,
                                        [r.itemId]:
                                          e.target.value === ''
                                            ? undefined
                                            : e.target.value,
                                      },
                                    })
                                  }
                                />
                              </label>
                              <label>
                                {r.name} material waste ({r.unit})
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  disabled={!canRecordActuals}
                                  value={l.materialWaste?.[r.itemId] ?? 0}
                                  onChange={(e) =>
                                    change(l.id, {
                                      materialWaste: {
                                        ...l.materialWaste,
                                        [r.itemId]: e.target.value,
                                      },
                                    })
                                  }
                                />
                              </label>
                            </div>
                          )}
                      </div>
                    ))}
                  </details>
                )}
                {canEdit && (
                  <details open={!started}><summary>Product setup actions</summary><div className="button-row">
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          hasActuals(l) &&
                          !window.confirm(
                            'Remove this product and its entered actual output and material usage?',
                          )
                        )
                          return
                        setLines(lines.filter((item) => item.id !== l.id))
                        setDirty(true)
                        setReview(false)
                      }}
                    >
                      Remove product
                    </button>
                    {product && (
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => {
                          if (
                            !dirty ||
                            window.confirm(
                              'Discard unsaved run changes and open product setup? Save first to continue editing this run later.',
                            )
                          )
                            edit('product', product)
                        }}
                      >
                        Edit product setup
                      </button>
                    )}
                  </div></details>
                )}
              </>
            )}
          </fieldset>
        )
      })}
      {canEdit && !reviewing && !basket && (
        <button
          type="button"
          className={started ? 'text-button' : 'btn secondary'}
          onClick={() => {
            setLines([...lines, blank()])
            setDirty(true)
            setReview(false)
          }}
        >
          Add product
        </button>
      )}
      {!terminal && !reviewing && (
        <details open={!started}>
          <summary>Combined material requirements</summary>
          <p>
            Preview only: no stock reserved, consumed or received before
            finalization. Current stock is shared with other work.
          </p>
          {setupError && <p role="status">{setupError}</p>}
          {calculation && (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Total required</th>
                      <th>Available</th>
                      <th>Status</th>
                      <th>Cost per matching unit / basis</th>
                      <th>Estimated cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculation.requirements.map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td>
                          {Number(r.quantity).toFixed(3)} {r.unit}
                        </td>
                        <td>
                          {r.tracked
                            ? `${r.available} ${r.unit}`
                            : 'Not tracked'}
                        </td>
                        <td>
                          {r.tracked && r.quantity > r.available + 1e-8
                            ? 'Shortage'
                            : 'Available'}
                        </td>
                        <td>
                          {r.costKnown
                            ? `${money(r.unitCost)} / ${r.unit}`
                            : r.costReason}
                          <div>
                            <small>{r.costBasis}</small>
                          </div>
                          {r.costKnown && !r.inventoryCostKnown && (
                            <div>
                              <small>
                                Finalization requires recorded inventory
                                valuation.
                              </small>
                            </div>
                          )}
                          <details>
                            <summary>Cost source</summary>
                            <p>
                              Reference: {r.itemId}
                              {r.recipeId
                                ? ` · Recipe/design: ${r.recipeId}`
                                : ''}
                            </p>
                          </details>
                          {!r.costKnown && (
                            <a href="#Products/All%20Products">
                              Review product and material costs
                            </a>
                          )}
                        </td>
                        <td>{r.costKnown ? money(r.cost) : 'Unavailable'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                {calculation.costKnown
                  ? 'Run estimated cost: '
                  : 'Incomplete · Known estimated subtotal: '}
                {money(calculation.total)}
              </p>
              <p>
                Finished components use recorded inventory valuation when
                available; otherwise the current All Products estimate is
                labeled above. These bases can differ. Basket assembly consumes
                finished packages, without charging their ingredients again.
              </p>
            </>
          )}
          <p>
            Labor and overhead use each line’s existing scaled recipe/BOM policy
            once. There are no additional shared run charges. Enter each
            product’s portion of shared labor in its actual minutes; do not
            repeat the full run time on every line.
          </p>
        </details>
      )}
      {reviewing && (
        <section className="calculation-box" aria-label="Finalization review">
          <h3>Finalization review</h3>
          {lines.map((l) => (
            <p key={l.id}>
              {state.products.find((p) => p.id === l.productId)?.name}:{' '}
              {l.output} {basket ? 'completed baskets' : l.definition?.bom ? 'good finished units' : 'good selling packages'} to receive ·{' '}
              {l.waste || 0} rejected · estimated cost{' '}
              {money(
                calculation?.products.find((p) => p.line.id === l.id)
                  ?.estimate || 0,
              )}
            </p>
          ))}
          <h4>{basket ? 'Finished contents and outer supplies to consume' : 'Materials to consume'}</h4>
          <ul>{calculation?.requirements.map((requirement) => <li key={requirement.id}>
            {requirement.name}: {requirement.quantity} {requirement.unit}{requirement.source?.prepared ? ' from prepared stock' : ''} · {requirement.costKnown ? money(requirement.cost) : 'Cost needs review'}
          </li>)}</ul>
          {basket && <p>Additional assembly labor: {money(calculation?.products[0]?.cost?.labor || 0)}. Component valuation already includes its production costs.</p>}
          <p><strong>Estimated at recorded costs: {calculation?.costKnown ? money(calculation.total) : 'Incomplete'}</strong></p>
          <p>
            Finalization rechecks stock, receives good output, consumes the materials once and locks the actual costs and usage.
          </p>
        </section>
      )}
      {terminal && (
        <>
          <p>
            {status === 'completed'
              ? `Finalized ${finalRun?.completedAt || ''} by ${finalRun?.finalizedBy || 'recorded operator'}. Actual run cost: ${money(finalRun?.historicalCost || 0)}.`
            : basket ? 'Basket cancelled. Any linked component production remains as recorded; no component stock was reversed.' : 'Cancelled. No stock was posted.'}
          </p>
          <p>
            Posted quantities, usage and costs are read-only. Corrections use
            linked adjustments. Handmade-only runs support whole-run reversal;
            food and mixed runs require separately linked stock corrections.
          </p>
          {['Owner', 'Manager'].includes(role) && (
            <button type="button" className="btn secondary" onClick={duplicate}>
              Duplicate as new draft
            </button>
          )}
        </>
      )}
      {status === 'completed' &&
        ['Owner', 'Manager'].includes(role) &&
        lines.every((l) => l.definition?.product?.workflow === 'handmade') && (
          <section>
            <label>
              Reason for whole-run reversal
              <input
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
              />
            </label>
            <p>
              Reversal removes all original output and restores recorded
              materials. Later output movements block reversal. The finalized
              record remains locked.
            </p>
            <button
              type="button"
              className="btn secondary"
              disabled={busy || !reversalReason.trim()}
              onClick={() => act('productionReverse')}
            >
              Reverse production run
            </button>
          </section>
        )}
      {!!finalRun?.auditTrail?.length && (
        <details>
          <summary>Run audit history</summary>
          {finalRun.auditTrail.map((entry: Item, index: number) => (
            <p key={index}>
              {entry.at} · {entry.event} · {entry.actor}
              {entry.revision ? ` · revision ${entry.revision}` : ''}
            </p>
          ))}
        </details>
      )}
      {terminal && error && <FormErrorNotice message={error} />}
      {!terminal && (
        <div className="production-step-actions">
          {started && blockers.length > 0 && <div className="calculation-box" aria-label="Requirements before finalization">
            <strong>Before you can finalize</strong><ul>{blockers.map((issue) => <li key={issue}>{issue}</li>)}</ul>
            {outputMissing && <button type="button" className="text-button" onClick={focusOutput}>Enter output</button>}
            {!outputMissing && calculation?.requirements.length ? <button type="button" className="text-button" onClick={focusMaterials}>Review material usage or allocation</button> : null}
          </div>}
          {!started && startIssues.length > 0 && <div className="calculation-box"><strong>Before you can start</strong><ul>{startIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
          <FormErrorNotice message={error} />
          <div className="button-row">
          {!started && canEdit && (
            <>
              <button
                type="button"
                className={currentStep === 1 ? 'btn' : 'btn secondary'}
                disabled={busy}
                onClick={() => lines.length ? act('productionSave', 'draft', basket) : setError('Add a product before saving the plan.')}
              >
                {basket ? 'Save basket & component plan' : 'Save plan'}
              </button>
              {currentStep === 2 && !!reviewPending.length && <p>Review the basket contents checklist before starting.</p>}
              {currentStep === 2 && !startIssues.length && !reviewPending.length && <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => act('productionSave', 'scheduled')}
              >
                {basket ? 'Start basket plan' : 'Start run'}
              </button>}
            </>
          )}
          {started && !reviewing && canRecordActuals && (dirty || blockers.length > 0) && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                if (outputMissing) {
                  setError('Enter actual good output for each product before saving output.')
                  focusOutput()
                } else void act(canEdit ? 'productionSave' : 'productionRecordActuals')
              }}
            >
              {basket ? 'Save actual baskets' : 'Save output'}
            </button>
          )}
          {started && !reviewing && canEdit && basket && <button type="button" className="btn secondary" disabled={busy} onClick={() => void act('productionSave', status, true)}>Save basket & component plan</button>}
          {started && canFinalize && !blockers.length && !dirty && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                if (reviewing) void act('productionComplete')
                else {
                  setReview(true)
                  requestAnimationFrame(() => headingRef.current?.focus())
                }
              }}
            >
              {reviewing ? 'Finalize production' : 'Review & finalize'}
            </button>
          )}
          {reviewing && <button type="button" className="btn secondary" disabled={busy} onClick={() => setReview(false)}>{basket ? 'Back to packing' : 'Back to output'}</button>}
          {canEdit && !reviewing && savedPlan && (
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(basket ? 'Cancel this basket? Linked runs stay open or completed as recorded. Posted components stay in stock; nothing is reversed.' : 'Cancel this run? No stock has been posted.')
                )
                  void act('productionCancel')
              }}
            >
              Cancel run
            </button>
          )}
          </div>
        </div>
      )}
      {!terminal && (
        <p>
          {dirty
            ? 'Unsaved changes. Save before closing or reviewing finalization.'
            : 'Saved runs can be reopened from the board.'}
        </p>
      )}
    </div>
  )
}
