import { useEffect, useState } from 'react'
import { ArrowRight, GripVertical } from 'lucide-react'
import {
  convert,
  recipeProductionLines,
  type Item,
  type Workspace,
} from '@/lib/domain'
import { inventoryQuantity } from '@/lib/inventory-quantity'
import { matchingPreparedLots } from '@/lib/prepared-requirement'
import {
  combinedProductionRequirements,
  productionReviewIssues,
  productionRunLines,
} from '@/lib/production-run'
import './production-board.css'

const stages = [
  'Planned',
  'In Progress',
  'Ready to Finalize',
  'Completed',
] as const
type Stage = (typeof stages)[number]

export function productionStage(run: Item, state?: Workspace): Stage | undefined {
  if (run.status === 'completed') return 'Completed'
  if (
    run.status === 'in_progress' ||
    (run.productionVersion && run.status === 'scheduled')
  ) {
    if (state && run.productionVersion && run.status === 'scheduled') {
      const lines = productionRunLines(run)
      const calculation = combinedProductionRequirements(lines, state)
      if (calculation.costKnown && !productionReviewIssues(lines, calculation).length)
        return 'Ready to Finalize'
    }
    return 'In Progress'
  }
  if (run.status === 'scheduled') return 'Planned'
  if (['draft', 'planned'].includes(run.status)) return 'Planned'
}

export function productionDestinations(run: Item, state?: Workspace): Stage[] {
  const stage = productionStage(run, state)
  if (stage === 'Planned') return ['In Progress']
  if (stage === 'In Progress') return ['Ready to Finalize']
  if (stage === 'Ready to Finalize') return ['Completed']
  return []
}

function runContext(run: Item, state: Workspace) {
  const recipe = state.recipes.find((entry) => entry.id === run.recipeId)
  const lines = run.productionVersion ? productionRunLines(run) : []
  const productIds = [
    ...new Set(
      [run.productId, ...lines.map((line) => line.productId)].filter(Boolean),
    ),
  ]
  const recipeIds = [
    ...new Set(
      [
        run.recipeId,
        ...lines.map((line) => line.definition?.recipe?.id),
      ].filter(Boolean),
    ),
  ]
  const products = lines.length
    ? lines
        .map(
          (line) =>
            line.name ||
            state.products.find((entry) => entry.id === line.productId)?.name,
        )
        .filter(Boolean)
    : state.products
        .filter((entry) => productIds.includes(entry.id))
        .map((entry) => entry.name)
  const eventIds = [
    ...new Set(
      [
        run.eventId,
        ...(state.event_batch_links || [])
          .filter((link) => link.recordId === run.id)
          .map((link) => link.eventId),
      ].filter(Boolean),
    ),
  ]
  const linked = eventIds.map((id) => ({
    id: `event:${id}`,
    name:
      state.events?.find((event) => event.id === id)?.name || 'Linked event',
  }))
  if (run.orderId)
    linked.push({
      id: `order:${run.orderId}`,
      name:
        run.orderName ||
        state.orders?.find((order) => order.id === run.orderId)?.name ||
        `Order ${run.orderId}`,
    })
  return {
    run,
    recipe,
    lines,
    productIds,
    recipeIds,
    products,
    linked,
    stage: productionStage(run, state),
  }
}

function stockNotes(card: ReturnType<typeof runContext>, state: Workspace) {
  const { run, recipe, lines } = card
  if (run.status === 'completed') return { warnings: [], prep: [] }
  try {
    if (run.productionVersion) {
      const check = combinedProductionRequirements(lines, state)
      return {
        warnings: [
          ...check.products.flatMap((line) => (line.error ? [line.error] : [])),
          ...check.shortages.map(
            (line) =>
              `${line.name}: short ${inventoryQuantity(line.quantity - line.available)} ${line.unit}`,
          ),
        ],
        prep: [
          ...new Set([
            ...check.allocationIssues,
            ...check.requirements.flatMap((line) =>
              line.source?.prepared
                ? [
                    `${line.name}: ${line.source.prepared.method} portions required`,
                  ]
                : line.source?.componentRecipeId
                  ? [`Verify prepared component: ${line.name}`]
                  : [],
            ),
          ]),
        ],
      }
    }
    if (!recipe)
      return { warnings: ['Recipe or materials need review.'], prep: [] }
    const warnings: string[] = [],
      prep: string[] = []
    for (const line of recipeProductionLines(
      recipe,
      state.ingredients,
      state.recipes,
    )) {
      const item = state.ingredients.find(
        (entry) => entry.id === line.ingredientId,
      )
      if (!item) {
        warnings.push('An input is unavailable.')
        continue
      }
      if (item.trackInventory === false) continue
      const required = convert(
        line.quantity * Number(run.count || 1),
        line.unit,
        item.unit,
        item.conversions,
      )
      const available = line.prepared
        ? Math.max(
            0,
            ...matchingPreparedLots(item, state.lots || [], line.prepared).map(
              (lot) => lot.quantity,
            ),
          )
        : Number(item.quantity || 0)
      if (required > available + 1e-8)
        warnings.push(
          `${item.name}: short ${inventoryQuantity(required - available)} ${item.unit}`,
        )
      if (line.prepared || line.componentRecipeId || item.compoundRecipeId)
        prep.push(
          `${item.name}: ${line.prepared?.method || 'prepared component'} required`,
        )
    }
    return { warnings, prep }
  } catch (error) {
    return { warnings: [(error as Error).message], prep: [] }
  }
}

