import { useEffect, useRef, useState } from 'react'
import type { Item } from '../lib/domain'
import { addDays, eventLastDay, eventTypes } from '../lib/events'
import {
  clockTime,
  minutes,
  moveEvent,
  timedLayout,
} from '../lib/event-calendar'

type Props = {
  view: string
  anchor: string
  first: string
  today: string
  timezone: string
  events: Item[]
  editable: boolean
  busy: boolean
  select: (day: string) => void
  create: (day: string, time?: string, allDay?: boolean) => void
  show: (event: Item) => void
  reschedule: (event: Item) => Promise<void>
}
const label = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Date(day + 'T12:00:00Z').toLocaleDateString(undefined, {
    ...options,
    timeZone: 'UTC',
  })
export function EventCalendar(p: Props) {
  const [now, setNow] = useState(new Date())
  const agendaRef = useRef<HTMLDivElement>(null)
  const revealDay = (day: string) => {
    p.select(day)
    requestAnimationFrame(() =>
      agendaRef.current?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      }),
    )
  }
  const timeline = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (timeline.current) timeline.current.scrollTop = 7 * 60
  }, [p.view, p.first])
  const drag = useRef<{ event: Item; resize?: boolean } | null>(null)
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])
  const onDay = (day: string) =>
    p.events.filter((e) => e.startDate <= day && eventLastDay(e) >= day)
  const chip = (e: Item) => (
    <button
      key={e.id}
      className="event-chip"
      data-type={eventTypes.indexOf(e.type)}
      title={`${e.name} · ${e.allDay ? 'All day' : e.startTime + '–' + e.endTime} · ${e.type} · ${e.status}`}
      draggable={p.editable && !p.busy}
      onDragStart={(ev) => {
        drag.current = { event: e }
        ev.dataTransfer.setData('text/plain', e.id)
        ev.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={() => {
        drag.current = null
      }}
      onClick={() => p.show(e)}
    >
      <strong>{e.name}</strong>
      <span>
        {e.allDay ? 'All day' : `${e.startTime}–${e.endTime}`}
        {e.startDate !== e.endDate ? ' · Multi-day' : ''}
      </span>
      <span>
        {e.type} · {e.status}
      </span>
    </button>
  )
  const drop = (day: string, time?: string) => {
    const value = drag.current
    drag.current = null
    if (!value || p.busy || !p.editable) return
    const next = value.resize
      ? { ...value.event, endDate: day, endTime: time || value.event.endTime }
      : moveEvent(value.event, day, time)
    void p.reschedule(next)
  }
  const agenda = (days: string[]) => (
    <div className="calendar-agenda" ref={agendaRef}>
      {days.map((day) => (
        <section key={day}>
          <div className="agenda-heading">
            <h3>
              {label(day, { weekday: 'long', month: 'short', day: 'numeric' })}
              {day === p.today ? ' · Today' : ''}
            </h3>
            {p.editable && (
              <button className="text-button" onClick={() => p.create(day)}>
                + Event
              </button>
            )}
          </div>
          {onDay(day).length ? (
            onDay(day).map(chip)
          ) : (
            <p className="calendar-quiet">No events planned</p>
          )}
        </section>
      ))}
    </div>
  )
  if (p.view === 'Month')
    return (
      <>
        <div className="calendar-month" aria-label="Month calendar">
          <div className="calendar-weekdays">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="calendar-month-grid">
            {Array.from({ length: 42 }, (_, i) => {
              const day = addDays(p.first, i),
                events = onDay(day)
              return (
                <section
                  key={day}
                  className={`calendar-cell ${day === p.today ? 'is-today' : ''} ${day === p.anchor ? 'is-selected' : ''} ${day.slice(0, 7) !== p.anchor.slice(0, 7) ? 'is-outside' : ''}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    drop(day)
                  }}
                >
                  <div className="calendar-cell-heading">
                    <button
                      aria-label={`Select ${day}`}
                      aria-pressed={day === p.anchor}
                      onClick={() => p.select(day)}
                    >
                      {Number(day.slice(8))}
                    </button>
                    {p.editable && (
                      <button
                        className="calendar-add"
                        aria-label={`Create event on ${day}`}
                        onClick={() => p.create(day)}
                      >
                        +
                      </button>
                    )}
                  </div>
                  <div className="calendar-cell-events">
                    {events.slice(0, 2).map(chip)}
                    {events.length > 2 && (
                      <button
                        className="text-button calendar-more"
                        onClick={() => revealDay(day)}
                      >
                        +{events.length - 2} more events
                      </button>
                    )}
                  </div>
                  <button
                    className="calendar-mobile-count"
                    aria-label={`${events.length} events on ${day}`}
                    onClick={() => p.select(day)}
                  >
                    {events.length ? `${events.length} ·` : ''}
                  </button>
                </section>
              )
            })}
          </div>
        </div>
        {agenda([p.anchor])}
      </>
    )
  const days = Array.from({ length: p.view === 'Week' ? 7 : 1 }, (_, i) =>
    addDays(p.first, i),
  )
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: p.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  return (
    <>
      <div
        ref={timeline}
        className={`calendar-timeline calendar-timeline-${p.view.toLowerCase()}`}
        aria-label={`${p.view} calendar`}
      >
        <div
          className="calendar-time-columns"
          style={{
            gridTemplateColumns: `3.4rem repeat(${days.length}, minmax(0, 1fr))`,
          }}
        >
          <div className="calendar-time-zone">All day</div>
          {days.map((day) => (
            <div
              className={`calendar-time-heading ${day === p.today ? 'is-today' : ''}`}
              key={day}
            >
              <button className="text-button" onClick={() => p.select(day)}>
                {label(day, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </button>
              {onDay(day)
                .filter((e) => e.allDay)
                .map(chip)}
              {p.editable && (
                <button
                  className="text-button"
                  aria-label={`Create all-day event on ${day}`}
                  onClick={() => p.create(day, undefined, true)}
                >
                  +
                </button>
              )}
            </div>
          ))}
          <div className="calendar-hours">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h}>{clockTime(h * 60)}</span>
            ))}
          </div>
          {days.map((day) => (
            <div
              className="calendar-time-day"
              key={day}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const bounds = e.currentTarget.getBoundingClientRect()
                const minute = Math.min(
                  1425,
                  Math.max(
                    0,
                    Math.round(
                      ((e.clientY - bounds.top) / bounds.height) * 96,
                    ) * 15,
                  ),
                )
                drop(day, clockTime(minute))
              }}
            >
              {Array.from({ length: 48 }, (_, i) => (
                <button
                  key={i}
                  className="calendar-slot"
                  disabled={!p.editable || p.busy}
                  aria-label={`Create event ${day} ${clockTime(i * 30)}`}
                  onClick={() => p.create(day, clockTime(i * 30))}
                />
              ))}
              {timedLayout(p.events, day).map((row) => (
                <div
                  key={row.event.id}
                  className="calendar-positioned-event"
                  style={{
                    top: `${row.start / 14.4}%`,
                    height: `${Math.max(30, row.end - row.start) / 14.4}%`,
                    left: `${(row.column / row.columns) * 100}%`,
                    width: `${100 / row.columns}%`,
                  }}
                >
                  {chip(row.event)}
                  {p.editable && row.event.endDate === day && (
                    <div
                      role="button"
                      tabIndex={0}
                      className="calendar-resize"
                      aria-label={`Resize ${row.event.name}; press Enter to edit times`}
                      draggable={!p.busy}
                      onDragStart={(e) => {
                        e.stopPropagation()
                        drag.current = { event: row.event, resize: true }
                        e.dataTransfer.setData('text/plain', row.event.id)
                      }}
                      onDragEnd={() => {
                        drag.current = null
                      }}
                      onClick={() => p.show(row.event)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          p.show(row.event)
                        }
                      }}
                    >
                      ⠿
                    </div>
                  )}
                </div>
              ))}
              {day === p.today && (
                <div
                  className="calendar-now"
                  style={{ top: `${minutes(parts) / 14.4}%` }}
                  aria-label={`Current time ${parts}`}
                >
                  <span>{parts}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="calendar-small-agenda">{agenda(days)}</div>
    </>
  )
}
