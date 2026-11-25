import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Check,
  ChevronDown,
  Clipboard,
  Download,
  ListChecks,
  Plus,
  Printer,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'
import type { Item, Workspace } from '../lib/domain'
import { marketOutput } from '../lib/production-destinations'
import { productionRunLines } from '../lib/production-run'
import {
  emptyGrocerySources,
  groceryAmount,
  groceryEmptyMessage,
  groceryGroups,
  groceryLinkedRun,
  groceryProductSummary,
  groceryQuantity,
  groceryText,
  groceryWarnings,
  isGroceryRecipe,
  isPlannedGroceryRun,
  isShoppingLine,
  type GroceryLine,
  type GroceryList,
  type GroceryMark,
  type GrocerySources,
} from '../lib/grocery-list'
import {
  belongsToGroceryOutbox,
  groceryMarkKey,
  mergeGroceryMarks,
  readGroceryOutbox,
} from '../lib/grocery-sync'
import './grocery-prep-list.css'

type Summary = Pick<GroceryList, 'id' | 'labels' | 'generatedAt'>
type ListResult = {
  list?: GroceryList
  lists?: Summary[]
  serverTime: number
  error?: string
}
const endpoint = '/api/workspace?groceryList=1'
const lastListKey = 'cp:grocery-current-list'
const allLines = (list: GroceryList) => [...list.lines, ...list.manual]
const referenceOnly = (line: GroceryLine) =>
  line.review?.endsWith('reference only')
const formatDate = (date: string) =>
  new Date(date).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

async function requestList(
  id?: string,
  data?: Record<string, unknown>,
): Promise<ListResult> {
  const result = await fetch(
    endpoint + (id && !data ? `&list=${encodeURIComponent(id)}` : ''),
    data
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, id }),
        }
      : { cache: 'no-store' },
  )
  const payload = (await result.json()) as ListResult
  if (!result.ok)
    throw new Error(
      payload.error || 'Could not connect to your saved grocery lists.',
    )
  return payload
}

