/** Display only: never use formatted quantities as calculation or form values. */
export function inventoryQuantity(
  value: unknown,
  locale: string | undefined = 'en-US',
): string {
  if (value == null || value === '' || typeof value === 'boolean')
    return 'Unavailable'
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Unavailable'
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  const rounded = formatter.format(n)
  if (
    n !== 0 &&
    Number(
      new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 2,
        useGrouping: false,
      }).format(n),
    ) === 0
  )
    return n > 0 ? `<${formatter.format(0.01)}` : `>-${formatter.format(0.01)}`
  return Object.is(n, -0) ? formatter.format(0) : rounded
}
