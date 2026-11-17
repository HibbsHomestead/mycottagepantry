import type { Item } from './domain'
import { addDays, eventLastDay, validateEvent } from './events'
export const minutes = (time: string) =>
  Number(time?.slice(0, 2) || 0) * 60 + Number(time?.slice(3, 5) || 0)
export const clockTime = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
export function moveEvent(event: Item, day: string, time?: string): Item {
  const delta = Math.round(
    (Date.parse(day + 'T12:00:00Z') -
      Date.parse(event.startDate + 'T12:00:00Z')) /
      86400000,
  )
  const result: Item = {
    ...event,
    startDate: day,
    endDate: addDays(event.endDate, delta),
  }
  if (time && !event.allDay) {
    const duration =
      (Date.parse(event.endDate + 'T00:00:00Z') -
        Date.parse(event.startDate + 'T00:00:00Z')) /
        60000 +
      minutes(event.endTime) -
      minutes(event.startTime)
    const end = minutes(time) + duration
    result.startTime = time
    result.endDate = addDays(day, Math.floor(end / 1440))
    result.endTime = clockTime(end % 1440)
  }
  return result
}
/** Allocate columns within each connected overlap group, including chained overlaps. */
export function timedLayout(events: Item[], day: string) {
  const rows = events
    .filter((e) => !e.allDay && e.startDate <= day && eventLastDay(e) >= day)
    .map((e) => ({
      event: e,
      start: e.startDate < day ? 0 : minutes(e.startTime),
      end: e.endDate > day ? 1440 : minutes(e.endTime),
      column: 0,
      columns: 1,
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end)
  let group: typeof rows = [],
    ends: number[] = [],
    groupEnd = -1
  const finish = () =>
    group.forEach((row) => {
      row.columns = ends.length
    })
  for (const row of rows) {
    if (row.start >= groupEnd) {
      finish()
      group = []
      ends = []
      groupEnd = -1
    }
    let column = ends.findIndex((end) => end <= row.start)
    if (column < 0) column = ends.length
    row.column = column
    ends[column] = row.end
    group.push(row)
    groupEnd = Math.max(groupEnd, row.end)
  }
  finish()
  return rows
}
export function validateCalendarChange(event: Item, settings: Item) {
  return validateEvent(event, settings)
}
