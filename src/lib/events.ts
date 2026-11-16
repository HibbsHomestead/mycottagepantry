import { roundMoney, validateDate, type Item, type Workspace } from './domain'
import { ovenTimezone } from './oven-dates'
import { productionRunLines } from './production-run'

export const eventTypes = ['Market / sale event', 'Pickup day', 'Other event']
export const eventStatuses = ['Draft', 'Scheduled', 'Completed', 'Cancelled']
export const eventTables = [
  'events',
  'event_batch_links',
  'event_sale_links',
  'event_expense_links',
  'event_pickups',
  'event_finance_expense_links',
]
export const eventBasis =
  'Explicit whole-sale-record attribution (one product line per record); refunds follow their original sale. Invoice pickups do not create event sales. Reports read current underlying records, including after completion. Batch allocations reserve planning quantities only and add no COGS.'
export function addDays(day: string, amount: number) {
  const date = new Date(day + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}
/** Resolve a business wall time. Reject gaps and ambiguous DST folds instead of guessing. */
export function eventInstant(day: string, time: string, timezone: string) {
  validateDate(day)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error('Enter a valid time.')
  const target = `${day}T${time}`
  const utc = Date.parse(target + ':00Z')
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const offsets = new Set<number>()
  for (const delta of [-86400000, 0, 86400000]) {
    const probe = utc + delta
    const local = formatter.format(new Date(probe)).replace(' ', 'T')
    offsets.add(Date.parse(local + ':00Z') - probe)
  }
  const matches = [...offsets]
    .map((offset) => utc - offset)
    .filter(
      (instant) =>
        formatter.format(new Date(instant)).replace(' ', 'T') === target,
    )
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? 'This time occurs twice at daylight saving time. Choose an unambiguous time.'
        : 'This time does not exist at daylight saving time. Choose another time.',
    )
  return new Date(matches[0]).toISOString()
}
export function eventLastDay(event: Item) {
  return !event.allDay && event.endTime === '00:00'
    ? addDays(event.endDate, -1)
    : event.endDate
}
export function validateEvent(data: Item, settings: Item): Item {
  const name = String(data.name || '').trim()
  if (!name || name.length > 200)
    throw new Error('Enter an event name of up to 200 characters.')
  if (!eventTypes.includes(data.type) || !eventStatuses.includes(data.status))
    throw new Error('Choose a valid event type and status.')
  const startDate = validateDate(data.startDate),
    endDate = validateDate(data.endDate)
  if (endDate < startDate)
    throw new Error('End date must follow the start date.')
  const timezone = ovenTimezone(settings)
  const allDay = data.allDay === true
  const startAt = allDay
    ? null
    : eventInstant(startDate, data.startTime, timezone)
  const endAt = allDay ? null : eventInstant(endDate, data.endTime, timezone)
  if (startAt && endAt && endAt <= startAt)
    throw new Error('End time must follow the start time.')
  const optionalMoney = (key: string) => {
    if (data[key] === '' || data[key] == null) return null
    const value = Number(data[key])
    if (!Number.isFinite(value) || value < 0 || value > 1e10)
      throw new Error('Budgets must be nonnegative amounts.')
    return roundMoney(value)
  }
  return {
    id: data.id,
    name,
    type: data.type,
    status: data.status,
    startDate,
    endDate,
    allDay,
    startTime: allDay ? '' : data.startTime,
    endTime: allDay ? '' : data.endTime,
    startAt,
    endAt,
    timezone,
    location: String(data.location || '').slice(0, 2000),
    description: String(data.description || '').slice(0, 10000),
    notes: String(data.notes || '').slice(0, 10000),
    plannedRevenue: optionalMoney('plannedRevenue'),
    budget: optionalMoney('budget'),
  }
}
export function batchOutputs(batch: Item): Item[] {
  const lines = productionRunLines(batch)
  return (lines.length ? lines : batch.productId ? [batch] : []).map((l) => ({
    id: l.id,
    name: l.name || batch.name,
    productId: l.productId,
    planned: Number(l.quantity || 0),
    completed:
      batch.status === 'completed'
        ? Number(l.actualYield ?? l.output ?? 0)
        : null,
    available: ['canceled', 'cancelled'].includes(batch.status)
      ? 0
      : batch.status === 'completed'
        ? Number(l.actualYield ?? l.output ?? 0)
        : Number(l.quantity || 0),
    waste: l.waste == null ? null : Number(l.waste),
  }))
}
export function validateAllocations(
  eventId: string,
  batch: Item,
  allocations: Item[],
  state: Workspace,
) {
  if (!Array.isArray(allocations) || allocations.length > 100)
    throw new Error('Invalid allocation list.')
  const outputs = batchOutputs(batch)
  const seen = new Set<string>()
  return allocations
    .map((a) => {
      const output = outputs.find(
        (l) => l.id === a.lineId && l.productId === a.productId,
      )
      if (!output || seen.has(a.lineId))
        throw new Error('Choose each batch product line once.')
      seen.add(a.lineId)
      const quantity = Number(a.quantity)
      const elsewhere = (state.event_batch_links || [])
        .filter((l) => l.recordId === batch.id && l.eventId !== eventId)
        .flatMap((l) => l.allocations || [])
        .filter((a2) => a2.lineId === a.lineId)
        .reduce((n, a2) => n + Number(a2.quantity), 0)
      const available = output.available
      if (
        !Number.isFinite(quantity) ||
        quantity < 0 ||
        quantity + elsewhere > available + 1e-8
      )
        throw new Error(
          'Allocation exceeds available batch quantity. Unlink or reduce other allocations first.',
        )
      return { lineId: a.lineId, productId: a.productId, quantity }
    })
    .filter((a) => a.quantity > 0)
}
export function eventExpenseRecords(state: Workspace): Item[] {
  const finance = state.finance_transactions || []
  const legacy = state.expenses || []
  const normalize = (record: Item, eventKind: string): Item => {
    const source =
      eventKind === 'expense'
        ? finance.find((t) => t.id === (record.transactionId || record.id)) ||
          record
        : record
    const refunds = finance.filter(
      (t) =>
        t.kind === 'expenseRefund' &&
        t.originalId === source.id &&
        !t.reversedBy,
    )
    return {
      ...record,
      eventKind,
      sourceTable:
        eventKind === 'expense' ? 'expenses' : 'finance_transactions',
      originalAmount: record.amount,
      amount: source.reversedBy
        ? 0
        : roundMoney(
            Number(record.amount) -
              refunds.reduce((n, t) => n + Number(t.amount), 0),
          ),
      reversedBy: source.reversedBy,
    }
  }
  return [
    ...legacy.map((e) => normalize(e, 'expense')),
    ...finance
      .filter(
        (t) =>
          t.kind === 'expense' &&
          !legacy.some((e) => (e.transactionId || e.id) === t.id),
      )
      .map((e) => normalize(e, 'bookExpense')),
  ]
}
const numeric = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n)
export function eventReport(event: Item, state: Workspace) {
  const links = (table: string) =>
    (state[table] || []).filter((l) => l.eventId === event.id)
  const ids = new Set(links('event_sale_links').map((l) => l.recordId))
  const originals = (state.sales || []).filter(
    (s) => ids.has(s.id) && !s.refundOf,
  )
  const sales = (state.sales || []).filter(
    (s) =>
      (ids.has(s.id) && !s.refundOf) || (s.refundOf && ids.has(s.refundOf)),
  )
  const refunds = sales.filter((s) => s.refundOf)
  const warnings: string[] = []
  warnings.push(
    'Customer delivery / service charges are not separately tracked in product sales; this report covers merchandise records only.',
  )
  const sum = (rows: Item[], key: string) =>
    roundMoney(rows.reduce((n, r) => n + (numeric(r[key]) ? r[key] : 0), 0))
  const discountsKnown = originals.every(
    (s) =>
      numeric(s.discounts) &&
      !(
        s.discounts > 0 &&
        s.taxSnapshot?.some((t: Item) => t.behavior === 'inclusive')
      ),
  )
  if (!discountsKnown)
    warnings.push(
      'Gross sales and discounts unavailable for legacy sales or tax-inclusive discounts without a pre-tax discount snapshot.',
    )
  const taxKnown = sales.every((s) => numeric(s.tax))
  if (!taxKnown) warnings.push('Some sales lack a tax snapshot.')
  const discounts = discountsKnown ? sum(originals, 'discounts') : null
  const netSales = sum(sales, 'amount')
  const merchandiseRefunds = -sum(refunds, 'amount')
  const cogsKnown = sales.every((s) => numeric(s.historicalCogs))
  const actualCosts =
    cogsKnown &&
    sales.every((s) =>
      ['completed_batch', 'finished_weighted_average'].includes(s.costSource),
    )
  if (!actualCosts)
    warnings.push(
      cogsKnown
        ? 'COGS includes estimates or unverified historical cost sources. Profit is incomplete.'
        : 'Some sales have no saved historical COGS. Current ingredient prices are never substituted.',
    )
  if (actualCosts && sales.length)
    warnings.push(
      'Verified historical COGS is a recorded stock/production valuation and may include configured labor, overhead, flat packaging and waste allocations. Contribution on this basis is not fully measured event profitability.',
    )
  const feesKnown = sales.every((s) => numeric(s.fees))
  if (!feesKnown) warnings.push('Processing fees are missing on some sales.')
  const cash = (s: Item) => {
    const postings = (state.journals || []).filter(
      (j) =>
        j.sourceId === s.id &&
        j.status === 'posted' &&
        !j.feePosting &&
        !j.reversalOf &&
        (j.lines || []).some((l: Item) => l.account === 'Sales revenue'),
    )
    if (!postings.length)
      return s.customerTotal === 0 && s.amount === 0 ? 0 : null
    const accounts = new Set([
      'Cash',
      'Bank account',
      ...(state.accounts || [])
        .filter((a) => a.bookAccount && a.type === 'asset')
        .map((a) => a.name),
    ])
    const lines = postings
      .flatMap((j) => j.lines || [])
      .filter((l) => accounts.has(l.account))
    return lines.length
      ? roundMoney(
          lines.reduce(
            (n, l) => n + Number(l.debit || 0) - Number(l.credit || 0),
            0,
          ),
        )
      : null
  }
  const paymentsKnown = sales.every((s) => cash(s) !== null)
  if (!paymentsKnown)
    warnings.push(
      'Payments and outstanding sales balance lack matching cash postings for some sales. Invoice payments are kept in pickup operations.',
    )
  const expenseRecords = eventExpenseRecords(state)
  const expenses = [
    ...links('event_expense_links').map((l) => ({
      ...l,
      eventKind: 'expense',
    })),
    ...links('event_finance_expense_links').map((l) => ({
      ...l,
      eventKind: 'bookExpense',
    })),
  ]
    .map((l) =>
      expenseRecords.find(
        (e) => e.id === (l as Item).recordId && e.eventKind === l.eventKind,
      ),
    )
    .filter((e): e is Item => !!e)
  const expenseTotal = sum(expenses, 'amount')
  const cogs = cogsKnown ? sum(sales, 'historicalCogs') : null
  const fees = feesKnown ? sum(sales, 'fees') : null
  const recordedContribution =
    cogs !== null && fees !== null
      ? roundMoney(netSales - cogs - fees - expenseTotal)
      : null
  const contribution = actualCosts ? recordedContribution : null
  const payments = paymentsKnown
    ? roundMoney(originals.reduce((n, s) => n + (cash(s) || 0), 0))
    : null
  const refundPayments = paymentsKnown
    ? -roundMoney(refunds.reduce((n, s) => n + (cash(s) || 0), 0))
    : null
  const pickups: (Item & { invoice: Item | undefined })[] = links(
    'event_pickups',
  ).map((l) => ({
    ...l,
    invoice: (state.finance_transactions || []).find(
      (t) => t.id === l.recordId,
    ),
  }))
  const products = [...new Set(sales.map((s) => s.productId))].map(
    (productId) => {
      const rows = sales.filter((s) => s.productId === productId),
        positive = rows.filter((s) => !s.refundOf)
      const known = positive.every(
        (s) =>
          numeric(s.discounts) &&
          !(
            s.discounts > 0 &&
            s.taxSnapshot?.some((t: Item) => t.behavior === 'inclusive')
          ),
      )
      return {
        id: productId,
        name:
          state.products?.find((p) => p.id === productId)?.name || productId,
        quantity: sum(rows, 'quantity'),
        gross: known
          ? roundMoney(sum(positive, 'amount') + sum(positive, 'discounts'))
          : null,
        discounts: known ? sum(positive, 'discounts') : null,
        refunds: -sum(
          rows.filter((s) => s.refundOf),
          'amount',
        ),
        netSales: sum(rows, 'amount'),
        cost: rows.every((s) => numeric(s.historicalCogs))
          ? sum(rows, 'historicalCogs')
          : null,
      }
    },
  )
  const methods = [
    ...new Set(originals.map((s) => s.paymentMethod || 'Unrecorded')),
  ].map((name) => ({
    name,
    amount: paymentsKnown
      ? roundMoney(
          originals
            .filter((s) => (s.paymentMethod || 'Unrecorded') === name)
            .reduce((n, s) => n + (cash(s) || 0), 0),
        )
      : null,
  }))
  return {
    sales,
    originals,
    refunds,
    expenses,
    products,
    methods,
    pickups,
    warnings,
    metrics: {
      'Gross merchandise sales':
        discounts === null
          ? null
          : roundMoney(sum(originals, 'amount') + discounts),
      Discounts: discounts,
      'Merchandise refunds': merchandiseRefunds,
      'Net sales': netSales,
      'Taxes collected (net of refunds)': taxKnown ? sum(sales, 'tax') : null,
      'Delivery / service charges': null,
      'Payments collected': payments,
      'Refund payments': refundPayments,
      'Outstanding sales balance':
        payments !== null && refundPayments !== null && taxKnown
          ? roundMoney(
              netSales + sum(sales, 'tax') - payments + refundPayments,
            ) || 0
          : null,
      'Saved COGS (may include estimates)': cogs,
      'Gross profit (verified recorded cost basis)':
        actualCosts && cogs !== null ? roundMoney(netSales - cogs) : null,
      'Payment processing fees': fees,
      'Event expenses': expenseTotal,
      'Event contribution (verified recorded cost basis)': contribution,
      'Contribution margin % (contribution / net sales)':
        contribution !== null && netSales > 0
          ? roundMoney((contribution / netSales) * 100)
          : null,
    },
    recordedContribution,
    actualCosts,
    pickupOutstanding: roundMoney(
      pickups
        .filter((p) => p.invoice && !p.invoice.reversedBy)
        .reduce(
          (n, p) =>
            n +
            Math.max(
              0,
              Number(p.invoice!.amount) - Number(p.invoice!.paid || 0),
            ),
          0,
        ),
    ),
  }
}
