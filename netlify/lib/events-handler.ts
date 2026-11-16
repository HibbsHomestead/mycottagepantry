import { randomUUID } from 'node:crypto'
import type { Item, Workspace } from '../../src/lib/domain'
import {
  validateEvent,
  validateAllocations,
  eventTables,
} from '../../src/lib/events'

type Context = {
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> }
  org: string
  role: string
  state: Workspace
  audit: (name: string, detail: string) => Promise<unknown>
}
export async function handleEvent(
  action: string,
  data: Item,
  { client, org, role, state, audit }: Context,
) {
  if (!['Owner', 'Manager'].includes(role))
    throw new Error(
      'Only an Owner or Manager can manage events and financial associations.',
    )
  if (action === 'eventSave') {
    if (
      data.id != null &&
      (typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(data.id))
    )
      throw new Error('Invalid event identifier.')
    const previous = state.events.find((e) => e.id === data.id)
    if (previous && previous.revision !== data.expectedRevision)
      throw new Error('This event changed. Close and reopen it before saving.')
    if (!previous && data.expectedRevision != null)
      throw new Error('Event no longer exists.')
    const event = {
      ...validateEvent(
        { ...data, id: data.id || randomUUID() },
        state.settings[0],
      ),
      revision: Number(previous?.revision || 0) + 1,
    }
    await client.query(
      'INSERT INTO events(id,business_id,data) VALUES($1,$2,$3) ON CONFLICT(business_id,id) DO UPDATE SET data=$3,updated_at=now()',
      [event.id, org, JSON.stringify(event)],
    )
    await audit(
      previous ? 'Event updated' : 'Event created',
      `${event.name}; planning only. No financial or stock postings.`,
    )
    return
  }
  const event = state.events.find((e) => e.id === data.eventId)
  if (!event) throw new Error('Choose an event in this business.')
  const config: Record<string, string[]> = {
    batch: ['event_batch_links', 'batches', 'batch_id'],
    sale: ['event_sale_links', 'sales', 'sale_id'],
    expense: ['event_expense_links', 'expenses', 'expense_id'],
    bookExpense: [
      'event_finance_expense_links',
      'finance_transactions',
      'expense_id',
    ],
    pickup: ['event_pickups', 'finance_transactions', 'invoice_id'],
  }
  const selected = config[data.kind]
  if (!selected) throw new Error('Invalid event relationship.')
  const [table, source, column] = selected
  if (!eventTables.includes(table))
    throw new Error('Invalid relationship table.')
  const record = state[source].find((r) => r.id === data.recordId)
  if (!record) throw new Error('Choose an existing record in this business.')
  const existing = state[table].find(
    (l) => l.eventId === event.id && l.recordId === record.id,
  )
  if (action === 'eventUnlink') {
    await client.query(
      `DELETE FROM ${table} WHERE business_id=$1 AND event_id=$2 AND ${column}=$3`,
      [org, event.id, record.id],
    )
    await audit(
      'Event record unlinked',
      `${event.name}: ${record.name}. Source record preserved.`,
    )
    return
  }
  if (action !== 'eventLink') throw new Error('Unknown event action.')
  if (data.kind === 'sale' && record.refundOf)
    throw new Error(
      'Associate the original sale. Refunds follow it automatically.',
    )
  if (
    ['expense', 'bookExpense'].includes(data.kind) &&
    ['draft', 'superseded'].includes(record.status)
  )
    throw new Error(
      'Post this expense in Finance before linking it to an event.',
    )
  if (
    ['expense', 'bookExpense'].includes(data.kind) &&
    (record.inventory ||
      /processing|cogs|waste|shrink/i.test(record.category || ''))
  )
    throw new Error(
      'Inventory, COGS, waste and processing-fee expenses cannot be allocated here; this prevents double counting.',
    )
  if (
    data.kind === 'pickup' &&
    (record.kind !== 'invoice' || record.reversedBy)
  )
    throw new Error(
      'Pickups require an active customer invoice. Purchase orders are not customer orders.',
    )
  if (
    data.kind !== 'batch' &&
    state[table].some((l) => l.recordId === record.id && l.eventId !== event.id)
  )
    throw new Error(
      'This record already belongs to another event. Unlink it there first; split attribution is not supported.',
    )
  const link: Item = {
    id: existing?.id || randomUUID(),
    name: record.name,
    eventId: event.id,
    recordId: record.id,
  }
  if (data.kind === 'batch')
    link.allocations = validateAllocations(
      event.id,
      record,
      data.allocations || [],
      state,
    )
  if (
    data.kind === 'bookExpense' &&
    (record.kind !== 'expense' || record.reversedBy)
  )
    throw new Error('Choose an active recorded expense.')
  if (['expense', 'bookExpense'].includes(data.kind)) {
    const counterpart =
      data.kind === 'expense'
        ? state.event_finance_expense_links
        : state.event_expense_links
    const duplicate = (counterpart || []).some((l) =>
      data.kind === 'expense'
        ? l.recordId === (record.transactionId || record.id)
        : state.expenses.some(
            (e) =>
              e.id === l.recordId && (e.transactionId || e.id) === record.id,
          ),
    )
    if (duplicate)
      throw new Error(
        'This expense is already associated through its linked financial record.',
      )
  }
  if (data.kind === 'pickup') {
    if (!['Awaiting pickup', 'Picked up'].includes(data.pickupStatus))
      throw new Error('Choose a pickup status.')
    link.pickupStatus = data.pickupStatus
    link.pickedUpAt =
      data.pickupStatus === 'Picked up'
        ? existing?.pickedUpAt || new Date().toISOString()
        : null
  }
  await client.query(
    `INSERT INTO ${table}(id,business_id,data,event_id,${column}) VALUES($1,$2,$3,$4,$5) ON CONFLICT(business_id,id) DO UPDATE SET data=$3,updated_at=now()`,
    [link.id, org, JSON.stringify(link), event.id, record.id],
  )
  await audit(
    'Event record associated',
    `${event.name}: ${record.name}. No stock, expense, sale or payment created.`,
  )
}
