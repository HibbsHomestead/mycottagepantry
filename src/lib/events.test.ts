import { describe, expect, it } from 'vitest'
import { demoData } from './demo'
import type { Item } from './domain'
import {
  addDays,
  eventInstant,
  eventLastDay,
  eventReport,
  validateAllocations,
  validateEvent,
} from './events'

const representativeEvent: Item = {
  id: 'market',
  name: 'Harvest market',
  type: 'Market / sale event',
  status: 'Scheduled',
  startDate: '2026-11-07',
  endDate: '2026-11-08',
  allDay: true,
}
function fixture() {
  const w = demoData()
  w.events = [representativeEvent]
  w.sales = [
    {
      id: 'a',
      name: 'Bread',
      productId: 'loaf',
      quantity: 10,
      amount: 90,
      discounts: 10,
      tax: 4.5,
      fees: 2.75,
      historicalCogs: 30,
      costSource: 'completed_batch',
      paymentMethod: 'Card',
    },
    {
      id: 'b',
      name: 'Cookies',
      productId: 'cookiepack',
      quantity: 5,
      amount: 40,
      discounts: 0,
      tax: 2,
      fees: 1.25,
      historicalCogs: 15,
      costSource: 'finished_weighted_average',
      paymentMethod: 'Cash',
    },
    {
      id: 'r',
      name: 'Bread refund',
      productId: 'loaf',
      quantity: -2,
      amount: -18,
      discounts: 10,
      tax: -0.9,
      fees: 0,
      historicalCogs: -6,
      costSource: 'completed_batch',
      refundOf: 'a',
    },
    {
      id: 'unrelated',
      name: 'Not this event',
      amount: 500,
      date: representativeEvent.startDate,
    },
  ]
  w.event_sale_links = ['a', 'b'].map((recordId) => ({
    id: recordId,
    name: recordId,
    eventId: 'market',
    recordId,
  }))
  w.journals = w.sales.slice(0, 3).map((s) => ({
    id: s.id,
    name: s.name,
    status: 'posted',
    sourceId: s.id,
    lines: [
      {
        account: 'Cash',
        debit: s.amount > 0 ? s.amount + s.tax : 0,
        credit: s.amount < 0 ? -s.amount - s.tax : 0,
      },
      {
        account: 'Sales revenue',
        debit: s.amount < 0 ? -s.amount : 0,
        credit: s.amount > 0 ? s.amount : 0,
      },
    ],
  }))
  w.journals.push({
    id: 'fee',
    name: 'Fee',
    sourceId: 'a',
    status: 'posted',
    lines: [
      { account: 'Payment processing fees', debit: 2.75 },
      { account: 'Cash', credit: 2.75 },
    ],
  })
  w.expenses = [
    {
      id: 'booth',
      name: 'Vendor fee',
      amount: 20,
      category: 'Market/vendor fees',
    },
  ]
  w.event_expense_links = [
    { id: 'expense', name: 'Vendor fee', eventId: 'market', recordId: 'booth' },
  ]
  w.finance_transactions = [
    {
      id: 'invoice',
      name: 'Pickup customer',
      kind: 'invoice',
      amount: 80,
      paid: 30,
    },
  ]
  w.event_pickups = [
    {
      id: 'pickup',
      name: 'Pickup customer',
      eventId: 'pickup-day',
      recordId: 'invoice',
      pickupStatus: 'Awaiting pickup',
    },
  ]
  return w
}
describe('event results', () => {
  it('reconciles merchandise, discounts, refunds, taxes, fees and saved COGS without counting payment records twice', () => {
    const report = eventReport(representativeEvent, fixture())
    expect(report.metrics).toMatchObject({
      'Gross merchandise sales': 140,
      Discounts: 10,
      'Merchandise refunds': 18,
      'Net sales': 112,
      'Taxes collected (net of refunds)': 5.6,
      'Payments collected': 136.5,
      'Refund payments': 18.9,
      'Outstanding sales balance': 0,
      'Saved COGS (may include estimates)': 39,
      'Gross profit (verified recorded cost basis)': 73,
      'Payment processing fees': 4,
      'Event expenses': 20,
      'Event contribution (verified recorded cost basis)': 49,
      'Contribution margin % (contribution / net sales)': 43.75,
    })
    expect(report.products.find((p) => p.id === 'loaf')).toMatchObject({
      gross: 100,
      discounts: 10,
      refunds: 18,
      netSales: 72,
      quantity: 8,
      cost: 24,
    })
    expect(report.pickups).toHaveLength(0)
    const pickup = eventReport(
      { id: 'pickup-day', name: 'Pickup day' },
      fixture(),
    )
    expect(pickup.pickupOutstanding).toBe(50)
    expect(pickup.metrics['Net sales']).toBe(0)
  })
  it('never substitutes current prices for missing or estimated historical costs', () => {
    const w = fixture()
    delete w.sales[0].historicalCogs
    expect(
      eventReport(representativeEvent, w).metrics[
        'Event contribution (verified recorded cost basis)'
      ],
    ).toBeNull()
    w.sales[0].historicalCogs = 30
    w.sales[0].costSource = 'current_estimate'
    expect(eventReport(representativeEvent, w)).toMatchObject({
      recordedContribution: 49,
      actualCosts: false,
    })
    expect(
      eventReport(representativeEvent, w).metrics[
        'Gross profit (verified recorded cost basis)'
      ],
    ).toBeNull()
  })
  it('handles zero sales and legacy payment/discount gaps explicitly', () => {
    const w = fixture()
    w.event_sale_links = []
    const empty = eventReport(representativeEvent, w)
    expect(empty.metrics['Net sales']).toBe(0)
    expect(
      empty.metrics['Contribution margin % (contribution / net sales)'],
    ).toBeNull()
    w.event_sale_links = [
      { id: 'x', name: 'x', eventId: 'market', recordId: 'unrelated' },
    ]
    const legacy = eventReport(representativeEvent, w)
    expect(legacy.metrics['Gross merchandise sales']).toBeNull()
    expect(legacy.metrics['Payments collected']).toBeNull()
    expect(legacy.metrics['Taxes collected (net of refunds)']).toBeNull()
  })
})
describe('event dates and planning allocations', () => {
  it('validates all event types, multi-day dates and daylight saving gaps/folds', () => {
    for (const type of ['Market / sale event', 'Pickup day', 'Other event'])
      expect(
        validateEvent(
          { ...representativeEvent, type },
          { id: 'settings', name: '', timezone: 'America/Chicago' },
        ).type,
      ).toBe(type)
    expect(eventInstant('2026-03-08', '01:30', 'America/Chicago')).toBe(
      '2026-03-08T07:30:00.000Z',
    )
    expect(eventInstant('2026-03-08', '03:30', 'America/Chicago')).toBe(
      '2026-03-08T08:30:00.000Z',
    )
    expect(() =>
      eventInstant('2026-03-08', '02:30', 'America/Chicago'),
    ).toThrow(/does not exist/)
    expect(() =>
      eventInstant('2026-11-01', '01:30', 'America/Chicago'),
    ).toThrow(/twice/)
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(
      eventLastDay({ ...representativeEvent, allDay: false, endTime: '00:00' }),
    ).toBe('2026-11-07')
    expect(() =>
      validateEvent(
        { ...representativeEvent, endDate: '2026-11-06' },
        { id: 's', name: '' },
      ),
    ).toThrow(/End date/)
  })
  it('limits shared batch allocations by product line and keeps planning links free of allocation', () => {
    const w = fixture(),
      batch = {
        id: 'run',
        name: 'Mixed run',
        status: 'completed',
        productionVersion: 2,
        lines: [
          { id: 'bread', productId: 'loaf', quantity: 12, actualYield: 10 },
          {
            id: 'cookie',
            productId: 'cookiepack',
            quantity: 8,
            actualYield: 8,
          },
        ],
      }
    w.event_batch_links = [
      {
        id: 'other',
        name: 'Other',
        eventId: 'other',
        recordId: 'run',
        allocations: [{ lineId: 'bread', productId: 'loaf', quantity: 6 }],
      },
    ]
    const allocation = {
      id: '',
      name: '',
      lineId: 'bread',
      productId: 'loaf',
      quantity: 4,
    }
    expect(
      validateAllocations('market', batch, [allocation], w)[0].quantity,
    ).toBe(4)
    expect(() =>
      validateAllocations('market', batch, [{ ...allocation, quantity: 5 }], w),
    ).toThrow(/exceeds/)
    expect(() =>
      validateAllocations('market', batch, [allocation, allocation], w),
    ).toThrow(/once/)
    expect(() =>
      validateAllocations(
        'market',
        batch,
        [{ ...allocation, productId: 'foreign' }],
        w,
      ),
    ).toThrow(/once/)
    expect(validateAllocations('market', batch, [], w)).toEqual([])
    expect(() =>
      validateAllocations(
        'market',
        { ...batch, status: 'canceled' },
        [allocation],
        w,
      ),
    ).toThrow(/exceeds/)
  })
})
it('reads current bookkeeping expenses, excludes mirrored duplicates and applies expense refunds/reversals once', () => {
  const w = fixture()
  w.finance_transactions.push({
    id: 'travel',
    name: 'Market travel',
    kind: 'expense',
    amount: 12.5,
    category: 'Gas / mileage',
  })
  w.event_finance_expense_links = [
    { id: 'travel-link', name: '', eventId: 'market', recordId: 'travel' },
  ]
  expect(eventReport(representativeEvent, w).metrics['Event expenses']).toBe(
    32.5,
  )
  w.finance_transactions.push({
    id: 'refund-travel',
    name: 'Travel refund',
    kind: 'expenseRefund',
    originalId: 'travel',
    amount: 2.5,
  })
  expect(eventReport(representativeEvent, w).metrics['Event expenses']).toBe(30)
  w.finance_transactions.find((t) => t.id === 'travel')!.reversedBy =
    'correction'
  expect(eventReport(representativeEvent, w).metrics['Event expenses']).toBe(20)
  w.finance_transactions.push({
    id: 'booth',
    name: 'Vendor fee mirror',
    kind: 'expense',
    amount: 20,
    reversedBy: 'reversal',
  })
  expect(eventReport(representativeEvent, w).metrics['Event expenses']).toBe(0)
})
