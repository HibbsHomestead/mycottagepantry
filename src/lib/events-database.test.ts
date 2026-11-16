// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { handleEvent } from '../../netlify/lib/events-handler'
import { demoData } from './demo'

it('enforces event RLS, same-business FKs, exclusive sale attribution and noncascading financial history', async () => {
  const db = new PGlite()
  const a = '00000000-0000-4000-8000-000000000061',
    b = '00000000-0000-4000-8000-000000000062'
  try {
    await db.exec(
      `CREATE TABLE businesses(id uuid PRIMARY KEY); INSERT INTO businesses VALUES('${a}'),('${b}');`,
    )
    for (const table of [
      'batches',
      'sales',
      'expenses',
      'finance_transactions',
    ])
      await db.exec(
        `CREATE TABLE ${table}(id text, business_id uuid, data jsonb, UNIQUE(business_id,id)); INSERT INTO ${table} VALUES('own','${a}','{}'),('foreign','${b}','{}');`,
      )
    for (const migration of [
      '20261217010000_add_events_pickup_days',
      '20261218010000_add_event_bookkeeping_expenses',
    ])
      await db.exec(
        await readFile(
          new URL(
            `../../netlify/database/migrations/${migration}/migration.sql`,
            import.meta.url,
          ),
          'utf8',
        ),
      )
    await db.exec(
      `CREATE ROLE event_user; GRANT SELECT,INSERT,UPDATE,DELETE ON events,event_batch_links,event_sale_links,event_expense_links,event_pickups,event_finance_expense_links TO event_user; SET ROLE event_user; SET app.business_id='${a}';`,
    )
    await db.query(
      'INSERT INTO events(id,business_id,data) VALUES($1,$2,$3),($4,$2,$3)',
      ['first', a, '{}', 'second'],
    )
    expect((await db.query('SELECT * FROM events')).rows).toHaveLength(2)
    await expect(
      db.query('INSERT INTO events(id,business_id,data) VALUES($1,$2,$3)', [
        'foreign-event',
        b,
        '{}',
      ]),
    ).rejects.toThrow(/row-level security/)
    await expect(
      db.query(
        'INSERT INTO event_batch_links(id,business_id,data,event_id,batch_id) VALUES($1,$2,$3,$4,$5)',
        ['cross', a, '{}', 'first', 'foreign'],
      ),
    ).rejects.toThrow(/foreign key/)
    await db.query(
      'INSERT INTO event_sale_links(id,business_id,data,event_id,sale_id) VALUES($1,$2,$3,$4,$5)',
      ['sale', a, '{}', 'first', 'own'],
    )
    await expect(
      db.query(
        'INSERT INTO event_sale_links(id,business_id,data,event_id,sale_id) VALUES($1,$2,$3,$4,$5)',
        ['duplicate', a, '{}', 'second', 'own'],
      ),
    ).rejects.toThrow(/unique/)
    await expect(
      db.query('DELETE FROM events WHERE id=$1', ['first']),
    ).rejects.toThrow(/foreign key/)
    await db.exec('RESET ROLE')
    expect((await db.query('SELECT * FROM sales')).rows).toHaveLength(2)
    await db.exec(`SET ROLE event_user; SET app.business_id='${b}';`)
    expect((await db.query('SELECT * FROM events')).rows).toHaveLength(0)
  } finally {
    await db.close()
  }
}, 20000)

it('checks roles, ownership, revision, refunds and expense eligibility before writing relationships', async () => {
  const state = demoData()
  state.events = [{ id: 'event', name: 'Event', revision: 1 }]
  state.event_sale_links = []
  state.event_batch_links = []
  state.event_expense_links = []
  state.event_pickups = []
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }) },
    audit = vi.fn()
  const ctx = { client, org: 'a', role: 'Owner', state, audit }
  const request = {
    id: '',
    name: '',
    eventId: 'event',
    kind: 'sale',
    recordId: state.sales[0].id,
  }
  for (const role of ['Production Staff', 'Read-only Accountant'])
    await expect(
      handleEvent('eventLink', request, { ...ctx, role }),
    ).rejects.toThrow(/Owner or Manager/)
  await expect(
    handleEvent('eventLink', { ...request, recordId: 'foreign' }, ctx),
  ).rejects.toThrow(/this business/)
  await expect(
    handleEvent(
      'eventSave',
      { id: 'event', name: '', expectedRevision: 0 },
      ctx,
    ),
  ).rejects.toThrow(/changed/)
  state.sales.push({
    id: 'refund',
    name: 'Refund',
    refundOf: state.sales[0].id,
  })
  await expect(
    handleEvent('eventLink', { ...request, recordId: 'refund' }, ctx),
  ).rejects.toThrow(/original sale/)
  state.event_sale_links.push({
    id: 'existing',
    name: '',
    eventId: 'other',
    recordId: request.recordId,
  })
  await expect(handleEvent('eventLink', request, ctx)).rejects.toThrow(
    /another event/,
  )
  await expect(
    handleEvent(
      'eventLink',
      {
        ...request,
        kind: 'expense',
        recordId: state.expenses.find((e) => e.inventory)!.id,
      },
      ctx,
    ),
  ).rejects.toThrow(/double counting/)
  expect(client.query).not.toHaveBeenCalled()
  state.events[0] = {
    ...state.events[0],
    type: 'Pickup day',
    status: 'Scheduled',
    startDate: '2026-11-07',
    endDate: '2026-11-07',
    allDay: true,
  }
  await handleEvent(
    'eventSave',
    { ...state.events[0], expectedRevision: 1, status: 'Cancelled' },
    ctx,
  )
  expect(client.query).toHaveBeenCalledTimes(1)
  expect(client.query.mock.calls[0][0]).toMatch(/^INSERT INTO events/)
  expect(state.sales).toHaveLength(6)
  expect(audit).toHaveBeenCalled()
})