function GroceryDialog({
  title,
  description,
  close,
  children,
}: {
  title: string
  description: string
  close: () => void
  children: ReactNode
}) {
  const [returnFocus] = useState(() => document.activeElement)
  return (
    <Dialog.Root
      open
      onOpenChange={(value) => {
        if (!value) close()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="grocery-dialog-overlay" />
        <Dialog.Content
          className="grocery-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (returnFocus instanceof HTMLElement) returnFocus.focus()
          }}
        >
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <Dialog.Close className="grocery-close" aria-label="Close">
            <X size={20} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const toggleSelection = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]

function SourcesEditor({
  state,
  sources,
  setSources,
  submit,
  busy,
  current,
}: {
  state: Workspace
  sources: GrocerySources
  setSources: (sources: GrocerySources) => void
  submit: (event: FormEvent<HTMLFormElement>) => void
  busy: boolean
  current: boolean
}) {
  const [recipeChoice, setRecipeChoice] = useState('')
  const planned = state.batches.filter(isPlannedGroceryRun)
  const recipes = state.recipes.filter(isGroceryRecipe)
  const linkedEvents = (state.events || []).filter(
    (event) =>
      planned.some((run) =>
        productionRunLines(run).some(
          (line) => marketOutput(run, line, event.id, state).planned > 0,
        ),
      ) ||
      state.event_batch_links?.some(
        (link) =>
          link.eventId === event.id &&
          planned.some((run) => run.id === link.recordId) &&
          link.allocations?.some((entry: Item) => entry.quantity > 0),
      ),
  )
  const update = (patch: Partial<GrocerySources>) =>
    setSources({ ...sources, ...patch })
  const updateRecipe = (
    index: number,
    patch: Partial<GrocerySources['recipes'][number]>,
  ) =>
    update({
      recipes: sources.recipes.map((recipe, position) =>
        position === index ? { ...recipe, ...patch } : recipe,
      ),
    })
  const selectable = [
    ...planned,
    ...sources.runs
      .filter((id) => !planned.some((run) => run.id === id))
      .map((id) => ({ id, name: 'Unavailable run' })),
  ]
  const eventChoices = [
    ...linkedEvents,
    ...sources.events
      .filter((id) => !linkedEvents.some((event) => event.id === id))
      .map((id) => ({ id, name: 'Unavailable event' })),
  ]
  return (
    <form className="grocery-sources" onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>Production sources</legend>
        <div className="grocery-fields">
          <label>
            From date{' '}
            <input
              type="date"
              value={sources.from}
              required={!!sources.to}
              onChange={(event) => update({ from: event.target.value })}
            />
          </label>
          <label>
            Through date{' '}
            <input
              type="date"
              value={sources.to}
              min={sources.from || undefined}
              required={!!sources.from}
              onChange={(event) => update({ to: event.target.value })}
            />
          </label>
        </div>
        <details open={!current || !!sources.runs.length}>
          <summary>
            Planned production runs · {sources.runs.length} selected
          </summary>
          {!selectable.length && <p>No planned runs are available.</p>}
          <div className="grocery-source-options">
            {selectable.map((run) => (
              <label key={run.id}>
                <input
                  type="checkbox"
                  checked={sources.runs.includes(run.id)}
                  onChange={() =>
                    update({ runs: toggleSelection(sources.runs, run.id) })
                  }
                />
                {run.name}
                {'date' in run && run.date ? ` · ${run.date}` : ''}
              </label>
            ))}
          </div>
        </details>
        {eventChoices.length > 0 && (
          <details open={!!sources.events.length}>
            <summary>
              Events with planned output · {sources.events.length} selected
            </summary>
            <p>
              Uses only existing event allocations. Selecting the whole run
              includes those allocations once.
            </p>
            <div className="grocery-source-options">
              {eventChoices.map((event) => (
                <label key={event.id}>
                  <input
                    type="checkbox"
                    checked={sources.events.includes(event.id)}
                    onChange={() =>
                      update({
                        events: toggleSelection(sources.events, event.id),
                      })
                    }
                  />
                  {event.name}
                </label>
              ))}
            </div>
          </details>
        )}
        <div className="grocery-recipe-select">
          <label>
            Recipe{' '}
            <select
              value={recipeChoice}
              onChange={(event) => setRecipeChoice(event.target.value)}
            >
              <option value="">Choose a recipe</option>
              {recipes
                .filter(
                  (recipe) =>
                    !sources.recipes.some((choice) => choice.id === recipe.id),
                )
                .map((recipe) => (
                  <option value={recipe.id} key={recipe.id}>
                    {recipe.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="grocery-button"
            type="button"
            disabled={!recipeChoice}
            onClick={() => {
              update({
                recipes: [
                  ...sources.recipes,
                  { id: recipeChoice, amount: 1, basis: 'batches' },
                ],
              })
              setRecipeChoice('')
            }}
          >
            Add recipe
          </button>
        </div>
        {sources.recipes.map((choice, index) => {
          const recipe = recipes.find((item) => item.id === choice.id)
          return (
            <div className="grocery-recipe-source" key={choice.id}>
              <strong>{recipe?.name || 'Unavailable recipe'}</strong>
              <div className="grocery-fields">
                <label>
                  Amount{' '}
                  <input
                    type="number"
                    required
                    step="any"
                    min="0.000001"
                    max="1000000000"
                    value={Number.isNaN(choice.amount) ? '' : choice.amount}
                    onChange={(event) =>
                      updateRecipe(index, {
                        amount: event.target.valueAsNumber,
                      })
                    }
                  />
                </label>
                <label>
                  Basis{' '}
                  <select
                    value={choice.basis}
                    onChange={(event) =>
                      updateRecipe(index, {
                        basis:
                          event.target.value === 'yield' ? 'yield' : 'batches',
                      })
                    }
                  >
                    <option value="batches">Batches</option>
                    <option value="yield">
                      Output ({recipe?.yieldUnit || 'recipe yield unit'})
                    </option>
                  </select>
                </label>
                <button
                  type="button"
                  className="grocery-icon"
                  aria-label={`Remove ${recipe?.name || 'recipe'}`}
                  onClick={() =>
                    update({
                      recipes: sources.recipes.filter(
                        (_, position) => position !== index,
                      ),
                    })
                  }
                >
                  <X size={19} />
                </button>
              </div>
            </div>
          )
        })}
        <button
          className="grocery-button grocery-primary"
          disabled={
            !(
              sources.runs.length ||
              sources.events.length ||
              sources.recipes.length ||
              (sources.from && sources.to)
            )
          }
        >
          {busy
            ? 'Generating…'
            : current
              ? 'Generate new snapshot'
              : 'Generate grocery list'}
        </button>
      </fieldset>
    </form>
  )
}

function ShoppingRow({
  line,
  list,
  toggle,
  edit,
}: {
  line: GroceryLine
  list: GroceryList
  toggle: () => void
  edit: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const checked = list.marks[line.id]?.checked === true
  const detailId = `grocery-detail-${encodeURIComponent(line.id)}`
  const readOnly = referenceOnly(line)
  const content = (
    <span className="grocery-row-text">
      <strong>{line.name}</strong>
      <span>
        {groceryAmount(line, list.overrides)}
        {line.manual && ' · Manual'}
      </span>
    </span>
  )
  return (
    <li className={`grocery-row${checked ? ' grocery-checked' : ''}`}>
      <div className="grocery-row-main">
        {readOnly ? (
          <div className="grocery-row-target grocery-reference">{content}</div>
        ) : (
          <label className="grocery-row-target">
            <input
              type="checkbox"
              checked={checked}
              onChange={toggle}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.repeat) {
                  event.preventDefault()
                  toggle()
                }
              }}
            />
            <span className="grocery-check-art" aria-hidden="true">
              {checked && <Check size={19} strokeWidth={3} />}
            </span>
            {content}
          </label>
        )}
        <button
          type="button"
          className="grocery-icon grocery-expand"
          aria-label={`${expanded ? 'Hide' : 'Show'} details for ${line.name}`}
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown size={20} />
        </button>
      </div>
      <div className="grocery-row-detail" id={detailId} hidden={!expanded}>
        {expanded && (
          <>
            <dl>
              <div>
                <dt>Needed</dt>
                <dd>{groceryQuantity(line.needed, line.unit)}</dd>
              </div>
              <div>
                <dt>On hand</dt>
                <dd>
                  {line.onHand === undefined
                    ? 'Not available'
                    : groceryQuantity(
                        line.onHand,
                        line.onHandUnit || line.unit,
                      )}
                </dd>
              </div>
              <div>
                <dt>Still to buy</dt>
                <dd>
                  {line.toBuy === undefined
                    ? 'Review needed'
                    : groceryQuantity(line.toBuy, line.unit)}
                </dd>
              </div>
              {line.packages !== undefined && (
                <div>
                  <dt>Suggested packages</dt>
                  <dd>
                    {line.packages} ·{' '}
                    {groceryQuantity(line.leftover ?? 0, line.unit)} left over
                  </dd>
                </div>
              )}
              <div>
                <dt>Vendor</dt>
                <dd>{line.vendor || 'No vendor'}</dd>
              </div>
              {line.estimate !== undefined && (
                <div>
                  <dt>Estimated cost</dt>
                  <dd>
                    {new Intl.NumberFormat(undefined, {
                      style: 'currency',
                      currency: /^[A-Z]{3}$/.test(line.currency || '')
                        ? line.currency
                        : 'USD',
                    }).format(line.estimate)}
                    {list.overrides[line.id] !== undefined &&
                      ' for suggested amount'}
                  </dd>
                </div>
              )}
            </dl>
            {!!line.sources.length && (
              <div>
                <strong>Used in:</strong>
                <ul>
                  {line.sources.map((source) => (
                    <li key={source}>{source}</li>
                  ))}
                </ul>
              </div>
            )}
            {line.notes && (
              <p>
                <strong>Notes:</strong> {line.notes}
              </p>
            )}
            {!line.review && (
              <button
                className="grocery-button"
                type="button"
                onClick={(event) => {
                  event.currentTarget.focus()
                  edit()
                }}
              >
                Edit shopping quantity
              </button>
            )}
          </>
        )}
      </div>
    </li>
  )
}

export function GroceryPrepList({
  state,
  ready,
  role,
}: {
  state: Workspace
  ready: boolean
  role: string
}) {
  const allowed =
    ready && ['Owner', 'Manager', 'Production Staff'].includes(role)
  const [list, setList] = useState<GroceryList>()
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [sources, setSources] = useState<GrocerySources>(emptyGrocerySources)
  const [editingSources, setEditingSources] = useState(false)
  const [view, setView] = useState<'products' | 'shop' | 'prep'>('shop')
  const [groupBy, setGroupBy] = useState<'vendor' | 'category'>('vendor')
  const [hideChecked, setHideChecked] = useState(false)
  const [checkedLast, setCheckedLast] = useState(false)
  const [showStock, setShowStock] = useState(false)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dialog, setDialog] = useState<
    'manual' | 'clear' | 'uncheck' | GroceryLine
  >()
  const [manualId, setManualId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<GroceryMark[]>([])
  const [storageFailed, setStorageFailed] = useState(false)
  const [disconnected, setDisconnected] = useState(false)
  const active = useRef('')
  const sequence = useRef(0)
  const applied = useRef(0)
  const delta = useRef(0)
  const inFlight = useRef(new Set<string>())
  const volatile = useRef(new Map<string, GroceryMark[]>())
  const generation = useRef<{ key: string; id: string } | undefined>(undefined)
  const floating = useRef<HTMLButtonElement>(null)

  function clock(payload: ListResult) {
    if (Number.isFinite(payload.serverTime))
      delta.current = payload.serverTime - Date.now()
  }
  function outbox(id: string) {
    try {
      return [
        ...readGroceryOutbox(localStorage, id),
        ...(volatile.current.get(id) || []),
      ]
    } catch {
      return volatile.current.get(id) || []
    }
  }
  function accept(snapshot: GroceryList, ticket: number) {
    if (active.current !== snapshot.id) return
    setList((previous) => {
      if (!previous || previous.id !== snapshot.id) return snapshot
      return {
        ...(ticket >= applied.current ? snapshot : previous),
        marks: mergeGroceryMarks(previous.marks, Object.values(snapshot.marks)),
      }
    })
    applied.current = Math.max(applied.current, ticket)
  }
  function activate(snapshot: GroceryList) {
    active.current = snapshot.id
    applied.current = ++sequence.current
    setList(snapshot)
    setPending(outbox(snapshot.id))
    setSources(snapshot.sources)
    setEditingSources(false)
    setView('shop')
    setQuery('')
    setCollapsed({})
    try {
      sessionStorage.setItem(lastListKey, snapshot.id)
    } catch {
      return
    }
  }
  async function load(id?: string) {
    setLoading(true)
    setError('')
    try {
      if (!id) {
        const payload = await requestList()
        clock(payload)
        setSummaries(payload.lists || [])
        let last: string | null = null
        try {
          last = sessionStorage.getItem(lastListKey)
        } catch {
          last = null
        }
        id =
          payload.lists?.find((summary) => summary.id === last)?.id ||
          payload.lists?.[0]?.id
      }
      if (id) {
        const payload = await requestList(id)
        clock(payload)
        if (payload.list) activate(payload.list)
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not load your saved lists.',
      )
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (allowed) void load()
  }, [allowed])

  async function sync(id: string) {
    if (inFlight.current.has(id) || !navigator.onLine) return
    inFlight.current.add(id)
    try {
      do {
        const edits = outbox(id)
        const latest = Object.values(mergeGroceryMarks({}, edits)).slice(0, 200)
        const ticket = ++sequence.current
        const payload = await requestList(
          id,
          latest.length ? { action: 'marks', marks: latest } : undefined,
        )
        clock(payload)
        if (payload.list) accept(payload.list, ticket)
        if (active.current === id) setDisconnected(false)
        if (!latest.length) {
          if (active.current === id && outbox(id).length) continue
          break
        }
        const sentRows = new Set(latest.map((mark) => mark.row))
        const confirmed = edits.filter((mark) => sentRows.has(mark.row))
        const confirmedTokens = new Set(confirmed.map((mark) => mark.token))
        for (const mark of confirmed) {
          try {
            localStorage.removeItem(groceryMarkKey(id, mark))
          } catch {
            continue
          }
        }
        volatile.current.set(
          id,
          (volatile.current.get(id) || []).filter(
            (mark) => !confirmedTokens.has(mark.token),
          ),
        )
        if (active.current === id) setPending(outbox(id))
      } while (outbox(id).length && navigator.onLine && active.current === id)
    } catch {
      if (active.current === id) setDisconnected(true)
    } finally {
      inFlight.current.delete(id)
    }
  }
  const listId = list?.id
  useEffect(() => {
    if (!allowed || !summaries.length) return
    const flushOtherLists = () => {
      for (const summary of summaries)
        if (summary.id !== active.current && outbox(summary.id).length)
          void sync(summary.id)
    }
    flushOtherLists()
    window.addEventListener('online', flushOtherLists)
    window.addEventListener('focus', flushOtherLists)
    return () => {
      window.removeEventListener('online', flushOtherLists)
      window.removeEventListener('focus', flushOtherLists)
    }
  }, [allowed, summaries])
  useEffect(() => {
    if (!allowed || !listId) return
    const refresh = () => {
      if (!document.hidden) void sync(listId)
    }
    const onStorage = (event: StorageEvent) => {
      if (!belongsToGroceryOutbox(listId, event.key)) return
      setPending(outbox(listId))
      refresh()
    }
    const offline = () => setDisconnected(true)
    setDisconnected(!navigator.onLine)
    refresh()
    const poll = window.setInterval(refresh, 8000)
    window.addEventListener('storage', onStorage)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', offline)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(poll)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', offline)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [allowed, listId])

  const display = list && {
    ...list,
    marks: mergeGroceryMarks(list.marks, pending),
  }
  const lines = display ? allLines(display) : []
  const shoppingLines = display
    ? lines.filter(
        (line) =>
          isShoppingLine(line, display.overrides) && !referenceOnly(line),
      )
    : []
  const checked = shoppingLines.filter(
    (line) => display?.marks[line.id]?.checked,
  ).length
  function markRows(rows: GroceryLine[], force?: boolean) {
    if (!display) return
    const known = mergeGroceryMarks(display.marks, outbox(display.id))
    for (const line of rows) {
      const prior = known[line.id]
      const mark = {
        row: line.id,
        checked: force ?? !prior?.checked,
        at: Math.max(Date.now() + delta.current, (prior?.at || 0) + 1),
        token: crypto.randomUUID(),
      }
      try {
        localStorage.setItem(
          groceryMarkKey(display.id, mark),
          JSON.stringify(mark),
        )
      } catch {
        setStorageFailed(true)
        volatile.current.set(display.id, [
          ...(volatile.current.get(display.id) || []),
          mark,
        ])
      }
    }
    setPending(outbox(display.id))
    if (force === undefined && navigator.vibrate) navigator.vibrate(9)
    void sync(display.id)
  }

  async function generate(selected: GrocerySources) {
    const key = JSON.stringify(selected)
    if (generation.current?.key !== key)
      generation.current = { key, id: crypto.randomUUID() }
    setBusy(true)
    setError('')
    try {
      const payload = await requestList(generation.current.id, {
        action: 'generate',
        sources: selected,
      })
      clock(payload)
      if (payload.list) {
        const snapshot = payload.list
        setSummaries((previous) => [
          snapshot,
          ...previous.filter((entry) => entry.id !== snapshot.id),
        ])
        activate(snapshot)
        setNotice(
          'New snapshot saved. Earlier lists are unchanged; checkmarks and manual edits were not copied.',
        )
        generation.current = undefined
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not generate a new snapshot.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function saveEdit(data: Record<string, unknown>) {
    if (!display) return
    setBusy(true)
    setError('')
    const ticket = ++sequence.current
    try {
      const payload = await requestList(display.id, data)
      clock(payload)
      if (payload.list) accept(payload.list, ticket)
      setDialog(undefined)
      setNotice('Shopping list updated.')
      if (data.action === 'manual')
        requestAnimationFrame(() => floating.current?.focus())
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not save this edit.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function exportList(copy: boolean) {
    if (!display) return
    const text = groceryText(display, groupBy)
    if (copy) {
      try {
        await navigator.clipboard.writeText(text)
        setNotice('Copied grocery and prep list.')
        return
      } catch {
        setNotice('Clipboard unavailable. Plain text downloaded instead.')
      }
    }
    const url = URL.createObjectURL(
      new Blob([text], { type: 'text/plain;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `grocery-prep-${display.generatedAt.slice(0, 10)}.txt`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (!allowed)
    return (
      <p className="info-banner">
        {ready
          ? 'Your oven role does not have access to Grocery & Prep.'
          : 'Connect to your private oven to generate and save grocery lists.'}
      </p>
    )
  const groups = groceryGroups(lines, groupBy)
  const checkState = pending.length
    ? storageFailed
      ? 'Changes pending — keep this page open'
      : 'Saved on this device'
    : disconnected
      ? 'Offline · showing last loaded list'
      : ''
  const prepToMake = display?.prep.filter((prep) => prep.toMake > 1e-8) || []
  const warnings = display ? groceryWarnings(display) : []
  const needsReview =
    !!display &&
    (!display.calculationVersion ||
      !!warnings.length ||
      lines.some((line) => line.review))
  const selectedDialog = typeof dialog === 'object' ? dialog : undefined
  return (
    <section className="grocery-page" aria-labelledby="grocery-title">
      <header className="grocery-intro">
        <p>Production planning</p>
        <h2 id="grocery-title">Grocery &amp; Prep</h2>
        <p>
          Shop for the next bake. Saved snapshots never change stock or
          production.
        </p>
      </header>
      {error && (
        <p className="grocery-alert" role="alert">
          {error}
        </p>
      )}
      <span className="grocery-sr" role="status">
        {notice}
      </span>
      {loading && <p role="status">Loading saved lists…</p>}
      {!loading && !display && !error && (
        <p>
          No production sources selected. Choose runs, dates, events, or recipes
          to make a list.
        </p>
      )}
      {!loading && !display && error && (
        <button
          type="button"
          className="grocery-button"
          onClick={() => void load()}
        >
          Retry loading lists
        </button>
      )}
      {(summaries.length > 0 || display) && (
        <label className="grocery-list-picker">
          Saved snapshots{' '}
          <select
            disabled={loading || busy}
            value={display?.id || ''}
            onChange={(event) => void load(event.target.value)}
          >
            {!display && <option value="">Choose a snapshot</option>}
            {summaries.map((summary) => (
              <option key={summary.id} value={summary.id}>
                {formatDate(summary.generatedAt)} ·{' '}
                {summary.labels.join(', ').slice(0, 90) || 'Grocery list'}
              </option>
            ))}
          </select>
        </label>
      )}
      {display && (
        <section className="grocery-snapshot" aria-label="Selected sources">
          <strong>Selected sources</strong>
          <span>
            Calculated{' '}
            <time dateTime={display.generatedAt}>
              {new Date(display.generatedAt).toLocaleString()}
            </time>
          </span>
          {display.labels.length ? (
            <ul>
              {display.labels.map((label, index) => (
                <li key={`${index}-${label}`}>{label}</li>
              ))}
            </ul>
          ) : (
            <p>No available sources.</p>
          )}
          <div className="grocery-actions">
            <button
              type="button"
              className="grocery-button"
              disabled={busy || loading || disconnected}
              onClick={() => void generate(display.sources)}
            >
              <RotateCcw size={16} /> Recalculate
            </button>
            <button
              type="button"
              className="grocery-button"
              aria-expanded={editingSources}
              onClick={() => {
                setSources(display.sources)
                setEditingSources(!editingSources)
              }}
            >
              {editingSources ? 'Cancel source edits' : 'Edit sources'}
            </button>
          </div>
          <p>
            Recalculate saves a new snapshot from these sources. Checkmarks,
            quantity edits, and manual items stay on the original list and are
            not copied.
          </p>
          <small>
            Recalculate saves a new snapshot using current stock. Check marks
            and edits stay on this list. Ingredient reservations aren’t tracked.
          </small>
        </section>
      )}
      {((!display && !loading) || editingSources) && (
        <SourcesEditor
          state={state}
          sources={sources}
          setSources={setSources}
          submit={(event) => {
            event.preventDefault()
            void generate(sources)
          }}
          busy={busy}
          current={!!display}
        />
      )}
      {display && (
        <>
          {!display.calculationVersion && (
            <p className="grocery-alert" role="status">
              {groceryEmptyMessage(display)}
            </p>
          )}
          {warnings.length > 0 && (
            <details className="grocery-warning" open>
              <summary>
                Review {warnings.length} planning{' '}
                {warnings.length === 1 ? 'note' : 'notes'}
              </summary>
              <ul>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          <div
            className="grocery-view"
            role="group"
            aria-label="Grocery and prep views"
          >
            <button
              type="button"
              aria-pressed={view === 'products'}
              onClick={() => setView('products')}
            >
              Products to make
            </button>
            <button
              type="button"
              aria-pressed={view === 'shop'}
              onClick={() => setView('shop')}
            >
              Shopping list
            </button>
            <button
              type="button"
              aria-pressed={view === 'prep'}
              onClick={() => setView('prep')}
            >
              Prep before production{' '}
              {prepToMake.length ? `· ${prepToMake.length}` : ''}
            </button>
          </div>
          {view === 'products' ? (
            <section className="grocery-prep" aria-label="Products to make">
              <h3>Products to make</h3>
              <p>
                Basket contents and linked work at the time of calculation.
                Unreserved stock is not counted as an allocation.
              </p>
              {!display.products?.length && (
                <p>
                  {needsReview
                    ? 'No basket product breakdown is available for this snapshot.'
                    : 'No basket products in the selected sources.'}
                </p>
              )}
              {display.products?.map((product) => (
                <article key={product.id}>
                  <h4>{product.name}</h4>
                  <p>{product.basket}</p>
                  <p>{groceryProductSummary(product)}</p>
                  {product.issue && (
                    <p>
                      <strong>Review:</strong> {product.issue}
                    </p>
                  )}
                  {product.runs.length > 0 && (
                    <ul>
                      {product.runs.map((run) => (
                        <li key={`${run.id}:${run.lineId}`}>
                          {groceryLinkedRun(run)}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </section>
          ) : view === 'prep' ? (
            <section className="grocery-prep">
              <h3>Prep before production</h3>
              <p>
                Planning only. Nothing is prepared, reserved, or deducted here.
              </p>
              {!display.prep.length && !needsReview && (
                <p>No additional prep to make from this snapshot.</p>
              )}
              {display.prep.map((prep) => (
                <article key={prep.id}>
                  <h4>{prep.name}</h4>
                  <strong>
                    {prep.toMake > 1e-8
                      ? `Make ${groceryQuantity(prep.toMake, prep.unit)}`
                      : 'Covered by prepared stock'}
                  </strong>
                  <p>
                    {groceryQuantity(prep.needed, prep.unit)} needed ·{' '}
                    {groceryQuantity(prep.onHand ?? 0, prep.unit)} on hand
                  </p>
                  <p>{prep.sources.join('; ')}</p>
                </article>
              ))}
            </section>
          ) : (
            <>
              <header className="grocery-progress">
                <div>
                  <ListChecks size={22} aria-hidden="true" />
                  <div>
                    <strong>
                      {checked} of {shoppingLines.length} checked
                    </strong>
                    {checkState && <small role="status">{checkState}</small>}
                  </div>
                  <progress
                    aria-label="Shopping progress"
                    max={shoppingLines.length || 1}
                    value={checked}
                  />
                </div>
                <label className="grocery-search">
                  <Search size={18} aria-hidden="true" />
                  <span className="grocery-sr">Search shopping list</span>
                  <input
                    type="search"
                    placeholder="Find an item…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </header>
              <details className="grocery-options">
                <summary>Shopping options</summary>
                <div className="grocery-actions">
                  <label>
                    Group by{' '}
                    <select
                      value={groupBy}
                      onChange={(event) =>
                        setGroupBy(
                          event.target.value === 'category'
                            ? 'category'
                            : 'vendor',
                        )
                      }
                    >
                      <option value="vendor">Vendor / store</option>
                      <option value="category">Category</option>
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={hideChecked}
                      onChange={(event) => setHideChecked(event.target.checked)}
                    />{' '}
                    Hide checked
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={checkedLast}
                      onChange={(event) => setCheckedLast(event.target.checked)}
                    />{' '}
                    Move checked to bottom
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={showStock}
                      onChange={(event) => setShowStock(event.target.checked)}
                    />{' '}
                    Show stock-covered items
                  </label>
                </div>
                <div className="grocery-actions">
                  <button
                    type="button"
                    className="grocery-button"
                    disabled={!checked}
                    onClick={() => setDialog('uncheck')}
                  >
                    Uncheck all
                  </button>
                  <button
                    type="button"
                    className="grocery-button"
                    disabled={!checked}
                    onClick={() => setDialog('clear')}
                  >
                    Clear checked marks
                  </button>
                </div>
              </details>
              {!needsReview &&
                !!shoppingLines.length &&
                checked === shoppingLines.length && (
                  <p className="grocery-done" role="status">
                    <Check size={20} /> All done
                  </p>
                )}
              {!shoppingLines.length && !!display.calculationVersion && (
                <p
                  className={
                    needsReview
                      ? 'grocery-alert'
                      : display.selectedSourceCount
                        ? 'grocery-done'
                        : undefined
                  }
                >
                  {groceryEmptyMessage(display)}
                </p>
              )}
              {groups.map((group) => {
                const eligible = group.lines.filter(
                  (line) =>
                    isShoppingLine(line, display.overrides) &&
                    !referenceOnly(line),
                )
                const done = eligible.filter(
                  (line) => display.marks[line.id]?.checked,
                ).length
                const filtered = group.lines.filter(
                  (line) =>
                    (showStock || isShoppingLine(line, display.overrides)) &&
                    (!hideChecked || !display.marks[line.id]?.checked) &&
                    `${line.name} ${line.vendor} ${line.category}`
                      .toLowerCase()
                      .includes(query.trim().toLowerCase()),
                )
                if (!filtered.length) return null
                if (checkedLast)
                  filtered.sort(
                    (left, right) =>
                      Number(!!display.marks[left.id]?.checked) -
                      Number(!!display.marks[right.id]?.checked),
                  )
                const open = !collapsed[group.label]
                return (
                  <section className="grocery-group" key={group.label}>
                    <h3>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() =>
                          setCollapsed({ ...collapsed, [group.label]: open })
                        }
                      >
                        <span>
                          {group.label}
                          <small>
                            {done} of {eligible.length} checked
                          </small>
                        </span>
                        <ChevronDown size={19} />
                      </button>
                    </h3>
                    {open && (
                      <ul>
                        {filtered.map((line) => (
                          <ShoppingRow
                            key={line.id}
                            line={line}
                            list={display}
                            toggle={() => markRows([line])}
                            edit={() => {
                              setError('')
                              setDialog(line)
                            }}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                )
              })}
              {query.trim() &&
                !lines.some(
                  (line) =>
                    `${line.name} ${line.vendor} ${line.category}`
                      .toLowerCase()
                      .includes(query.trim().toLowerCase()) &&
                    (showStock || isShoppingLine(line, display.overrides)) &&
                    (!hideChecked || !display.marks[line.id]?.checked),
                ) && (
                  <p role="status">No items match this search and filters.</p>
                )}
            </>
          )}
          <footer className="grocery-actions grocery-export">
            <button
              type="button"
              className="grocery-button"
              onClick={() => void exportList(true)}
            >
              <Clipboard size={17} /> Copy text
            </button>
            <button
              type="button"
              className="grocery-button"
              onClick={() => void exportList(false)}
            >
              <Download size={17} /> Download text
            </button>
            <button
              type="button"
              className="grocery-button"
              onClick={() => window.print()}
            >
              <Printer size={17} /> Print
            </button>
          </footer>
          {notice && (
            <small className="grocery-notice" aria-hidden="true">
              {notice}
            </small>
          )}
          {view === 'shop' && (
            <button
              type="button"
              className="grocery-add"
              ref={floating}
              onClick={() => {
                setError('')
                setManualId(crypto.randomUUID())
                setDialog('manual')
              }}
            >
              <Plus size={21} /> Add item
            </button>
          )}
          {createPortal(
            <div className="grocery-print">
              <pre>{groceryText(display, groupBy)}</pre>
            </div>,
            document.body,
          )}
        </>
      )}
      {dialog && (
        <GroceryDialog
          title={
            dialog === 'manual'
              ? 'Add a manual item'
              : selectedDialog
                ? 'Edit shopping quantity'
                : dialog === 'clear'
                  ? 'Clear checked marks?'
                  : 'Uncheck all items?'
          }
          description={
            dialog === 'manual'
              ? 'A one-off shopping item. Nothing is added to inventory.'
              : selectedDialog
                ? 'Changes this list’s shopping quantity only. The original calculation stays visible.'
                : 'Items stay on the list. Only the check marks are reset.'
          }
          close={() => {
            if (!busy) setDialog(undefined)
          }}
        >
          {error && (
            <p className="grocery-alert" role="alert">
              {error}
            </p>
          )}
          {dialog === 'manual' ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const fields = new FormData(event.currentTarget)
                void saveEdit({
                  action: 'manual',
                  item: manualId,
                  name: fields.get('name'),
                  unit: fields.get('unit'),
                  amount: Number(fields.get('amount')),
                  vendor: fields.get('vendor'),
                  notes: fields.get('notes'),
                })
              }}
            >
              <label>
                Item name
                <input name="name" required maxLength={160} />
              </label>
              <div className="grocery-fields">
                <label>
                  Quantity
                  <input
                    name="amount"
                    type="number"
                    min="0.000001"
                    max="1000000000"
                    step="any"
                    defaultValue={1}
                    required
                  />
                </label>
                <label>
                  Unit
                  <input name="unit" maxLength={40} placeholder="e.g. roll" />
                </label>
              </div>
              <label>
                Vendor (optional)
                <input name="vendor" maxLength={100} />
              </label>
              <label>
                Notes (optional)
                <textarea name="notes" maxLength={600} />
              </label>
              <button
                className="grocery-button grocery-primary"
                disabled={busy}
              >
                Save item
              </button>
            </form>
          ) : selectedDialog && display ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void saveEdit({
                  action: 'quantity',
                  row: selectedDialog.id,
                  amount: Number(
                    new FormData(event.currentTarget).get('amount'),
                  ),
                })
              }}
            >
              <label>
                {selectedDialog.name}
                {selectedDialog.unit ? ` (${selectedDialog.unit})` : ''}
                <input
                  name="amount"
                  type="number"
                  required
                  min="0.000001"
                  max="1000000000"
                  step="any"
                  defaultValue={
                    display.overrides[selectedDialog.id] ??
                    (selectedDialog.toBuy || 1)
                  }
                />
              </label>
              <div className="grocery-actions">
                <button
                  className="grocery-button grocery-primary"
                  disabled={busy}
                >
                  Save quantity
                </button>
                {display.overrides[selectedDialog.id] !== undefined && (
                  <button
                    type="button"
                    className="grocery-button"
                    disabled={busy}
                    onClick={() =>
                      void saveEdit({
                        action: 'quantity',
                        row: selectedDialog.id,
                        amount: null,
                      })
                    }
                  >
                    Restore suggestion
                  </button>
                )}
              </div>
            </form>
          ) : (
            <div className="grocery-actions">
              <Dialog.Close className="grocery-button">Cancel</Dialog.Close>
              <button
                type="button"
                className="grocery-button grocery-primary"
                onClick={() => {
                  markRows(
                    dialog === 'clear'
                      ? lines.filter((line) => display?.marks[line.id]?.checked)
                      : lines.filter((line) => !referenceOnly(line)),
                    false,
                  )
                  setDialog(undefined)
                }}
              >
                {dialog === 'clear' ? 'Clear marks' : 'Uncheck all'}
              </button>
            </div>
          )}
        </GroceryDialog>
      )}
    </section>
  )
}
