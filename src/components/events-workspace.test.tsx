import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { EventsWorkspace } from './events-workspace'
import { demoData } from '../lib/demo'
import { ovenToday } from '../lib/oven-dates'
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})
function setup(view = 'List', role = 'Owner') {
  const state = demoData(),
    today = ovenToday(state.settings[0])
  state.events = [
    {
      id: 'market',
      name: 'Long harvest market and neighborhood pickup gathering',
      type: 'Market / sale event',
      status: 'Scheduled',
      startDate: today,
      endDate: today,
      startTime: '09:00',
      endTime: '13:00',
      timezone: 'America/Chicago',
      allDay: false,
      revision: 1,
      location: 'Town hall',
      budget: 60,
      plannedRevenue: 200,
    },
  ]
  const mutate = vi.fn().mockResolvedValue(undefined),
    openRecord = vi.fn()
  return {
    state,
    mutate,
    openRecord,
    props: { state, view, role, mutate, openRecord, busy: false },
  }
}
for (const type of ['Market / sale event', 'Pickup day', 'Other event'])
  it(`creates an all-day ${type} without posting stock or money`, async () => {
    const user = userEvent.setup(),
      { props, mutate } = setup()
    render(<EventsWorkspace {...props} />)
    await user.click(screen.getByRole('button', { name: 'New event' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.type(
      dialog.getByRole('textbox', { name: 'Event name' }),
      'Autumn pickup',
    )
    await user.selectOptions(
      dialog.getByRole('combobox', { name: 'Event type' }),
      type,
    )
    await user.click(dialog.getByRole('checkbox', { name: 'All day' }))
    await user.click(dialog.getByRole('button', { name: 'Save event' }))
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(
      'eventSave',
      'events',
      expect.objectContaining({ name: 'Autumn pickup', type, allDay: true }),
    )
  })
for (const view of ['List', 'Month', 'Week', 'Day'])
  it(`opens the same detailed popup from ${view} and supports keyboard dismissal`, async () => {
    const user = userEvent.setup(),
      { props, state } = setup(view)
    render(<EventsWorkspace {...props} />)
    expect(screen.getByRole('link', { name: view })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await user.click(
      screen.getAllByRole('button', {
        name: new RegExp(state.events[0].name),
      })[0],
    )
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      state.events[0].name,
    )
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Sales & financials',
      }),
    )
    expect(screen.getByText('Event financial results')).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
it('preserves entered changes after a server validation failure', async () => {
  const user = userEvent.setup(),
    { props, mutate, state } = setup()
  mutate.mockRejectedValue(new Error('End time must follow the start time.'))
  render(<EventsWorkspace {...props} />)
  await user.click(screen.getByRole('button', { name: state.events[0].name }))
  await user.click(screen.getByRole('button', { name: 'Edit event' }))
  await user.clear(screen.getByRole('textbox', { name: 'Event name' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Event name' }),
    'Edited market',
  )
  await user.click(screen.getByRole('button', { name: 'Save event' }))
  expect(screen.getByRole('alert')).toHaveTextContent('End time')
  expect(screen.getByRole('textbox', { name: 'Event name' })).toHaveValue(
    'Edited market',
  )
  expect(mutate).toHaveBeenCalledWith(
    'eventSave',
    'events',
    expect.objectContaining({ expectedRevision: 1 }),
  )
})
it('hides financial reporting and mutations from production staff', async () => {
  const user = userEvent.setup(),
    { props, state } = setup('List', 'Production Staff')
  render(<EventsWorkspace {...props} />)
  expect(
    screen.queryByRole('button', { name: 'New event' }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: state.events[0].name }))
  expect(
    screen.queryByRole('button', { name: 'Sales & financials' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText('Plans and recorded results'),
  ).not.toBeInTheDocument()
})
it('filters by search, type and status and navigates date ranges with an empty state', async () => {
  const user = userEvent.setup(),
    { props } = setup()
  render(<EventsWorkspace {...props} />)
  await user.type(
    screen.getByRole('textbox', { name: 'Search events' }),
    'nowhere',
  )
  expect(screen.getByText('No events in this range')).toBeVisible()
  await user.clear(screen.getByRole('textbox', { name: 'Search events' }))
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Event type' }),
    'Pickup day',
  )
  expect(screen.getByText('No events in this range')).toBeVisible()
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Event type' }),
    '',
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Status' }),
    'Cancelled',
  )
  expect(screen.getByText('No events in this range')).toBeVisible()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), '')
  expect(screen.queryByText('No events in this range')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Next date range' }))
  expect(screen.getByText('No events in this range')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Today' }))
  expect(screen.queryByText('No events in this range')).not.toBeInTheDocument()
})
