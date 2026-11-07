export const datePeriods = [
  'This month',
  'Last month',
  'This quarter',
  'Year to date',
  'Custom',
] as const
export type DatePeriod = (typeof datePeriods)[number]
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export function dateRange(period: DatePeriod, today = new Date()) {
  const y = today.getFullYear(),
    m = today.getMonth()
  if (period === 'Last month')
    return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) }
  if (period === 'This quarter')
    return {
      start: iso(new Date(y, Math.floor(m / 3) * 3, 1)),
      end: iso(today),
    }
  if (period === 'Year to date') return { start: `${y}-01-01`, end: iso(today) }
  return { start: iso(new Date(y, m, 1)), end: iso(today) }
}
