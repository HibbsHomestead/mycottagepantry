import { FormErrorNotice } from './form-error-notice'
import { useRef, useState, useEffect, type ComponentProps } from 'react'
import { type Item, money, units } from '../lib/domain'
import { ovenToday } from '../lib/oven-dates'
import { workflowOf } from '../lib/product-workflows'
import { productionDefinition } from '../lib/production'
import {
  combinedProductionRequirements,
  productionRunLines,
} from '../lib/production-run'
import { LegacyProductionRun } from './legacy-production-run'
import './production-run.css'

type Props = ComponentProps<typeof LegacyProductionRun> & {
  onDirtyChange?: (dirty: boolean) => void
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
  role = 'Owner',
}: Props) {
  const [id, setId] = useState(run?.id || crypto.randomUUID())
  const [revision, setRevision] = useState(Number(run?.revision || 0))
  const [status, setStatus] = useState(run?.status || 'draft')
  const [name, setName] = useState(run?.name || 'Production run')
  const [date, setDate] = useState(run?.date || ovenToday(state.settings[0]))
  const [note, setNote] = useState(run?.note || '')
  const [lines, setLines] = useState<Item[]>(() =>
    run ? structuredClone(productionRunLines(run)) : [blank(productId)],
  )
  const [review, setReview] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [reversalReason, setReversalReason] = useState('')
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  const saving = useRef(false)
  const terminal = ['completed', 'canceled'].includes(status)
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
          l.definition ||
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
  function hasActuals(l: Item) {
    return (
      (l.output !== '' && l.output != null) ||
      Number(l.waste) > 0 ||
      Object.keys(l.usage || {}).length > 0 ||
      Object.keys(l.materialWaste || {}).length > 0 ||
      (l.laborMinutes !== '' && l.laborMinutes != null)
    )
  }
  async function act(action: string, nextStatus = status) {
    if (saving.current) return
    saving.current = true
    setError('')
    try {
      await mutate(action, 'batches', {
        id,
        name,
        date,
        note,
        lines,
        reason: reversalReason,
        status: nextStatus,
        expectedRevision: revision,
        legacyRunId:
          run && id !== run.id ? undefined : run?.legacyRunId || legacyRunId,
      })
      setRevision(revision + 1)
      setDirty(false)
      setReview(false)
      setStatus(
        action === 'productionComplete'
          ? 'completed'
          : action === 'productionCancel'
            ? 'canceled'
            : nextStatus,
      )
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
    <div className="production-run multi-production-run">
      <p>
        <strong>
          {status === 'completed'
            ? 'Finalized'
            : status === 'scheduled'
              ? 'In progress'
              : status === 'canceled'
                ? 'Cancelled'
                : 'Draft'}
        </strong>{' '}
        · {lines.length} product {lines.length === 1 ? 'line' : 'lines'}
      </p>
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
      {(legacyRunId || run?.legacyRunId) && (
        <p>
          Starting this replacement cancels the original recipe plan. Saving a
          draft leaves the original unchanged. No stock moves until
          finalization.
        </p>
      )}
      {lines.map((l, index) => {
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
              Product {index + 1}
              {terminal ? ` · ${l.name}` : ''}
            </legend>
            <div className="form-grid">
              <label>
                Product
                <select
                  value={l.productId}
                  disabled={!canEdit}
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
                        ['food', 'handmade', 'kit'].includes(workflowOf(p)),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {workflowOf(p)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Planned selling packages / finished units
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
            {product?.workflow === 'kit' && (
              <p>
                Uses existing finished stock. Component manufacturing is
                separate.
              </p>
            )}
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
            <details>
              <summary>
                Output, waste and notes ·{' '}
                {terminal ? (l.actualYield ?? '—') : l.output || 'Not recorded'}{' '}
                good · {l.waste || 0} rejected
              </summary>
              <div className="form-grid">
                <label>
                  Actual good output (selling packages / finished units)
                  <input
                    type="number"
                    min="1"
                    step="1"
                    disabled={!canRecordActuals}
                    value={terminal ? (l.actualYield ?? '') : (l.output ?? '')}
                    onChange={(e) => change(l.id, { output: e.target.value })}
                  />
                </label>
                <label>
                  Waste / rejected output
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
            </details>
            {terminal ? (
              <>
                <p>
                  Actual locked cost: {money(l.historicalCost || 0)} · labor{' '}
                  {money(snapshot?.labor || 0)} · overhead{' '}
                  {money(snapshot?.overhead || 0)} · packaging{' '}
                  {money(snapshot?.packagingCost || 0)}
                </p>
                {(l.usage || []).map((u: Item) => (
                  <p key={u.id}>
                    {u.name}: {u.quantity} {u.unit} consumed · {money(u.cost)}
                  </p>
                ))}
              </>
            ) : (
              <>
                <p>
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
                </p>
                {result?.requirements && (
                  <details>
                    <summary>
                      Product requirements and actual material usage
                    </summary>
                    {result.requirements.map((r: Item) => (
                      <div key={r.id}>
                        <p>
                          {r.name}: {Number(r.quantity).toFixed(3)} {r.unit}{' '}
                          required
                        </p>
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
                  <div className="button-row">
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
                  </div>
                )}
              </>
            )}
          </fieldset>
        )
      })}
      {canEdit && (
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            setLines([...lines, blank()])
            setDirty(true)
            setReview(false)
          }}
        >
          Add product
        </button>
      )}
      {!terminal && (
        <section aria-label="Combined material requirements">
          <h3>Combined material requirements</h3>
          <p>
            Planned only: no stock reserved, consumed or received before
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
                labeled above. These bases can differ. Kit assembly consumes
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
        </section>
      )}
      {review && (
        <section className="calculation-box" aria-label="Finalization review">
          <h3>Finalization review</h3>
          {lines.map((l) => (
            <p key={l.id}>
              {state.products.find((p) => p.id === l.productId)?.name}:{' '}
              {l.output} good selling packages / finished units added ·{' '}
              {l.waste || 0} rejected · estimated cost{' '}
              {money(
                calculation?.products.find((p) => p.line.id === l.id)
                  ?.estimate || 0,
              )}
            </p>
          ))}
          <p>
            The combined materials above are consumed once. No earlier inventory
            movements exist for this run. Actual stock costs and the existing
            line allocations lock together. Finalization records your identity
            and time and makes this run read-only.
          </p>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => act('productionComplete')}
          >
            Finalize run
          </button>
        </section>
      )}
      {terminal && (
        <>
          <p>
            {status === 'completed'
              ? `Finalized ${finalRun?.completedAt || ''} by ${finalRun?.finalizedBy || 'recorded operator'}. Actual run cost: ${money(finalRun?.historicalCost || 0)}.`
              : 'Cancelled. No stock was posted.'}
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
      {error && <FormErrorNotice message={error} />}
      {!terminal && (
        <div className="button-row">
          {canEdit && (
            <>
              <button
                type="button"
                className="btn secondary"
                disabled={busy || !lines.length}
                onClick={() =>
                  act(
                    'productionSave',
                    status === 'scheduled' ? 'scheduled' : 'draft',
                  )
                }
              >
                {status === 'scheduled' ? 'Save changes' : 'Save draft'}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy || !!setupError || !lines.length}
                onClick={() => act('productionSave', 'scheduled')}
              >
                Start run
              </button>
            </>
          )}
          {role === 'Production Staff' && canRecordActuals && (
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => act('productionRecordActuals')}
            >
              Save actuals
            </button>
          )}
          {canFinalize && (
            <button
              type="button"
              className="btn"
              disabled={
                busy ||
                dirty ||
                !state.batches.some((b) => b.id === id) ||
                !!setupError ||
                !calculation?.costKnown ||
                calculation.requirements.some((r) => !r.inventoryCostKnown) ||
                !!calculation.shortages.length ||
                lines.some((l) => l.output == null || l.output === '')
              }
              onClick={() => setReview(true)}
            >
              Review finalization
            </button>
          )}
          {canEdit && run && (
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm('Cancel this run? No stock has been posted.')
                )
                  void act('productionCancel')
              }}
            >
              Cancel run
            </button>
          )}
        </div>
      )}
      {!terminal && (
        <p>
          {dirty
            ? 'Unsaved changes. Save before closing or reviewing finalization.'
            : 'Save and close to continue editing later. Start run does not finalize or move stock.'}
        </p>
      )}
    </div>
  )
}
