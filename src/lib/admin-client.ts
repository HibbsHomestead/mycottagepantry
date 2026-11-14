class PortalError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
  }
}
export async function adminRequest(query: string, body?: unknown) {
  const response = await fetch('/api/admin' + (query ? '?' + query : ''), {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'x-cp-admin': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw new PortalError(
      data?.error ||
        'Administration is unavailable. Retry when the connection is restored.',
      response.status,
      data?.code,
    )
  return data
}
