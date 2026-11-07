import type { Item, Workspace } from './domain'
import { isPackaging, pantryCategoryId } from './pantry-category'
import { dateRange } from './date-ranges'
export const knownNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)
const iso = (date: Date) => dateRange('This month', date).end
export function dashboardData(w: Workspace, now = new Date()) {
  const today = iso(now),
    end = new Date(now)
  end.setDate(end.getDate() + 6)
  const tracked = w.ingredients.filter((i) => i.trackInventory !== false)
  const ingredients = tracked.filter(
    (i) =>
      !isPackaging(i) &&
      pantryCategoryId(i) !== 'supplies' &&
      i.usedAs !== 'supply' &&
      i.usedAs !== 'material',
  )
  const packaging = tracked.filter(isPackaging)
  const configured = (i: Item) =>
    knownNumber(i.quantity) && knownNumber(i.threshold)
  const low = (items: Item[]) =>
    items.filter((i) => configured(i) && i.quantity <= i.threshold)
  const categories = new Map<string, number>()
  for (const i of tracked)
    categories.set(
      i.category || 'Unassigned',
      (categories.get(i.category || 'Unassigned') || 0) + 1,
    )
  const range = dateRange('This month', now)
  const sales = w.sales.filter((s) => s.date >= range.start && s.date <= today)
  const expenses = w.expenses.filter(
    (e) => e.date >= range.start && e.date <= today && !e.inventory,
  )
  const sum = (items: Item[], field: string) =>
    items.reduce((n, i) => n + (knownNumber(i[field]) ? i[field] : 0), 0)
  const historical = new Map<string, number>()
  for (const s of sales)
    if (knownNumber(s.amount))
      historical.set(s.date, (historical.get(s.date) || 0) + s.amount)
  return {
    ingredients,
    packaging,
    low: low(ingredients),
    packagingLow: low(packaging),
    inventoryValue: ingredients.every(
      (i) =>
        knownNumber(i.quantity) && knownNumber(i.cost) && !i.needsCostSetup,
    )
      ? ingredients.reduce((n, i) => n + i.quantity * i.cost, 0)
      : null,
    unconfigured: ingredients.filter((i) => !configured(i)).length,
    packagingUnconfigured: packaging.filter((i) => !configured(i)).length,
    upcoming: w.batches
      .filter(
        (b) =>
          !['completed', 'cancelled'].includes(b.status) &&
          /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') &&
          b.date >= today &&
          b.date <= iso(end),
      )
      .sort((a, b) => a.date.localeCompare(b.date)),
    undatedBatches: w.batches.filter(
      (b) =>
        !['completed', 'cancelled'].includes(b.status) &&
        !/^\d{4}-\d{2}-\d{2}$/.test(b.date || ''),
    ).length,
    activity: [...(w.ledger || [])]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 5),
    categories: [...categories].sort((a, b) => b[1] - a[1]),
    trend: [...historical].sort((a, b) => a[0].localeCompare(b[0])),
    revenue: sum(sales, 'amount'),
    cogs: sum(sales, 'historicalCogs'),
    costs: sum(expenses, 'amount') + sum(sales, 'fees'),
    incomplete:
      sales.some(
        (s) =>
          !knownNumber(s.amount) ||
          !knownNumber(s.historicalCogs) ||
          (s.fees != null && !knownNumber(s.fees)),
      ) || expenses.some((e) => !knownNumber(e.amount)),
    invalidSales: sales.some((s) => !knownNumber(s.amount)),
  }
}
