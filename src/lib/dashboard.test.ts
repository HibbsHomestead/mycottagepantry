import { expect, it } from 'vitest'
import { demoData } from './demo'
import { dashboardData } from './dashboard'
const now = new Date('2026-11-02T12:00:00')
it('separates ingredient value, packaging and untracked stock without changing records', () => {
  const w = demoData()
  w.ingredients = [
    {
      id: 'a',
      name: 'Flour',
      usedAs: 'ingredient',
      quantity: 2,
      cost: 3,
      threshold: 4,
    },
    {
      id: 'p',
      name: 'Bags',
      categoryId: 'packaging',
      quantity: 5,
      cost: 10,
      threshold: 5,
    },
    {
      id: 's',
      name: 'Soap',
      usedAs: 'supply',
      quantity: 1,
      cost: 20,
      threshold: 2,
    },
    {
      id: 'u',
      name: 'Untracked',
      trackInventory: false,
      quantity: 100,
      cost: 100,
    },
    { id: 'missing', name: 'Salt', usedAs: 'ingredient', quantity: 0, cost: 0 },
  ]
  const before = structuredClone(w),
    d = dashboardData(w, now)
  expect(d.inventoryValue).toBe(6)
  expect(d.low.map((i) => i.id)).toEqual(['a'])
  expect(d.packagingLow.map((i) => i.id)).toEqual(['p'])
  expect(d.unconfigured).toBe(1)
  expect(w).toEqual(before)
  w.ingredients[0].cost = null
  expect(dashboardData(w, now).inventoryValue).toBeNull()
})
it('counts only upcoming open runs and never invents history or cost snapshots', () => {
  const w = demoData()
  w.ingredients = []
  w.sales = []
  w.expenses = []
  w.batches = [
    { id: 'next', name: 'Next bake', date: '2026-11-08', status: 'scheduled' },
    { id: 'past', name: 'Past', date: '2026-11-01', status: 'scheduled' },
    { id: 'closed', name: 'Closed', date: '2026-11-03', status: 'completed' },
    { id: 'missing', name: 'Undated', status: 'scheduled' },
  ]
  let d = dashboardData(w, now)
  expect(d.upcoming.map((b) => b.id)).toEqual(['next'])
  expect(d.undatedBatches).toBe(1)
  expect(d.inventoryValue).toBe(0)
  expect(d.trend).toEqual([])
  w.sales = [
    { id: 'zero', name: 'Recorded zero', date: '2026-11-01', amount: 0 },
    { id: 'future', name: 'Future', date: '2026-11-10', amount: 500 },
  ]
  d = dashboardData(w, now)
  expect(d.trend).toEqual([['2026-11-01', 0]])
  expect(d.incomplete).toBe(true)
})
