import { useEffect, useRef, useState, type ReactNode } from 'react'
import { type Item, type Workspace, csv } from '../lib/domain'
import { ovenToday, ovenTimezone } from '../lib/oven-dates'
import {
  addDays,
  batchOutputs,
  eventBasis,
  eventExpenseRecords,
  eventLastDay,
  eventReport,
  eventStatuses,
  eventTypes,
} from '../lib/events'
import { Dialog, DialogContent } from './ui/dialog'
import { ItemDetailHeader } from './item-detail-layout'
import './events-workspace.css'

type Props = {
  state: Workspace
  role: string
  view: string
  busy: boolean
  mutate: (
    action: string,
    table: string,
    data: Record<string, unknown>,
  ) => Promise<unknown>
  openRecord: (kind: string, record?: Item) => void
  onDirty?: (dirty: boolean) => void
}
const Label = ({ name, children }: { name: string; children: ReactNode }) => (
  <label className="event-field">
    <span>{name}</span>
    {children}
  </label>
)
const button = 'btn secondary'
export function EventsWorkspace({
  state,
  role,
  view,
  busy,
  mutate,
  openRecord,
  onDirty,
}: Props) {
  const today = ovenToday(state.settings[0])
  const [anchor, setAnchor] = useState(today)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Item | null>(null)
  const [tab, setTab] = useState('Overview')
  const [error, setError] = useState('')
  const [kind, setKind] = useState('batch')
  const [recordId, setRecordId] = useState('')
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [pickupStatus, setPickupStatus] = useState('Awaiting pickup')
  const saving = useRef(false)
  const dirtyCallback = useRef(onDirty)
  useEffect(() => {
    dirtyCallback.current = onDirty
  }, [onDirty])
  useEffect(() => {
    dirtyCallback.current?.(!!draft)
    if (!draft) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      dirtyCallback.current?.(false)
    }
  }, [draft])

  const editable = ['Owner', 'Manager'].includes(role)
  const financial = ['Owner', 'Manager', 'Read-only Accountant'].includes(role)
  const events = state.events || []
  const event = events.find((e) => e.id === selected)
  const report = event && eventReport(event, state)
  const timezone = ovenTimezone(state.settings[0])
  const currency = state.settings[0]?.currency || 'USD'
  const money = (value: number | null) =>
    value === null
      ? 'Unavailable'
      : new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency,
        }).format(value || 0)
  useEffect(() => {
    const read = () => {
      const id = new URLSearchParams(window.location.hash.split('?')[1]).get(
        'event',
      )
      if (id) {
        setSelected(id)
        setDraft(null)
        setTab('Overview')
      }
    }
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  function close() {
    if (draft && !window.confirm('Discard unsaved event changes?')) return
    setSelected(null)
    setDraft(null)
    setError('')
    if (window.location.hash.includes('?event='))
      window.history.replaceState(null, '', window.location.hash.split('?')[0])
  }
  function show(e: Item) {
    setSelected(e.id)
    setDraft(null)
    setTab('Overview')
    setError('')
    setRecordId('')
  }
  function create() {
    setSelected(null)
    setTab('Overview')
    setError('')
    setDraft({
      id: crypto.randomUUID(),
      name: '',
      type: eventTypes[0],
      status: 'Draft',
      startDate: anchor,
      endDate: anchor,
      startTime: '09:00',
      endTime: '13:00',
      allDay: false,
      location: '',
      description: '',
      notes: '',
      plannedRevenue: '',
      budget: '',
    })
  }
  async function act(action: string, data: Record<string, unknown>) {
    if (saving.current) return false
    saving.current = true
    setError('')
    try {
      await mutate(action, 'events', data)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      saving.current = false
    }
  }
  async function save() {
    if (
      draft &&
      (await act('eventSave', { ...draft, expectedRevision: draft.revision }))
    ) {
      setSelected(draft.id)
      setDraft(null)
    }
  }
  const change = (key: string, value: unknown) =>
    setDraft((d) => d && { ...d, [key]: value })
  const date = new Date(anchor + 'T12:00:00Z')
  const monthStart = anchor.slice(0, 7) + '-01'
  const weekStart = addDays(anchor, -date.getUTCDay())
  const first =
    view === 'Month'
      ? addDays(monthStart, -new Date(monthStart + 'T12:00:00Z').getUTCDay())
      : view === 'Week'
        ? weekStart
        : view === 'Day'
          ? anchor
          : monthStart
  const endMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12),
  )
    .toISOString()
    .slice(0, 10)
  const last =
    view === 'Month'
      ? addDays(first, 41)
      : view === 'Week'
        ? addDays(first, 6)
        : view === 'Day'
          ? anchor
          : endMonth
  const filtered = events.filter(
    (e) =>
      (!type || e.type === type) &&
      (!status || e.status === status) &&
      `${e.name} ${e.location} ${e.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
  const visible = filtered
    .filter((e) => e.startDate <= last && eventLastDay(e) >= first)
    .sort(
      (a, b) =>
        (a.startDate + a.startTime).localeCompare(b.startDate + b.startTime) ||
        a.name.localeCompare(b.name),
    )
  const heading =
    view === 'Month' || view === 'List'
      ? date.toLocaleDateString(undefined, {
          timeZone: 'UTC',
          month: 'long',
          year: 'numeric',
        })
      : first === last
        ? first
        : `${first} – ${last}`
  function step(amount: number) {
    if (view === 'Month' || view === 'List')
      setAnchor(
        new Date(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1, 12),
        )
          .toISOString()
          .slice(0, 10),
      )
    else setAnchor(addDays(anchor, amount * (view === 'Week' ? 7 : 1)))
  }
  const timing = (e: Item) =>
    `${e.startDate}${e.startDate !== e.endDate ? ' – ' + e.endDate : ''} · ${e.allDay ? 'All day' : e.startTime + '–' + e.endTime}`
  const chip = (e: Item) => (
    <button key={e.id} className="event-chip" onClick={() => show(e)}>
      <strong>{e.name}</strong>
      <span>
        {e.allDay ? 'All day' : e.startTime}
        {e.startDate !== e.endDate ? ' · Multi-day' : ''} · {e.status}
      </span>
    </button>
  )
  const related = (table: string) =>
    (state[table] || []).filter((l) => l.eventId === event?.id)
  const sources: Record<string, Item[]> = {
    batch: state.batches || [],
    sale: (state.sales || []).filter((s) => !s.refundOf),
    expense: eventExpenseRecords(state).filter(
      (e) =>
        !e.inventory &&
        !e.reversedBy &&
        !['draft', 'superseded'].includes(e.status) &&
        !/processing|cogs|waste|shrink/i.test(e.category || ''),
    ),
    pickup: (state.finance_transactions || []).filter(
      (t) => t.kind === 'invoice' && !t.reversedBy,
    ),
  }
  const selectedRecord = sources[kind].find((r) => r.id === recordId)
  function visit(kind: string, record?: Item) {
    setSelected(null)
    openRecord(kind, record)
  }
  function exportCsv() {
    if (!event || !report) return
    const meta = {
      event: event.name,
      dateRange: `${event.startDate} – ${event.endDate}`,
      timezone: event.timezone,
      currency,
      generatedAt: new Date().toISOString(),
      basis: eventBasis,
      filters:
        'All explicit links; no date matching; display filters do not restrict this report',
      warnings: report.warnings.join(' | '),
    }
    const rows: Item[] = Object.entries(report.metrics).map(
      ([name, amount]) => ({
        id: name,
        ...meta,
        section: 'Summary',
        name,
        amount: amount ?? 'Unavailable',
      }),
    )
    for (const [name, amount] of Object.entries({
      'Planned revenue': event.plannedRevenue,
      'Expense budget': event.budget,
      'Revenue variance':
        event.plannedRevenue == null
          ? null
          : report.metrics['Net sales'] - event.plannedRevenue,
      'Expense budget remaining':
        event.budget == null
          ? null
          : event.budget - report.metrics['Event expenses'],
    }))
      rows.push({
        id: name,
        ...meta,
        section: 'Budget comparison (plans are not actuals)',
        name,
        amount: amount ?? 'Not entered',
      })
    for (const [name, amount] of Object.entries({
      'Expected invoice pickups': report.pickups.length,
      'Picked up': report.pickups.filter((p) => p.pickupStatus === 'Picked up')
        .length,
      'Awaiting pickup': report.pickups.filter(
        (p) => p.pickupStatus !== 'Picked up',
      ).length,
      'Pickup invoice outstanding (separate from attributed sales)':
        report.pickupOutstanding,
    }))
      rows.push({
        id: name,
        ...meta,
        section: 'Pickup operations',
        name,
        amount,
      })
    for (const link of related('event_batch_links')) {
      const batch = state.batches.find((b) => b.id === link.recordId)
      if (!batch) continue
      for (const line of batchOutputs(batch)) {
        const reserved = (state.event_batch_links || [])
          .filter((l) => l.recordId === batch.id)
          .flatMap((l) => l.allocations || [])
          .filter((a) => a.lineId === line.id)
          .reduce((n, a) => n + a.quantity, 0)
        rows.push({
          id: `${batch.id}:${line.id}`,
          ...meta,
          section: 'Production planning (no additional cost allocation)',
          name: batch.name,
          productId: line.productId,
          planned: line.planned,
          completed: line.completed ?? 'Unrecorded',
          allocatedHere:
            link.allocations?.find((a: Item) => a.lineId === line.id)
              ?.quantity ?? 'Planning link only',
          unallocated: line.available - reserved,
          runWaste: line.waste ?? 'Unrecorded',
          eventLeftovers: 'Unavailable',
          eventWaste: 'Unavailable',
        })
      }
    }
    for (const row of report.products)
      rows.push({ ...meta, section: 'Products', ...row })
    for (const row of report.sales)
      rows.push({
        ...meta,
        section: 'Source sales and refunds',
        id: row.id,
        name: row.name,
        refundOf: row.refundOf || '',
        quantity: row.quantity,
        netSales: row.amount,
        tax: row.tax,
        cost: row.historicalCogs ?? 'Unavailable',
        costSource: row.costSource || 'Missing',
      })
    for (const row of report.expenses)
      rows.push({
        ...meta,
        section: 'Expenses',
        id: row.id,
        name: row.name,
        amount: row.amount,
        originalAmount: row.originalAmount,
        category: row.category,
        reversedBy: row.reversedBy || '',
      })
    for (const row of report.methods)
      rows.push({
        id: row.name,
        ...meta,
        section: 'Payments by method',
        name: row.name,
        amount: row.amount ?? 'Unavailable',
      })
    for (const row of report.pickups)
      rows.push({
        ...meta,
        section: 'Invoice pickups',
        id: row.recordId,
        name: row.name,
        status: row.pickupStatus,
        amount: row.invoice?.amount,
        paid: row.invoice?.paid || 0,
      })
    // Keep a consistent shape across summary and breakdown rows.
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    const output = rows.map(
      (row) =>
        Object.fromEntries(keys.map((key) => [key, row[key] ?? ''])) as Item,
    )
    const url = URL.createObjectURL(
      new Blob([csv(output)], { type: 'text/csv;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `event-${event.id}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section className="events-workspace">
      <div className="event-toolbar">
        <div className="button-row" aria-label="Calendar navigation">
          <button
            className={button}
            onClick={() => step(-1)}
            aria-label="Previous date range"
          >
            ←
          </button>
          <button className={button} onClick={() => setAnchor(today)}>
            Today
          </button>
          <button
            className={button}
            onClick={() => step(1)}
            aria-label="Next date range"
          >
            →
          </button>
        </div>
        <h2 aria-live="polite">{heading}</h2>
        {editable && (
          <button className="btn" onClick={create}>
            New event
          </button>
        )}
      </div>
      <div className="event-toolbar">
        <div className="button-row" aria-label="Event view">
          {['List', 'Month', 'Week', 'Day'].map((v) => (
            <a
              key={v}
              className={view === v ? 'btn' : button}
              aria-current={view === v ? 'page' : undefined}
              href={`#Events/${v}`}
            >
              {v}
            </a>
          ))}
        </div>
        <span>
          {timezone} · {currency}
        </span>
      </div>
      <div className="event-filters">
        <Label name="Search events">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, location or description"
          />
        </Label>
        <Label name="Event type">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {eventTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Label>
        <Label name="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {eventStatuses.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Label>
      </div>
      {!visible.length && (
        <div className="empty-state">
          <h3>No events in this range</h3>
          <p>
            Plan a market, pickup day or another date for your business. Try
            another date range or clear the filters.
          </p>
        </div>
      )}
      {view === 'List' ? (
        <div className="event-table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  'Date & time',
                  'Event',
                  'Location',
                  'Status',
                  'Batch runs',
                  'Invoice pickups',
                  ...(financial ? ['Net sales'] : []),
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.id}>
                  <td>{timing(e)}</td>
                  <td>
                    <button className="text-button" onClick={() => show(e)}>
                      {e.name}
                    </button>
                    <p>{e.type}</p>
                  </td>
                  <td>{e.location || '—'}</td>
                  <td>{e.status}</td>
                  <td>
                    {
                      (state.event_batch_links || []).filter(
                        (l) => l.eventId === e.id,
                      ).length
                    }
                  </td>
                  <td>
                    {
                      (state.event_pickups || []).filter(
                        (l) => l.eventId === e.id,
                      ).length
                    }
                  </td>
                  {financial && (
                    <td>{money(eventReport(e, state).metrics['Net sales'])}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div
            className={`event-calendar event-calendar-${view.toLowerCase()}`}
            aria-label={`${view} calendar`}
          >
            {Array.from(
              { length: view === 'Month' ? 42 : view === 'Week' ? 7 : 1 },
              (_, index) => {
                const day = addDays(first, index)
                return (
                  <section
                    key={day}
                    className={
                      day === today ? 'event-day is-today' : 'event-day'
                    }
                    aria-label={day}
                  >
                    <h3>
                      {new Date(day + 'T12:00:00Z').toLocaleDateString(
                        undefined,
                        {
                          timeZone: 'UTC',
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        },
                      )}
                    </h3>
                    {visible
                      .filter(
                        (e) => e.startDate <= day && eventLastDay(e) >= day,
                      )
                      .map(chip)}
                  </section>
                )
              },
            )}
          </div>
          <div className="event-mobile-agenda">
            {visible.map((e) => (
              <article key={e.id}>
                <p>{timing(e)}</p>
                {chip(e)}
              </article>
            ))}
          </div>
        </>
      )}
      <Dialog
        open={!!draft || !!event}
        onOpenChange={(value) => {
          if (!value) close()
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="app-dialog wide-dialog item-detail-dialog event-dialog"
          onEscapeKeyDown={(e) => {
            if (draft) {
              e.preventDefault()
              close()
            }
          }}
          onPointerDownOutside={(e) => {
            if (draft) {
              e.preventDefault()
              close()
            }
          }}
        >
          <ItemDetailHeader
            close
            onClose={close}
            name={
              draft
                ? draft.revision
                  ? 'Edit event'
                  : 'New event'
                : event?.name || 'Event'
            }
          >
            {draft
              ? 'Plan your day without changing production, inventory or financial records.'
              : `${event?.type} · ${event?.status} · ${event && timing(event)} · ${event?.timezone}`}
          </ItemDetailHeader>
          {error && (
            <p role="alert" className="connection-note">
              {error}
            </p>
          )}
          {draft ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
              className="event-form"
            >
              <Label name="Event name">
                <input
                  required
                  maxLength={200}
                  value={draft.name}
                  onChange={(e) => change('name', e.target.value)}
                />
              </Label>
              <div className="event-form-grid">
                <Label name="Event type">
                  <select
                    value={draft.type}
                    onChange={(e) => change('type', e.target.value)}
                  >
                    {eventTypes.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Label>
                <Label name="Status">
                  <select
                    value={draft.status}
                    onChange={(e) => change('status', e.target.value)}
                  >
                    {eventStatuses.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Label>
                <Label name="Start date">
                  <input
                    required
                    type="date"
                    value={draft.startDate}
                    onChange={(e) => change('startDate', e.target.value)}
                  />
                </Label>
                <Label name="End date (inclusive)">
                  <input
                    required
                    type="date"
                    value={draft.endDate}
                    min={draft.startDate}
                    onChange={(e) => change('endDate', e.target.value)}
                  />
                </Label>
                <Label name="All day">
                  <input
                    type="checkbox"
                    checked={draft.allDay}
                    onChange={(e) => change('allDay', e.target.checked)}
                  />
                </Label>
                <p>
                  Times use {timezone}. Ambiguous or nonexistent daylight-saving
                  times require another time.
                </p>
                {!draft.allDay && (
                  <>
                    <Label name="Start time">
                      <input
                        required
                        type="time"
                        value={draft.startTime}
                        onChange={(e) => change('startTime', e.target.value)}
                      />
                    </Label>
                    <Label name="End time">
                      <input
                        required
                        type="time"
                        value={draft.endTime}
                        onChange={(e) => change('endTime', e.target.value)}
                      />
                    </Label>
                  </>
                )}
                <Label name={`Planned revenue (${currency}, optional)`}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.plannedRevenue ?? ''}
                    onChange={(e) => change('plannedRevenue', e.target.value)}
                  />
                </Label>
                <Label name={`Event expense budget (${currency}, optional)`}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.budget ?? ''}
                    onChange={(e) => change('budget', e.target.value)}
                  />
                </Label>
              </div>
              <Label name="Location / pickup instructions">
                <textarea
                  value={draft.location}
                  onChange={(e) => change('location', e.target.value)}
                />
              </Label>
              <Label name="Description">
                <textarea
                  value={draft.description}
                  onChange={(e) => change('description', e.target.value)}
                />
              </Label>
              <Label name="Internal notes">
                <textarea
                  value={draft.notes}
                  onChange={(e) => change('notes', e.target.value)}
                />
              </Label>
              <div className="button-row">
                <button className="btn" disabled={busy} type="submit">
                  Save event
                </button>
                <button className={button} type="button" onClick={close}>
                  Discard changes
                </button>
              </div>
            </form>
          ) : (
            event &&
            report && (
              <>
                <nav className="event-tabs" aria-label="Event sections">
                  {[
                    'Overview',
                    'Batch runs',
                    ...(financial
                      ? ['Orders & pickups', 'Sales & financials', 'Expenses']
                      : []),
                    'Notes',
                  ].map((t) => (
                    <button
                      key={t}
                      className={tab === t ? 'btn' : button}
                      aria-current={tab === t ? 'page' : undefined}
                      onClick={() => {
                        setTab(t)
                        setRecordId('')
                        setError('')
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </nav>
                <div className="event-actions button-row">
                  {editable && (
                    <>
                      <button
                        className={button}
                        onClick={() => setDraft(structuredClone(event))}
                      >
                        Edit event
                      </button>
                      {event.status !== 'Completed' &&
                        event.status !== 'Cancelled' && (
                          <button
                            className={button}
                            disabled={busy}
                            onClick={() =>
                              void act('eventSave', {
                                ...event,
                                status: 'Completed',
                                expectedRevision: event.revision,
                              })
                            }
                          >
                            Mark completed
                          </button>
                        )}
                      {event.status !== 'Cancelled' && (
                        <button
                          className={button}
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                'Cancel this event? All linked production, sales, refunds, invoices and expenses remain unchanged.',
                              )
                            )
                              void act('eventSave', {
                                ...event,
                                status: 'Cancelled',
                                expectedRevision: event.revision,
                              })
                          }}
                        >
                          Cancel event
                        </button>
                      )}
                    </>
                  )}
                  {financial && (
                    <>
                      <button className={button} onClick={exportCsv}>
                        Export CSV
                      </button>
                      <button
                        className={button}
                        onClick={() => {
                          setTab('Print report')
                          requestAnimationFrame(() =>
                            requestAnimationFrame(() => window.print()),
                          )
                        }}
                      >
                        Print report
                      </button>
                    </>
                  )}
                </div>
                {(tab === 'Overview' || tab === 'Print report') && (
                  <div className="event-overview">
                    <section className="event-card">
                      <h3>The day at a glance</h3>
                      <p>
                        {event.location ||
                          'Location / pickup instructions not entered.'}
                      </p>
                      <p>{event.description || 'No description yet.'}</p>
                      <p>
                        {related('event_batch_links').length} batch runs
                        {financial && (
                          <>
                            {' '}
                            · {related('event_pickups').length} invoice pickups
                            · {report.originals.length} attributed sale records
                          </>
                        )}
                      </p>
                      <p>
                        Customer order counts and average order value are
                        unavailable: the existing orders are purchase orders,
                        not customer orders.
                      </p>
                    </section>
                    {financial && (
                      <section className="event-card">
                        <h3>Plans and recorded results</h3>
                        <p>
                          Planned revenue: {money(event.plannedRevenue)} ·
                          Actual net sales: {money(report.metrics['Net sales'])}
                        </p>
                        <p>
                          Revenue variance:{' '}
                          {event.plannedRevenue == null
                            ? 'No plan entered'
                            : money(
                                report.metrics['Net sales'] -
                                  event.plannedRevenue,
                              )}
                        </p>
                        <p>
                          Expense budget: {money(event.budget)} · Recorded
                          expenses: {money(report.metrics['Event expenses'])}
                        </p>
                        <p>
                          Expense budget remaining:{' '}
                          {event.budget == null
                            ? 'No budget entered'
                            : money(
                                event.budget - report.metrics['Event expenses'],
                              )}
                        </p>
                        <p>Budget figures do not enter actual results.</p>
                      </section>
                    )}
                  </div>
                )}
                {(tab === 'Batch runs' || tab === 'Print report') && (
                  <section className="event-card">
                    <h3>Connected production</h3>
                    <p>
                      Planning links and reservations only. Allocations add no
                      costs to this report; COGS comes from attributed sales.
                      Available here means unallocated batch output, not current
                      finished inventory.
                    </p>
                    {!related('event_batch_links').length && (
                      <p>No linked batch runs.</p>
                    )}
                    {related('event_batch_links').map((link) => {
                      const b = state.batches.find(
                        (b) => b.id === link.recordId,
                      )
                      return (
                        b && (
                          <article
                            className="event-linked-record"
                            key={link.id}
                          >
                            <button
                              className="text-button"
                              onClick={() => visit('production', b)}
                            >
                              {b.name} · {b.id}
                            </button>
                            <p>
                              {b.date} · {b.status}
                            </p>
                            <div className="event-table-wrap">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Product</th>
                                    <th>Planned</th>
                                    <th>Completed</th>
                                    <th>Allocated here</th>
                                    <th>Unallocated</th>
                                    <th>Run waste</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {batchOutputs(b).map((l) => {
                                    const total = (
                                      state.event_batch_links || []
                                    )
                                      .filter((x) => x.recordId === b.id)
                                      .flatMap((x) => x.allocations || [])
                                      .filter((a) => a.lineId === l.id)
                                      .reduce((n, a) => n + a.quantity, 0)
                                    return (
                                      <tr key={l.id}>
                                        <td>
                                          {state.products.find(
                                            (p) => p.id === l.productId,
                                          )?.name || l.name}
                                        </td>
                                        <td>{l.planned}</td>
                                        <td>{l.completed ?? 'Unrecorded'}</td>
                                        <td>
                                          {link.allocations?.find(
                                            (a: Item) => a.lineId === l.id,
                                          )?.quantity ?? 'Planning link only'}
                                        </td>
                                        <td>{l.available - total}</td>
                                        <td>{l.waste ?? 'Unrecorded'}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                            <p>
                              Sold quantities appear by product in financials.
                              Event leftovers and event-specific waste are
                              unavailable; produced minus sold is not treated as
                              waste.
                            </p>
                            {editable && (
                              <div className="button-row">
                                <button
                                  className={button}
                                  onClick={() => {
                                    setKind('batch')
                                    setRecordId(b.id)
                                    setAllocations(
                                      Object.fromEntries(
                                        (link.allocations || []).map(
                                          (a: Item) => [
                                            a.lineId,
                                            String(a.quantity),
                                          ],
                                        ),
                                      ),
                                    )
                                  }}
                                >
                                  Edit quantity allocation
                                </button>
                                <button
                                  className={button}
                                  disabled={busy}
                                  onClick={() =>
                                    void act('eventUnlink', {
                                      eventId: event.id,
                                      kind: 'batch',
                                      recordId: b.id,
                                    })
                                  }
                                >
                                  Unlink batch
                                </button>
                              </div>
                            )}
                          </article>
                        )
                      )
                    })}
                  </section>
                )}
                {(tab === 'Orders & pickups' || tab === 'Print report') &&
                  financial && (
                    <section className="event-card">
                      <h3>Invoice-backed pickup operations</h3>
                      <p>
                        Expected: {report.pickups.length} · Picked up:{' '}
                        {
                          report.pickups.filter(
                            (p) => p.pickupStatus === 'Picked up',
                          ).length
                        }{' '}
                        · Awaiting:{' '}
                        {
                          report.pickups.filter(
                            (p) => p.pickupStatus !== 'Picked up',
                          ).length
                        }
                      </p>
                      <p>
                        Outstanding invoice balance:{' '}
                        {money(report.pickupOutstanding)}. This balance is
                        separate from event-attributed sales. Invoice deposits
                        and partial payments use the existing invoice paid
                        balance.
                      </p>
                      <p>
                        Customer orders and order items are not available in the
                        current app. Linking an invoice here schedules its
                        pickup; it does not attribute its revenue to this event
                        or record payment.
                      </p>
                      {report.pickups.map((p) => (
                        <article key={p.id} className="event-linked-record">
                          <button
                            className="text-button"
                            onClick={() =>
                              visit('event-source', {
                                ...p.invoice!,
                                sourceTable: 'finance_transactions',
                              })
                            }
                          >
                            {p.name} · {p.recordId}
                          </button>
                          <p>
                            {p.pickupStatus}
                            {p.invoice?.reversedBy
                              ? ' · Invoice reversed; review pickup'
                              : ''}{' '}
                            ·{' '}
                            {money(
                              p.invoice
                                ? Math.max(
                                    0,
                                    p.invoice.amount - (p.invoice.paid || 0),
                                  )
                                : null,
                            )}{' '}
                            outstanding
                          </p>
                          {editable && (
                            <div className="button-row">
                              <button
                                disabled={busy}
                                className={button}
                                onClick={() =>
                                  void act('eventLink', {
                                    eventId: event.id,
                                    kind: 'pickup',
                                    recordId: p.recordId,
                                    pickupStatus:
                                      p.pickupStatus === 'Picked up'
                                        ? 'Awaiting pickup'
                                        : 'Picked up',
                                  })
                                }
                              >
                                Mark{' '}
                                {p.pickupStatus === 'Picked up'
                                  ? 'awaiting pickup'
                                  : 'picked up'}
                              </button>
                              <button
                                disabled={busy}
                                className={button}
                                onClick={() =>
                                  void act('eventUnlink', {
                                    eventId: event.id,
                                    kind: 'pickup',
                                    recordId: p.recordId,
                                  })
                                }
                              >
                                Unlink pickup
                              </button>
                            </div>
                          )}
                        </article>
                      ))}
                    </section>
                  )}
                {(tab === 'Sales & financials' || tab === 'Print report') &&
                  financial && (
                    <section className="event-card event-financial-report">
                      <h3>Event financial results</h3>
                      <p>
                        {event.name} · {event.startDate} – {event.endDate} ·{' '}
                        {event.timezone} · {currency}
                      </p>
                      <p>
                        Generated {new Date().toISOString()}. {eventBasis}{' '}
                        Display search and calendar filters do not restrict this
                        event report.
                      </p>
                      {report.warnings.length > 0 && (
                        <div className="connection-note">
                          <strong>Incomplete financial results</strong>
                          <ul>
                            {report.warnings.map((w) => (
                              <li key={w}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <p>
                        Delivery / service charges have no separate field in
                        product sales. Overhead and labor beyond saved COGS,
                        unrecorded fees and other unlinked costs are excluded.
                        Event contribution is not net business profit.
                      </p>
                      <dl className="event-metrics">
                        {Object.entries(report.metrics).map(([name, value]) => (
                          <div key={name}>
                            <dt>{name}</dt>
                            <dd>
                              {name.includes('margin %')
                                ? value === null
                                  ? 'Unavailable / no positive sales'
                                  : `${value}%`
                                : money(value)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <p>
                        COGS uses only the cost saved with each sale.
                        Completed-batch and finished weighted-average sources
                        are recorded historical valuations. Sale-time estimates
                        remain estimated; absent or unverified sources make
                        profit incomplete. Saved valuations may contain
                        configured labor, overhead, flat packaging and waste
                        allocations; those allocations do not establish cash
                        paid for this event. Shared batch costs are never added
                        again.
                      </p>
                      <p>
                        Order count / average order value: unavailable. Sale
                        record count: {report.originals.length}. Average net
                        sales per original sale record:{' '}
                        {report.originals.length
                          ? money(
                              report.metrics['Net sales'] /
                                report.originals.length,
                            )
                          : 'Unavailable (zero sales)'}
                        . A sale record can represent multiple packages.
                      </p>
                      <h3>Sales by product</h3>
                      <div className="event-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              {[
                                'Product',
                                'Net quantity',
                                'Gross',
                                'Discounts',
                                'Refunds',
                                'Net sales',
                                'Saved cost',
                              ].map((h) => (
                                <th key={h}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {report.products.map((p) => (
                              <tr key={p.id}>
                                <td>{p.name}</td>
                                <td>{p.quantity}</td>
                                <td>{money(p.gross)}</td>
                                <td>{money(p.discounts)}</td>
                                <td>{money(p.refunds)}</td>
                                <td>{money(p.netSales)}</td>
                                <td>{money(p.cost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <h3>Payments by recorded method</h3>
                      {report.methods.map((m) => (
                        <p key={m.name}>
                          {m.name}: {money(m.amount)}
                        </p>
                      ))}
                      <p>
                        Payments are reconciled to cash/bank journal postings,
                        excluding fee journals. Refund payments appear
                        separately above. No invoice payment is counted as a
                        second sale.
                      </p>
                      <h3>Underlying sales & refunds</h3>
                      {report.sales.map((s) => (
                        <article key={s.id} className="event-linked-record">
                          <button
                            className="text-button"
                            onClick={() => visit('sale-detail', s)}
                          >
                            {s.name} · {s.id}
                          </button>
                          <p>
                            {s.date} · {money(s.amount)} ·{' '}
                            {s.refundOf
                              ? `Refund of ${s.refundOf}`
                              : 'Original sale'}{' '}
                            · Cost: {s.costSource || 'Missing / unverified'}
                          </p>
                          {editable && !s.refundOf && (
                            <button
                              disabled={busy}
                              className={button}
                              onClick={() =>
                                void act('eventUnlink', {
                                  eventId: event.id,
                                  kind: 'sale',
                                  recordId: s.id,
                                })
                              }
                            >
                              Unlink sale (including its refunds)
                            </button>
                          )}
                        </article>
                      ))}
                    </section>
                  )}
                {(tab === 'Expenses' || tab === 'Print report') &&
                  financial && (
                    <section className="event-card">
                      <h3>Recorded event expenses</h3>
                      <p>
                        Each expense belongs to one event. Inventory, production
                        cost, waste and processing fee categories are excluded
                        to avoid duplicate cost recognition.
                      </p>
                      {!report.expenses.length && (
                        <p>No event expenses linked.</p>
                      )}
                      {report.expenses.map((e) => (
                        <article className="event-linked-record" key={e.id}>
                          <button
                            className="text-button"
                            onClick={() =>
                              visit('event-source', {
                                ...e,
                                sourceTable: e.sourceTable,
                              })
                            }
                          >
                            {e.name} · {e.id}
                          </button>
                          <p>
                            {e.date} · {e.category} · {money(e.amount)}
                          </p>
                          {editable && (
                            <button
                              className={button}
                              disabled={busy}
                              onClick={() =>
                                void act('eventUnlink', {
                                  eventId: event.id,
                                  kind: e.eventKind,
                                  recordId: e.id,
                                })
                              }
                            >
                              Unlink expense
                            </button>
                          )}
                        </article>
                      ))}
                      {editable && (
                        <button
                          className={button}
                          onClick={() => visit('expense')}
                        >
                          Record expense using existing expense workflow
                        </button>
                      )}
                      <p>
                        After recording, reopen this event and link the expense
                        below. Linking never creates a duplicate expense.
                      </p>
                    </section>
                  )}
                {(tab === 'Notes' || tab === 'Print report') && (
                  <section className="event-card">
                    <h3>Internal notes</h3>
                    <p className="event-preserve-text">
                      {event.notes || 'No notes entered.'}
                    </p>
                  </section>
                )}
                {editable &&
                  [
                    'Batch runs',
                    'Orders & pickups',
                    'Sales & financials',
                    'Expenses',
                  ].includes(tab) && (
                    <form
                      className="event-card event-assignment"
                      onSubmit={async (e) => {
                        e.preventDefault()
                        const useKind =
                          tab === 'Batch runs'
                            ? 'batch'
                            : tab === 'Orders & pickups'
                              ? 'pickup'
                              : tab === 'Expenses'
                                ? 'expense'
                                : 'sale'
                        if (
                          await act('eventLink', {
                            eventId: event.id,
                            kind:
                              useKind === 'expense'
                                ? selectedRecord?.eventKind || 'expense'
                                : useKind,
                            recordId,
                            pickupStatus,
                            allocations:
                              selectedRecord && useKind === 'batch'
                                ? batchOutputs(selectedRecord)
                                    .filter(
                                      (l) =>
                                        allocations[l.id] !== undefined &&
                                        allocations[l.id] !== '',
                                    )
                                    .map((l) => ({
                                      lineId: l.id,
                                      productId: l.productId,
                                      quantity: Number(allocations[l.id]),
                                    }))
                                : [],
                          })
                        ) {
                          setRecordId('')
                          setAllocations({})
                        }
                      }}
                    >
                      <h3>
                        {tab === 'Batch runs'
                          ? 'Link batch run / update allocation'
                          : tab === 'Orders & pickups'
                            ? 'Schedule an invoice pickup'
                            : tab === 'Expenses'
                              ? 'Link an existing expense'
                              : 'Attribute an existing sale'}
                      </h3>
                      <Label name="Existing record">
                        <select
                          required
                          value={recordId}
                          onChange={(e) => {
                            setKind(
                              tab === 'Batch runs'
                                ? 'batch'
                                : tab === 'Orders & pickups'
                                  ? 'pickup'
                                  : tab === 'Expenses'
                                    ? 'expense'
                                    : 'sale',
                            )
                            setRecordId(e.target.value)
                            setAllocations({})
                          }}
                        >
                          <option value="">Choose a record</option>
                          {sources[
                            tab === 'Batch runs'
                              ? 'batch'
                              : tab === 'Orders & pickups'
                                ? 'pickup'
                                : tab === 'Expenses'
                                  ? 'expense'
                                  : 'sale'
                          ].map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} · {r.date} · {r.id}
                            </option>
                          ))}
                        </select>
                      </Label>
                      {tab === 'Batch runs' &&
                        selectedRecord &&
                        batchOutputs(selectedRecord).map((l) => (
                          <Label
                            key={l.id}
                            name={`${state.products.find((p) => p.id === l.productId)?.name || l.name}: packages reserved (optional; blank = planning link)`}
                          >
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={allocations[l.id] ?? ''}
                              onChange={(e) =>
                                setAllocations((a) => ({
                                  ...a,
                                  [l.id]: e.target.value,
                                }))
                              }
                            />
                          </Label>
                        ))}
                      {tab === 'Orders & pickups' && (
                        <Label name="Pickup status">
                          <select
                            value={pickupStatus}
                            onChange={(e) => setPickupStatus(e.target.value)}
                          >
                            <option>Awaiting pickup</option>
                            <option>Picked up</option>
                          </select>
                        </Label>
                      )}
                      <p>
                        Review the record identifier before linking. Dates never
                        assign records automatically. A sale, invoice pickup or
                        expense can belong to one event; batch runs can support
                        several events.
                      </p>
                      <button className="btn" disabled={busy || !recordId}>
                        Save association
                      </button>
                    </form>
                  )}
              </>
            )
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
