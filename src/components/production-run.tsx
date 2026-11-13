import { ovenToday } from '../lib/oven-dates'
import './production-run.css'
import { useRef, useState } from 'react'
import { type Item, type Workspace, convert, money, units } from '../lib/domain'
import { productionDefinition, productionRequirements } from '../lib/production'
import { workflowOf } from '../lib/product-workflows'
import { PantryPhoto } from './pantry-photo'

export function ProductionRun({
  state,
  run,
  productId,
  legacyRunId,
  mutate,
  edit,
  startComponent,
  busy,
}: {
  state: Workspace
  run?: Item
  productId?: string
  legacyRunId?: string
  mutate: (action: string, table: string, data: Item) => Promise<unknown>
  edit: (kind: string, item: Item) => void
  startComponent: (productId: string) => void
  busy: boolean
}) {
  const [id] = useState(() => run?.id || crypto.randomUUID())
  const [product, setProduct] = useState(run?.productId || productId || '')
  const [quantity, setQuantity] = useState(String(run?.quantity || 1))
  const [date, setDate] = useState(run?.date || ovenToday(state.settings[0]))
  const [mapping, setMapping] = useState(
    run?.mapping || { quantity: '', unit: '', verified: false },
  )
  const [review, setReview] = useState(!!run?.definition)
  const [output, setOutput] = useState(
    String(run?.actualYield || run?.quantity || 1),
  )
  const [waste, setWaste] = useState('0')
  const [wasteReason, setWasteReason] = useState('')
  const [labor, setLabor] = useState('')
  const [usage, setUsage] = useState<Record<string, string>>({})
  const [materialWaste, setMaterialWaste] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const saving = useRef(false)
  const p =
    run?.definition?.product || state.products.find((p) => p.id === product)
  const recipe =
    run?.definition?.recipe || state.recipes.find((r) => r.id === p?.recipeId)
  const kit = p?.workflow === 'kit'
  const terminal = ['completed', 'canceled'].includes(run?.status)
  const scheduled = run?.status === 'scheduled'
  let definition: Item | undefined,
    result: ReturnType<typeof productionRequirements> | undefined,
    setupError = ''
  try {
    if (p) {
      definition = run?.definition || productionDefinition(p, state, mapping)
      result = productionRequirements(
        definition!,
        Number(quantity),
        scheduled
          ? {
              id: '',
              name: '',
              output: Number(output),
              waste: Number(waste),
              wasteReason,
              usage,
              materialWaste,
              ...(labor !== '' ? { laborMinutes: Number(labor) } : {}),
            }
          : undefined,
      )
    }
  } catch (e) {
    setupError = (e as Error).message
  }
  const availability = (line: Item) =>
    (line.kind === 'product' ? state.products : state.ingredients).find(
      (i) => i.id === line.itemId,
    )
  const availableQuantity = (line: Item): number | null => {
    const item = availability(line)
    if (!item) return null
    try {
      return line.kind === 'product'
        ? Number(item.quantity || 0)
        : convert(
            Number(item.quantity || 0),
            item.unit,
            line.unit,
            item.conversions,
          )
    } catch {
      return null
    }
  }
  const estimatedInputCost = (line: Item) => {
    const item = availability(line)
    if (!item) return 0
    try {
      return (
        line.quantity *
        Number(item.cost || 0) *
        (line.kind === 'product'
          ? 1
          : convert(1, line.unit, item.unit, item.conversions))
      )
    } catch {
      return 0
    }
  }
  const shortages =
    result?.requirements.filter(
      (l) =>
        l.tracked &&
        (availableQuantity(l) == null ||
          availableQuantity(l)! < l.quantity ||
          (l.kind === 'product' && availability(l)?.stockCostKnown !== true)),
    ) || []
  const costIncomplete = result?.requirements.some((line) => {
    const item = availability(line)
    return (
      !item ||
      item.needsCostSetup ||
      item.cost == null ||
      !Number.isFinite(Number(item.cost)) ||
      (line.kind === 'product' && item.stockCostKnown !== true) ||
      availableQuantity(line) == null
    )
  })
  async function act(action: string, status?: string) {
    if (saving.current) return
    saving.current = true
    setError('')
    try {
      await mutate(action, 'batches', {
        id,
        name: p?.name || 'Production',
        legacyRunId: run?.legacyRunId || legacyRunId,
        productId: product,
        quantity: Number(quantity),
        mapping,
        date,
        status,
        output: Number(output),
        waste: Number(waste),
        wasteReason,
        materialWaste,
        usage,
        ...(labor !== '' ? { laborMinutes: Number(labor) } : {}),
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      saving.current = false
    }
  }
  if (terminal)
    return (
      <section>
        <p>
          {run?.name} · {run?.status}
        </p>
        <p>
          {run?.actualYield ?? run?.quantity} selling packages ·{' '}
          {money(run?.historicalCost || 0)}
        </p>
        <details>
          <summary>Recorded requirements and cost</summary>
          <p>
            {run?.definition?.recipe?.name || 'Kit assembly'} · definition saved
            when planned.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Input</th>
                  <th>Actual use</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {(run?.usage || []).map((line: Item) => (
                  <tr key={line.id}>
                    <td>{line.name}</td>
                    <td>
                      {line.quantity} {line.unit}
                    </td>
                    <td>{money(line.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Labor: {money(run?.costSnapshot?.labor || 0)} · Packaging:{' '}
            {money(run?.costSnapshot?.packagingCost || 0)} · Output waste:{' '}
            {run?.waste || 0} packages
          </p>
          {run?.wasteReason && <p>{run.wasteReason}</p>}
        </details>
        <p>
          Completed stock movements are immutable. Automatic reversal and
          disassembly are unavailable.
        </p>
      </section>
    )
  return (
    <div className="production-run">
      {(legacyRunId || run?.legacyRunId) && (
        <p>
          Reviewing legacy plan:{' '}
          {
            state.batches.find(
              (b) => b.id === (legacyRunId || run?.legacyRunId),
            )?.name
          }
          . Verify the requested product output. Confirming this new plan
          cancels the original uncompleted plan without moving stock; saving a
          draft leaves it unchanged.
        </p>
      )}
      <div className="form-grid">
        <label>
          Product
          <select
            aria-label="Product"
            value={product}
            disabled={scheduled}
            onChange={(e) => {
              setProduct(e.target.value)
              setReview(false)
              setMapping({ quantity: '', unit: '', verified: false })
            }}
          >
            <option value="">Choose product</option>
            {state.products
              .filter((p) =>
                ['food', 'kit', 'handmade'].includes(workflowOf(p)),
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.workflow === 'kit' ? ' · Kit' : ''}
                </option>
              ))}
          </select>
        </label>
        <label>
          {kit ? 'Kits to assemble' : 'Selling packages to produce'}
          <input
            type="number"
            min="1"
            step="1"
            value={quantity}
            disabled={scheduled}
            onChange={(e) => {
              setQuantity(e.target.value)
              setOutput(e.target.value)
              setReview(false)
            }}
          />
        </label>
      </div>
      {p && (
        <div className="selected-item">
          <PantryPhoto item={p} assets={state.graphic_assets} kind="product" />
          <span>
            <strong>{p.name}</strong>
            <small>
              {kit ? 'Kit · Assemble' : `${workflowOf(p)} · Produce`} ·{' '}
              {quantity} selling packages
            </small>
          </span>
        </div>
      )}
      {!scheduled && (
        <label>
          Production date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      )}
      {p && !kit && !scheduled && recipe && (
        <fieldset>
          <legend>Verified package output</legend>
          <div className="form-grid">
            <label>
              Recipe output per selling package
              <input
                type="number"
                min="0.000001"
                step="any"
                value={mapping.quantity}
                onChange={(e) => {
                  setMapping({
                    ...mapping,
                    quantity: e.target.value,
                    verified: false,
                  })
                  setReview(false)
                }}
              />
            </label>
            <label>
              Output unit
              <select
                value={mapping.unit}
                onChange={(e) => {
                  setMapping({
                    ...mapping,
                    unit: e.target.value,
                    conversions: [],
                    verified: false,
                  })
                  setReview(false)
                }}
              >
                <option value="">Choose yield unit</option>
                {recipe.yieldUnit &&
                  !Object.hasOwn(units, recipe.yieldUnit) && (
                    <option value={recipe.yieldUnit}>
                      {recipe.yieldUnit} (recipe yield)
                    </option>
                  )}
                {Object.keys(units)
                  .filter((u) => units[u].factor > 0)
                  .map((u) => (
                    <option key={u}>{u}</option>
                  ))}
              </select>
            </label>
          </div>
          <p>
            Recipe: {recipe.name} · {recipe.yield} {recipe.yieldUnit} per batch.
          </p>
          {mapping.unit &&
            recipe.yieldUnit &&
            mapping.unit !== recipe.yieldUnit && (
              <details>
                <summary>Set a verified yield conversion if required</summary>
                <p>
                  Enter a measured relationship. No density or count equivalence
                  is assumed.
                </p>
                <div className="form-grid">
                  <label>
                    Measured {mapping.unit}
                    <input
                      type="number"
                      min="0.000001"
                      step="any"
                      value={mapping.conversions?.[0]?.amountFrom || ''}
                      onChange={(e) => {
                        setMapping({
                          ...mapping,
                          verified: false,
                          conversions: [
                            {
                              ...mapping.conversions?.[0],
                              from: mapping.unit,
                              to: recipe.yieldUnit,
                              amountFrom: e.target.value,
                              verified: true,
                            },
                          ],
                        })
                        setReview(false)
                      }}
                    />
                  </label>
                  <label>
                    Equivalent {recipe.yieldUnit}
                    <input
                      type="number"
                      min="0.000001"
                      step="any"
                      value={mapping.conversions?.[0]?.amountTo || ''}
                      onChange={(e) => {
                        setMapping({
                          ...mapping,
                          verified: false,
                          conversions: [
                            {
                              ...mapping.conversions?.[0],
                              from: mapping.unit,
                              to: recipe.yieldUnit,
                              amountTo: e.target.value,
                              verified: true,
                            },
                          ],
                        })
                        setReview(false)
                      }}
                    />
                  </label>
                </div>
              </details>
            )}
          <label>
            <input
              type="checkbox"
              checked={mapping.verified}
              onChange={(e) => {
                setMapping({ ...mapping, verified: e.target.checked })
                setReview(false)
              }}
            />{' '}
            I verified this output quantity and unit for one selling package.
          </label>
        </fieldset>
      )}
      {setupError && <p role="alert">{setupError}</p>}
      {p && !scheduled && (
        <div className="button-row">
          <button
            type="button"
            className="btn secondary"
            onClick={() => edit('product', p)}
          >
            Edit product setup
          </button>
          {recipe && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => edit('recipe', recipe)}
            >
              Edit recipe / yield / conversions
            </button>
          )}
        </div>
      )}
      {scheduled && (
        <>
          <div className="form-grid">
            <label>
              Actual usable output (packages)
              <input
                type="number"
                min="1"
                step="1"
                value={output}
                onChange={(e) => setOutput(e.target.value)}
              />
            </label>
            <label>
              Output waste (packages)
              <input
                type="number"
                min="0"
                step="1"
                value={waste}
                onChange={(e) => setWaste(e.target.value)}
              />
            </label>
            <label>
              Actual labor (minutes)
              <input
                type="number"
                min="0"
                step="any"
                placeholder={String(result?.cost.laborMinutes || 0)}
                value={labor}
                onChange={(e) => setLabor(e.target.value)}
              />
            </label>
            <label>
              Waste reason
              <input
                value={wasteReason}
                onChange={(e) => setWasteReason(e.target.value)}
              />
            </label>
          </div>
          <p>
            Only usable output enters finished stock. Review actual usage before
            completion.
          </p>
        </>
      )}
      {result && review && (
        <section>
          <h3>{kit ? 'Assembly requirements' : 'Production requirements'}</h3>
          <p>
            {kit
              ? 'Uses existing finished stock. Component manufacturing is separate.'
              : `${result.multiplier.toFixed(4)} recipe batches · ${quantity} requested selling packages`}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Required</th>
                  <th>Available</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {result.requirements.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td>
                      {l.quantity.toFixed(3)} {l.unit}
                    </td>
                    <td>
                      {l.tracked
                        ? availableQuantity(l) == null
                          ? 'Conversion needs review'
                          : `${availableQuantity(l)!.toFixed(3)} ${l.unit}`
                        : 'Not tracked'}
                    </td>
                    <td>
                      {shortages.some((s) => s.id === l.id) ? (
                        <>
                          Shortage
                          {l.kind === 'product' &&
                            workflowOf(
                              availability(l) || { id: '', name: '' },
                            ) !== 'resale' && (
                              <button
                                type="button"
                                className="btn secondary"
                                onClick={() => startComponent(l.itemId)}
                              >
                                Produce separately
                              </button>
                            )}
                        </>
                      ) : (
                        'Available'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Estimated stock cost + labor/allocations:{' '}
            {costIncomplete
              ? 'Cost incomplete — review stock cost setup.'
              : money(
                  result.requirements.reduce(
                    (sum, l) => sum + estimatedInputCost(l),
                    0,
                  ) +
                    result.cost.labor +
                    result.cost.overhead +
                    result.cost.waste +
                    (definition?.recipe
                      ? Number(definition.recipe.packagingCost || 0) *
                        result.multiplier
                      : 0),
                )}
          </p>
          <details>
            <summary>
              Calculation details{scheduled ? ' and actual ingredient use' : ''}
            </summary>
            <p>
              Stock costs are locked at completion. Selling price is excluded.
              Packaging and configured labor are included once.
            </p>
            {scheduled &&
              !kit &&
              result.requirements
                .filter(
                  (l) =>
                    l.kind === 'ingredient' &&
                    l.source.ingredientId &&
                    !definition?.product.packagingLines?.some(
                      (p: Item) => p.ingredientId === l.itemId,
                    ),
                )
                .map((l) => (
                  <div key={l.id} className="form-grid">
                    <label>
                      {l.name} actual use ({l.unit})
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={
                          usage[l.itemId] ??
                          l.quantity - Number(materialWaste[l.itemId] || 0)
                        }
                        onChange={(e) =>
                          setUsage({ ...usage, [l.itemId]: e.target.value })
                        }
                      />
                    </label>
                    {p.workflow === 'handmade' && (
                      <label>
                        {l.name} material waste ({l.unit})
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={materialWaste[l.itemId] || '0'}
                          onChange={(e) =>
                            setMaterialWaste({
                              ...materialWaste,
                              [l.itemId]: e.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                ))}
          </details>
        </section>
      )}
      <p>
        Drafts and plans move no stock. Completion consumes requirements and
        receives usable output atomically.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="button-row">
        {!scheduled && (
          <>
            <button
              type="button"
              className="btn secondary"
              disabled={busy || !p}
              onClick={() => act('productionSave', 'draft')}
            >
              Save draft
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !!setupError || !result}
              onClick={() =>
                review ? act('productionSave', 'scheduled') : setReview(true)
              }
            >
              {review ? 'Confirm plan' : 'Review requirements'}
            </button>
          </>
        )}
        {scheduled && (
          <button
            type="button"
            className="btn"
            disabled={
              busy || !!setupError || !!costIncomplete || shortages.length > 0
            }
            onClick={() => act('productionComplete')}
          >
            {kit ? 'Confirm assembly' : 'Confirm production'}
          </button>
        )}
        {run && (
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => act('productionCancel')}
          >
            Cancel run
          </button>
        )}
      </div>
    </div>
  )
}
