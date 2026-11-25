import { useEffect, useRef, useState } from 'react'
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
  basketChecklist,
  basketChecklistIssues,
  basketDefinitionChanged,
  checklistStages,
  type ChecklistStage,
} from '@/lib/production-checklist'
import {
  basketAssignments,
  productionOrderInvoices,
} from '@/lib/production-destinations'
import { productionDefinition } from '@/lib/production'
import { basketAllocationIssues, basketProduction } from '@/lib/basket-production'
import { ovenToday } from '@/lib/oven-dates'
import { ProductionBasketChecklist } from './production-basket-checklist'
import { BasketProductionWork } from './basket-production-work'
import { ProductionMarketSummary } from './production-market-summary'
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

function staleBasket(line: Item, state: Workspace) {
  if (line.definition?.product?.workflow !== 'kit') return false
  const product = state.products.find(
    (entry) => entry.id === line.productId && !entry.archived,
  )
  try {
    return (
      !product ||
      basketDefinitionChanged(
        line,
        productionDefinition(product, state, line.mapping || {}),
        state,
      )
    )
  } catch {
    return true
  }
}

export function productionStage(
  run: Item,
  state?: Workspace,
): Stage | undefined {
  if (run.status === 'completed') return 'Completed'
  if (
    run.status === 'in_progress' ||
    (run.productionVersion && run.status === 'scheduled')
  ) {
    if (state && run.productionVersion && run.status === 'scheduled') {
      const lines = productionRunLines(run)
      const calculation = combinedProductionRequirements(lines, state)
      if (
        calculation.costKnown &&
        !productionReviewIssues(lines, calculation).length &&
        !basketChecklistIssues(lines, state, checklistStages).length &&
        !basketAllocationIssues(lines, state, run.id).length &&
        !lines.some((line) => staleBasket(line, state))
      )
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
        ...lines.flatMap((line) =>
          basketAssignments(line).map(
            (assignment) =>
              state.batches.find((entry) => entry.id === assignment.runId)
                ?.eventId,
          ),
        ),
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
        productionOrderInvoices(state).find((order) => order.id === run.orderId)
          ?.name ||
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
    type: lines.some(
      (line) =>
        line.definition?.product?.workflow === 'kit' ||
        state.products.find((item) => item.id === line.productId)?.workflow ===
          'kit',
    )
      ? 'Basket assembly'
      : run.orderId
        ? 'Customer order'
        : eventIds.length
          ? 'Market / event'
          : 'Stock replenishment',
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
          ...lines
            .filter((line) => staleBasket(line, state))
            .map(
              (line) =>
                `${line.name}: basket contents changed. Save the updated plan and review the checklist.`,
            ),
          ...check.products.flatMap((line) => (line.error ? [line.error] : [])),
          ...check.shortages.filter((line) => line.kind !== 'product' || !lines.some((entry) => entry.basketPlan)).map(
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
  plan,
  mutate,
}: {
  state: Workspace
  busy: boolean
  canStart: boolean
  canComplete: boolean
  open: (run: Item, destination?: Stage) => void
  plan: (eventId?: string) => void
  mutate: (
    action: string,
    table: string,
    data: Record<string, unknown>,
  ) => Promise<unknown>
}) {
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [through, setThrough] = useState('')
  const [product, setProduct] = useState('')
  const [linked, setLinked] = useState('')
  const [type, setType] = useState('')
  const [view, setView] = useState<'active' | 'completed'>('active')
  const [group, setGroup] = useState(false)
  const [horizontal, setHorizontal] = useState(false)
  const [layout, setLayout] = useState<'board' | 'list'>('board')
  const [period, setPeriod] = useState('all')
  const [announcement, setAnnouncement] = useState('')
  const [dropNotice, setDropNotice] = useState('')
  const [status, setStatus] = useState<Stage | ''>('')
  const [mobileStage, setMobileStage] = useState<Stage>('Planned')
  const [history, setHistory] = useState(6)
  const [drag, setDrag] = useState<Item>()
  const touchOrigin = useRef<{ left: number; top: number } | null>(null)
  const [focused, setFocused] = useState<{ id: string; stage: Stage }>()
  const cards = state.batches
    .map((run) => runContext(run, state))
    .filter((card) => card.stage)
  const relationships = new Map([
    ...(state.events || []).map(
      (event) => [`event:${event.id}`, event.name] as const,
    ),
    ...cards.flatMap((card) =>
      card.linked.map((link) => [link.id, link.name] as const),
    ),
  ])
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
      (!type || card.type === type),
  )
  const market = state.events?.find((event) => `event:${event.id}` === linked)
  const completedCount = filtered.filter(
    (card) => card.stage === 'Completed',
  ).length
  const visibleStages = view === 'completed' ? ['Completed' as const] : stages
  const focusedStage = cards.find((card) => card.run.id === focused?.id)?.stage
  useEffect(() => {
    if (focusedStage && focused && focused.stage !== focusedStage) {
      setMobileStage(focusedStage)
      if (focusedStage === 'Completed') setView('completed')
      setStatus((current) => (current ? focusedStage : current))
      setFocused({ ...focused, stage: focusedStage })
    }
  }, [focused, focusedStage])
  const allowed = (run: Item) =>
    productionDestinations(run, state).filter((stage) =>
      stage === 'In Progress' ? canStart : canComplete,
    )
  function move(run: Item, destination?: Stage) {
    if (busy) return
    if (destination && !allowed(run).includes(destination)) {
      const next = allowed(run)[0]
      setDropNotice(
        next
          ? `Cannot move directly to ${destination}. Review the next step toward ${next}.`
          : 'This run cannot move. Open it to review the record.',
      )
      return
    }
    setDropNotice('')
    const stage = productionStage(run, state)
    if (stage) setFocused({ id: run.id, stage })
    if (destination)
      setAnnouncement(
        `${destination}: review ${run.name} to continue. The card stays in place until changes are saved.`,
      )
    open(run, destination)
  }
  function datePeriod(value: string) {
    setPeriod(value)
    const today = ovenToday(state.settings[0])
    if (value === 'today') { setFrom(today); setThrough(today) }
    if (value === 'week') {
      const start = new Date(`${today}T12:00:00Z`)
      start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7)
      setFrom(start.toISOString().slice(0, 10))
      start.setUTCDate(start.getUTCDate() + 6)
      setThrough(start.toISOString().slice(0, 10))
    }
    if (value === 'all') { setFrom(''); setThrough('') }
  }
  return (
    <section className="production-board" aria-label="Production board">
      <div className="production-board-toolbar">
        <button type="button" className="btn" disabled={busy || !canStart} onClick={() => plan(market?.id)}>Plan production</button>
        <div role="group" aria-label="Production view" className="basket-checklist-tabs">
          <button type="button" aria-pressed={layout === 'board'} onClick={() => setLayout('board')}>Board</button>
          <button type="button" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>List</button>
        </div>
        <div
          role="group"
          aria-label="Production history"
          className="basket-checklist-tabs"
        >
          <button
            type="button"
            aria-pressed={view === 'active'}
            onClick={() => {
              setView('active')
              setStatus('')
              setMobileStage('Planned')
            }}
          >
            Active <span>{filtered.length - completedCount}</span>
          </button>
          <button
            type="button"
            aria-pressed={view === 'completed'}
            onClick={() => {
              setView('completed')
              setStatus('')
              setMobileStage('Completed')
            }}
          >
            Completed <span>{completedCount}</span>
          </button>
        </div>
      </div>
      <div className="production-board-filters">
        <label>Search runs
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>Production dates
          <select value={period} onChange={(event) => datePeriod(event.target.value)}>
            <option value="all">All dates</option><option value="today">Today</option><option value="week">This week</option><option value="custom">Custom date range</option>
          </select>
        </label>
        <label>Market, event, or order
          <select value={linked} onChange={(event) => setLinked(event.target.value)}>
            <option value="">All destinations</option>
            {[...relationships].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <button type="button" className="btn secondary" onClick={() => { datePeriod('all'); setLinked(''); setQuery(''); setStatus(''); setType(''); setProduct('') }}>Clear filters</button>
        {period === 'custom' && <><label>
          From
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label><label>
          Through
          <input
            type="date"
            value={through}
            onChange={(event) => setThrough(event.target.value)}
          />
        </label></>}
      </div>
      <details className="production-board-more"><summary>Additional filters and layout</summary>
      <div className="production-board-filters">
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
          Production type
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="">All types</option>
            {[
              'Market / event',
              'Stock replenishment',
              'Customer order',
              'Basket assembly',
            ].map((choice) => (
              <option key={choice}>{choice}</option>
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
            {visibleStages
              .filter((stage) => view === 'completed' || stage !== 'Completed')
              .map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
          </select>
        </label>
        <div className="basket-checklist-tabs" role="group" aria-label="Board layout">
          <button type="button" aria-pressed={group} onClick={() => setGroup(!group)}>Group by market</button>
          {layout === 'board' && <button type="button" aria-pressed={horizontal} onClick={() => setHorizontal(!horizontal)}>Horizontal board</button>}
        </div>
      </div>
      </details>
      {!filtered.some((card) => (view === 'completed' ? card.stage === 'Completed' : card.stage !== 'Completed') && (!status || card.stage === status)) && <p className="calculation-box">No {view} production matches these filters. Clear filters or plan new work.</p>}
      {market && <ProductionMarketSummary event={market} state={state} />}
      <span role="status" className="sr-only">
        {announcement}
      </span>
      {dropNotice && (
        <p role="status" className="warning-text">
          {dropNotice}
        </p>
      )}
      {layout === 'board' && !status && view === 'active' && !horizontal && (
        <div
          className="production-board-mobile"
          role="group"
          aria-label="Production stage"
        >
          {stages
            .filter((stage) => stage !== 'Completed')
            .map((stage) => (
              <button
                type="button"
                key={stage}
                aria-pressed={mobileStage === stage}
                onClick={() => {
                  setFocused(undefined)
                  setMobileStage(stage)
                }}
              >
                {stage}{' '}
                <span>
                  {filtered.filter((card) => card.stage === stage).length}
                </span>
              </button>
            ))}
        </div>
      )}
      {drag && (
        <div className="production-touch-targets" aria-hidden="true">
          {allowed(drag).map((stage) => (
            <div key={stage} data-touch-drop={stage}>
              Drop to review → {stage}
            </div>
          ))}
        </div>
      )}
      <div
        className="production-board-lanes"
        data-layout={layout}
        data-horizontal={layout === 'board' && horizontal}
        data-filtered={!!status || view === 'completed'}
      >
        {visibleStages
          .filter((stage) => !status || status === stage)
          .map((stage) => {
            const inLane = filtered
              .filter(
                (card) =>
                  card.stage === stage &&
                  (view === 'completed' || stage !== 'Completed'),
              )
              .sort(
                (first, second) =>
                  (group
                    ? (
                        first.linked.find((link) =>
                          link.id.startsWith('event:'),
                        )?.name || 'No market'
                      ).localeCompare(
                        second.linked.find((link) =>
                          link.id.startsWith('event:'),
                        )?.name || 'No market',
                      )
                    : 0) ||
                  (stage === 'Completed'
                    ? String(
                        second.run.completedAt || second.run.date || '',
                      ).localeCompare(
                        String(first.run.completedAt || first.run.date || ''),
                      )
                    : String(first.run.date || '').localeCompare(
                        String(second.run.date || ''),
                      )),
              )
            const validDrop = drag && allowed(drag).includes(stage)
            return (
              <section
                key={stage}
                className="production-board-lane"
                data-mobile-active={
                  view === 'completed' || (status || mobileStage) === stage
                }
                data-drop={!!validDrop}
                onDragOver={(event) => {
                  if (drag) {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (drag) move(drag, stage)
                  setDrag(undefined)
                }}
              >
                <h3>
                  {stage} <span>{inLane.length}</span>
                </h3>
                {!inLane.length && (
                  <p className="muted">
                    {stage === 'Completed' && view === 'active'
                      ? 'Drop a ready run here to open final review, or switch to Completed to see history.'
                      : 'No runs match this stage and your filters.'}
                  </p>
                )}
                {inLane
                  .slice(0, stage === 'Completed' ? history : undefined)
                  .map((card, index) => {
                    const { run, recipe, products, lines, linked: links } = card
                    const { warnings, prep } = stockNotes(card, state)
                    const destinations = allowed(run)
                    const groupName = (entry: typeof card) =>
                      entry.linked.find((link) => link.id.startsWith('event:'))
                        ?.name || 'No market'
                    const checklistStage: ChecklistStage =
                      stage === 'Planned'
                        ? 'reviewed'
                        : stage === 'In Progress' &&
                            lines.some((line) => !Number(line.output))
                          ? 'picked'
                          : 'packed'
                    const reviewItems = lines
                      .flatMap((line) =>
                        basketChecklist(line, state, checklistStage),
                      )
                      .filter((entry) => !entry.supply)
                    const contents = lines.flatMap((line) => basketProduction(line, state, run.id))
                    const needsContents = contents.some((row) => row.ready < row.packingRequired)
                    const packed = lines.flatMap((line) => basketChecklist(line, state, 'packed')).filter((entry) => !entry.supply)
                    const parents = [...new Set(lines.flatMap((line) => basketAssignments(line).map((entry) => entry.runId)))].flatMap((id) => state.batches.filter((entry) => entry.id === id))
                    return (
                      <div className="production-board-card-slot" key={run.id}>
                        {group &&
                          (!index ||
                            groupName(inLane[index - 1]) !==
                              groupName(card)) && <h4>{groupName(card)}</h4>}
                        <article className="production-board-card">
                          <small className="production-card-type">
                            {card.type}
                          </small>
                          <div className="production-board-card-title">
                            <button
                              type="button"
                              className="text-button"
                              onClick={() =>
                                move(
                                  run,
                                  stage === 'Ready to Finalize'
                                    ? destinations[0]
                                    : undefined,
                                )
                              }
                            >
                              {run.name === 'Production run' ? products.join(', ') || recipe?.name || run.name : run.name}{' '}
                              <ArrowRight size={14} aria-hidden="true" />
                            </button>
                            {!!destinations.length && !busy && (
                              <span
                                className="production-board-grip"
                                aria-hidden="true"
                                draggable
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = 'move'
                                  event.dataTransfer.setData(
                                    'text/plain',
                                    run.id,
                                  )
                                  setDrag(run)
                                }}
                                onDragEnd={() => setDrag(undefined)}
                                onPointerDown={(event) => {
                                  if (event.pointerType === 'mouse') return
                                  touchOrigin.current = {
                                    left: event.clientX,
                                    top: event.clientY,
                                  }
                                  event.currentTarget.setPointerCapture(
                                    event.pointerId,
                                  )
                                }}
                                onPointerMove={(event) => {
                                  if (
                                    touchOrigin.current &&
                                    Math.hypot(
                                      event.clientX - touchOrigin.current.left,
                                      event.clientY - touchOrigin.current.top,
                                    ) >= 12
                                  )
                                    setDrag(run)
                                }}
                                onPointerUp={(event) => {
                                  if (!touchOrigin.current) return
                                  const target = document
                                    .elementFromPoint(
                                      event.clientX,
                                      event.clientY,
                                    )
                                    ?.closest<HTMLElement>('[data-touch-drop]')
                                    ?.dataset.touchDrop as Stage | undefined
                                  touchOrigin.current = null
                                  setDrag(undefined)
                                  if (target) move(run, target)
                                  else if (drag)
                                    setDropNotice(
                                      'Move canceled. The run stays in its current stage. Use the next-action button to continue.',
                                    )
                                }}
                                onPointerCancel={() => {
                                  touchOrigin.current = null
                                  setDrag(undefined)
                                }}
                              >
                                <GripVertical size={20} />
                              </span>
                            )}
                          </div>
                          {!lines.length &&
                            (products.length > 0 ||
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
                          {lines.length ? (
                            <ul className="production-card-output">
                              {lines.map((line) => (
                                <li key={line.id}>
                                  {line.name}: {line.quantity}{' '}
                                  {line.definition?.product?.workflow === 'kit'
                                    ? 'baskets'
                                    : 'packages'}{' '}
                                  planned
                                  {line.actualYield != null ||
                                  Number(line.output) > 0
                                    ? ` · ${line.actualYield ?? line.output} ${stage === 'Completed' ? 'completed' : 'recorded'}`
                                    : ''}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>
                              Planned: {run.yield ?? run.quantity ?? '—'}{' '}
                              {recipe?.yieldUnit || run.unit || 'units'}
                            </p>
                          )}
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
                            <ul>
                              {links.map((link) => (
                                <li key={link.id}>
                                  {link.id.startsWith('event:') ? (
                                    <a
                                      href={`#Events/List?event=${encodeURIComponent(link.id.slice(6))}`}
                                    >
                                      {link.name}
                                    </a>
                                  ) : (
                                    `Order: ${link.name}`
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {parents.map((parent) => <button key={parent.id} type="button" className="text-button" onClick={() => open(parent)}>Basket: {parent.name}</button>)}
                          {!!contents.length && <>
                            <p><strong>Contents ready: {stage === 'Completed' ? contents.length : contents.filter((row) => row.ready >= row.packingRequired).length} of {contents.length}</strong> · Packed: {packed.filter((entry) => entry.mark?.checked).length} of {contents.length}</p>
                            {stage !== 'Completed' && needsContents && <ul>{contents.filter((row) => row.ready < row.packingRequired).map((row) => <li key={row.component.productId}>{row.name}: {row.packingRequired - row.ready} packages {row.setup ? 'need setup' : row.resale ? 'to obtain' : 'still needed'}.</li>)}</ul>}
                            <details className="basket-board-checklist"><summary>Component production</summary>{lines.map((line) => <BasketProductionWork key={line.id} line={line} state={state} parentId={run.id} open={(component) => move(component)} disabled={busy} />)}</details>
                          </>}
                          {!!reviewItems.length && (
                            <p className="muted">
                              Products {checklistStage}:{' '}
                              {
                                reviewItems.filter(
                                  (entry) => entry.mark?.checked,
                                ).length
                              }{' '}
                              of {reviewItems.length}
                            </p>
                          )}
                          {lines.map((line) => (
                            <ProductionBasketChecklist
                              key={line.id}
                              run={run}
                              line={line}
                              state={state}
                              busy={busy}
                              stage={checklistStage}
                              save={
                                canComplete && !staleBasket(line, state)
                                  ? (data) => {
                                      setFocused({ id: run.id, stage })
                                      return mutate(
                                        'productionChecklist',
                                        'batches',
                                        data,
                                      )
                                    }
                                  : undefined
                              }
                            />
                          ))}
                          {stage !== 'Completed' &&
                            !contents.length && !(warnings.length || prep.length) && (
                              <p className="muted">
                                No material blockers in the current preview.
                              </p>
                            )}
                          {!!(warnings.length || prep.length) && (
                            <details className="production-board-warning">
                              <summary>
                                {warnings.length
                                  ? warnings[0]
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
                          <button
                            type="button"
                            className="btn production-board-next"
                            disabled={busy}
                            onClick={() => move(run, destinations[0])}
                          >
                            {stage === 'Completed'
                              ? 'View completed run'
                              : !destinations.length
                                ? 'View run'
                                : stage === 'Planned'
                                  ? contents.length ? 'Review & start basket' : 'Review & start'
                                  : stage === 'In Progress'
                                    ? contents.length ? needsContents ? 'Make contents' : 'Pack baskets' : lines.length > 0 &&
                                      lines.every(
                                        (line) => Number(line.output) > 0,
                                      )
                                      ? 'Review blockers'
                                      : 'Record output'
                                    : 'Review & finalize'}
                          </button>
                          {stage === 'Completed' ? (
                            <small>Finalized · no backward moves</small>
                          ) : (
                            !destinations.length && (
                              <small>Your role cannot advance this run.</small>
                            )
                          )}
                        </article>
                      </div>
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
