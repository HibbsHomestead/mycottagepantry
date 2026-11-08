export type ProductFetchHop = {
  url: string
  at: string
  status: number
  headers: Record<string, string>
  bodySummary: string
}
export type ProductImportDiagnostics = {
  requestId?: string
  requestedAt: string
  requestedUrl: string
  source: 'retailer' | 'backend' | 'network'
  stage?: 'fetch' | 'parse'
  hops: ProductFetchHop[]
}
/** Keep identifiers/selection while excluding arbitrary query values from diagnostics. */
export function diagnosticUrl(value: string) {
  const url = new URL(value)
  url.hash = ''
  url.username = ''
  url.password = ''
  for (const key of [...url.searchParams.keys()])
    if (!(
      (['th', 'psc'].includes(key.toLowerCase()) &&
        /^\d{1,3}$/.test(url.searchParams.get(key) || '')) ||
      (key.toLowerCase() === 'asin' &&
        /^[A-Z0-9]{10}$/i.test(url.searchParams.get(key) || ''))
    ))
      url.searchParams.set(key, '[redacted]')
  return url.href
}
export function retryDeadline(
  value: string | null | undefined,
  now = Date.now(),
) {
  if (!value) return now + 3000
  if (/^\d+$/.test(value.trim())) {
    const milliseconds = Number(value) * 1000
    return Number.isFinite(milliseconds) ? now + milliseconds : Infinity
  }
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(now, date) : now + 3000
}
export class ProductImportFailure extends Error {
  constructor(
    message: string,
    readonly diagnostics: ProductImportDiagnostics,
    readonly retryAfter?: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message)
  }
}
