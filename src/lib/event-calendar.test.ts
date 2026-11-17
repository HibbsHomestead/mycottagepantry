import { expect, it } from 'vitest'
import {
  moveEvent,
  timedLayout,
  validateCalendarChange,
} from './event-calendar'
const event = {
  id: 'a',
  name: 'Market',
  type: 'Market / sale event',
  status: 'Scheduled',
  startDate: '2026-03-07',
  endDate: '2026-03-07',
  startTime: '23:00',
  endTime: '23:45',
  allDay: false,
}
it('moves wall dates across DST without shifting business hours', () => {
  const next = moveEvent(event, '2026-03-08', '23:30')
  expect(next).toMatchObject({
    startDate: '2026-03-08',
    endDate: '2026-03-09',
    startTime: '23:30',
    endTime: '00:15',
  })
  expect(
    validateCalendarChange(next, {
      id: 's',
      name: 'Settings',
      timezone: 'America/Chicago',
    }).startAt,
  ).toBe('2026-03-09T04:30:00.000Z')
})
it('rejects dragging into a daylight-saving gap or ambiguous fold', () => {
  for (const day of ['2026-03-08', '2026-11-01'])
    expect(() =>
      validateCalendarChange(
        moveEvent(event, day, day.includes('03') ? '02:00' : '01:00'),
        { id: 's', name: 'Settings', timezone: 'America/Chicago' },
      ),
    ).toThrow(/daylight saving/)
})
it('uses shared columns for chained overlaps and releases columns for later events', () => {
  const rows = timedLayout(
    [
      { ...event, id: 'a', startTime: '09:00', endTime: '11:00' },
      { ...event, id: 'b', startTime: '10:00', endTime: '12:00' },
      { ...event, id: 'c', startTime: '11:00', endTime: '13:00' },
      { ...event, id: 'd', startTime: '13:00', endTime: '14:00' },
    ],
    event.startDate,
  )
  expect(rows.map((r) => [r.column, r.columns])).toEqual([
    [0, 2],
    [1, 2],
    [0, 2],
    [0, 1],
  ])
})
