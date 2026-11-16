/** Development-only browser fixture. Synthetic records; no authentication bypass or production route. */
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { EventsWorkspace } from '../components/events-workspace'
import { demoData } from '../lib/demo'
import { addDays, validateEvent } from '../lib/events'
import { ovenToday } from '../lib/oven-dates'
import { applyAppearance, type Appearance } from '../lib/appearance'
import '../styles.css'
import '../workspace.css'
import '../surface-layout.css'
import '../interface-typography.css'
export function mountEventsFixture() {
  const params = new URLSearchParams(location.search)
  applyAppearance({
    theme: (params.get('theme') || 'cottage') as Appearance['theme'],
    mode: params.get('mode') === 'dark' ? 'dark' : 'light',
  })
  const host = document.createElement('div')
  document.body.replaceChildren(host)
  function Fixture() {
    const [state, setState] = useState(() => {
      const w = demoData(),
        today = ovenToday(w.settings[0])
      w.events = [
        {
          id: 'market',
          name: 'Harvest market and neighborhood pantry gathering',
          type: 'Market / sale event',
          status: 'Scheduled',
          startDate: today,
          endDate: today,
          startTime: '09:00',
          endTime: '14:00',
          allDay: false,
          timezone: 'America/Chicago',
          location: 'Town hall · West entrance',
          description: 'Bread, seasonal bakes and prearranged collections.',
          notes: 'Bring the folding table and reusable signs.',
          budget: 100,
          plannedRevenue: 400,
          revision: 1,
        },
        {
          id: 'pickup',
          name: 'Afternoon pickup',
          type: 'Pickup day',
          status: 'Scheduled',
          startDate: today,
          endDate: today,
          startTime: '12:00',
          endTime: '16:00',
          allDay: false,
          timezone: 'America/Chicago',
          revision: 1,
        },
        {
          id: 'multiday',
          name: 'Weekend bakery planning',
          type: 'Other event',
          status: 'Draft',
          startDate: addDays(today, -1),
          endDate: addDays(today, 1),
          allDay: true,
          timezone: 'America/Chicago',
          revision: 1,
        },
      ]
      w.event_batch_links = []
      w.event_expense_links = []
      w.event_finance_expense_links = []
      w.event_pickups = []
      w.event_sale_links = [
        { id: 'sale', name: '', eventId: 'market', recordId: w.sales[0].id },
      ]
      return w
    })
    const [view, setView] = useState(location.hash.split('/')[1] || 'Month')
    useEffect(() => {
      const read = () => setView(location.hash.split('/')[1] || 'Month')
      window.addEventListener('hashchange', read)
      return () => window.removeEventListener('hashchange', read)
    }, [])
    return (
      <main style={{ padding: 'clamp(12px, 2vw, 32px)' }}>
        <h1>Events & Pickup Days</h1>
        <p>Synthetic browser review fixture</p>
        <EventsWorkspace
          state={state}
          view={view}
          role="Owner"
          busy={false}
          openRecord={() => {}}
          mutate={async (action, _table, data) => {
            document.body.dataset.lastAction = action
            if (action === 'eventSave') {
              const saved = validateEvent(
                data as Parameters<typeof validateEvent>[0],
                state.settings[0],
              )
              setState((w) => ({
                ...w,
                events: [
                  ...w.events.filter((e) => e.id !== saved.id),
                  { ...saved, revision: 2 },
                ],
              }))
            }
          }}
        />
      </main>
    )
  }
  createRoot(host).render(<Fixture />)
}