export function ProductionBoard({
  state,
  busy,
  canStart,
  canComplete,
  open,
}: {
  state: Workspace
  busy: boolean
  canStart: boolean
  canComplete: boolean
  open: (run: Item, destination?: Stage) => void
}) {
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [through, setThrough] = useState('')
  const [product, setProduct] = useState('')
  const [linked, setLinked] = useState('')
  const [status, setStatus] = useState<Stage | ''>('')
  const [mobileStage, setMobileStage] = useState<Stage>('Planned')
  const [history, setHistory] = useState(6)
  const [drag, setDrag] = useState<Item>()
  const [focused, setFocused] = useState<{ id: string; stage: Stage }>()
  const cards = state.batches
    .map((run) => runContext(run, state))
    .filter((card) => card.stage)
  const relationships = new Map(
    cards.flatMap((card) =>
      card.linked.map((link) => [link.id, link.name] as const),
    ),
  )
  const choices = new Map([
    ...state.recipes
      .filter((recipe) =>
        cards.some((card) => card.recipeIds.includes(recipe.id)),
      )
      .map(
        (recipe) => [`recipe:${recipe.id}`, `${recipe.name} (recipe)`] as const,
      ),
    ...state.products
      .filter((entry) =>
        cards.some((card) => card.productIds.includes(entry.id)),
      )
      .map(
        (entry) => [`product:${entry.id}`, `${entry.name} (product)`] as const,
      ),
  ])
  const filtered = cards.filter(
    (card) =>
      (!query.trim() ||
        [
          card.run.name,
          card.run.note,
          card.recipe?.name,
          ...card.products,
          ...card.linked.map((link) => link.name),
        ]
          .join(' ')
          .toLowerCase()
          .includes(query.trim().toLowerCase())) &&
      (!from || (card.run.date && card.run.date >= from)) &&
      (!through || (card.run.date && card.run.date <= through)) &&
      (!product ||
        card.recipeIds.some((id) => `recipe:${id}` === product) ||
        card.productIds.some((id) => `product:${id}` === product)) &&
      (!linked || card.linked.some((link) => link.id === linked)) &&
      (!status || card.stage === status),
  )
  const focusedStage = cards.find((card) => card.run.id === focused?.id)?.stage
  useEffect(() => {
    if (focusedStage && focused && focused.stage !== focusedStage) {
      setMobileStage(focusedStage)
      setStatus((current) => current ? focusedStage : current)
      setFocused({ ...focused, stage: focusedStage })
    }
  }, [focused, focusedStage])
  const allowed = (run: Item) =>
    productionDestinations(run, state).filter((stage) =>
      stage === 'In Progress' ? canStart : canComplete,
    )
  function move(run: Item, destination?: Stage) {
    if (busy || (destination && !allowed(run).includes(destination))) return
    const stage = productionStage(run, state)
    if (stage) setFocused({ id: run.id, stage })
    open(run, destination)
  }
  return (
    <section className="production-board" aria-label="Production board">
      <div className="production-board-intro">
        <h2>Production board</h2>
        <p>
          Plan the run, start it, record what you made, then review before posting stock.
        </p>
      </div>
      <div className="production-board-filters">
        <label>
          Search runs
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          Through
          <input
            type="date"
            value={through}
            onChange={(event) => setThrough(event.target.value)}
          />
        </label>
        <label>
          Recipe or product
          <select
            value={product}
            onChange={(event) => setProduct(event.target.value)}
          >
            <option value="">All</option>
            {[...choices].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Order or event
          <select
            value={linked}
            onChange={(event) => setLinked(event.target.value)}
          >
            <option value="">All</option>
            {[...relationships].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as Stage | '')}
          >
            <option value="">All stages</option>
            {stages.map((stage) => (
              <option key={stage}>{stage}</option>
            ))}
          </select>
        </label>
      </div>
      {!status && (
        <div className="production-board-mobile" role="group" aria-label="Production stage">
            {stages.map((stage) => (
              <button type="button" key={stage} aria-pressed={mobileStage === stage} onClick={() => { setFocused(undefined); setMobileStage(stage) }}>
                {stage} <span>{filtered.filter((card) => card.stage === stage).length}</span>
              </button>
            ))}
        </div>
      )}
      <div className="production-board-lanes" data-filtered={!!status}>
        {stages
          .filter((stage) => !status || status === stage)
          .map((stage) => {
            const inLane = filtered
              .filter((card) => card.stage === stage)
              .sort((first, second) =>
                stage === 'Completed'
                  ? String(
                      second.run.completedAt || second.run.date || '',
                    ).localeCompare(
                      String(first.run.completedAt || first.run.date || ''),
                    )
                  : String(first.run.date || '').localeCompare(
                      String(second.run.date || ''),
                    ),
              )
            const validDrop = drag && allowed(drag).includes(stage)
            return (
              <section
                key={stage}
                className="production-board-lane"
                data-mobile-active={(status || mobileStage) === stage}
                data-drop={!!validDrop}
                onDragOver={(event) => {
                  if (validDrop) {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (validDrop) void move(drag, stage)
                  setDrag(undefined)
                }}
              >
                <h3>
                  {stage} <span>{inLane.length}</span>
                </h3>
                {!inLane.length && (
                  <p className="muted">No runs in this stage.</p>
                )}
                {inLane
                  .slice(0, stage === 'Completed' ? history : undefined)
                  .map((card) => {
                    const { run, recipe, products, lines, linked: links } = card
                    const { warnings, prep } = stockNotes(card, state)
                    const destinations = allowed(run)
                    return (
                      <article className="production-board-card" key={run.id}>
                        <div className="production-board-card-title">
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => move(run, stage === 'Ready to Finalize' ? destinations[0] : undefined)}
                          >
                            {run.name}{' '}
                            <ArrowRight size={14} aria-hidden="true" />
                          </button>
                          {!!destinations.length && !busy && (
                            <span
                              className="production-board-grip"
                              aria-hidden="true"
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('text/plain', run.id)
                                setDrag(run)
                              }}
                              onDragEnd={() => setDrag(undefined)}
                            >
                              <GripVertical size={20} />
                            </span>
                          )}
                        </div>
                        {(products.length > 0 ||
                          (recipe && recipe.name !== run.name)) && (
                          <p>
                            {[
                              ...new Set([
                                ...products,
                                ...(recipe && recipe.name !== run.name
                                  ? [recipe.name]
                                  : []),
                              ]),
                            ].join(' · ')}
                          </p>
                        )}
                        <p>
                          {lines.length
                            ? `Planned: ${lines
                                .map(
                                  (line) =>
                                    `${line.quantity} ${line.definition?.bom ? 'finished units' : 'packages'}`,
                                )
                                .join(' · ')}`
                            : `Planned: ${run.yield ?? run.quantity ?? '—'} ${recipe?.yieldUnit || run.unit || 'units'}`}
                        </p>
                        {(run.date || run.dueDate) && (
                          <p className="muted">
                            {[
                              run.date && `Production ${run.date}`,
                              run.dueDate && `Due ${run.dueDate}`,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                        {!!links.length && (
                          <p>{links.map((link) => link.name).join(' · ')}</p>
                        )}
                        {stage !== 'Completed' && !(warnings.length || prep.length) && <p className="muted">No material blockers in the current preview.</p>}
                        {!!(warnings.length || prep.length) && (
                          <details className="production-board-warning">
                            <summary>
                              {warnings.length
                                ? 'Stock or setup needs review'
                                : 'Prep requirements'}
                            </summary>
                            <ul>
                              {[...new Set([...warnings, ...prep])].map(
                                (note) => (
                                  <li key={note}>{note}</li>
                                ),
                              )}
                            </ul>
                          </details>
                        )}
                        <button type="button" className="btn production-board-next" disabled={busy}
                          onClick={() => move(run, destinations[0])}>
                          {stage === 'Completed' ? 'View completed run' : !destinations.length ? 'View run' :
                            stage === 'Planned' ? 'Review & start' : stage === 'In Progress' ? 'Record output' : 'Review & finalize'}
                        </button>
                        {stage === 'Completed' ? <small>Finalized · no backward moves</small> : !destinations.length && <small>Your role cannot advance this run.</small>}
                      </article>
                    )
                  })}
                {stage === 'Completed' && inLane.length > history && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setHistory(history + 12)}
                  >
                    Show more completed runs
                  </button>
                )}
              </section>
            )
          })}
      </div>
      <p className="muted production-board-footnote">
        Canceled runs and the full completed history remain in Production Runs.
      </p>
    </section>
  )
}
