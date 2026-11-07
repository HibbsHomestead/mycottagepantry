/** Calendar dates never pass through Date parsing; timestamps represent instants. */
export function ovenTimezone(settings?: Record<string, any>) {
  const zone = settings?.timezone || 'America/Chicago'
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return zone as string
  } catch {
    return 'America/Chicago'
  }
}
export function ovenToday(
  settings?: Record<string, any>,
  instant = new Date(),
) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ovenTimezone(settings),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const value = (type: string) => parts.find((p) => p.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}
export function ovenTimestamp(
  value: string | undefined,
  settings?: Record<string, any>,
) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Unavailable'
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: ovenTimezone(settings),
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value)) + ` (${ovenTimezone(settings)})`
  )
}
