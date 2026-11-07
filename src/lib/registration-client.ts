export async function registrationRequest(view = '', data?: unknown) {
  const response = await fetch(
    `/api/registration${view ? '?view=' + encodeURIComponent(view) : ''}`,
    {
      method: data ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: data ? { 'Content-Type': 'application/json' } : undefined,
      body: data ? JSON.stringify(data) : undefined,
    },
  ).catch(() => {
    throw new Error(
      'The request did not finish. Retry; your entered details are preserved.',
    )
  })
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error(
      'The account service returned an unexpected response. Retry; your entered details are preserved.',
    )
  const result = await response.json()
  if (!response.ok)
    throw Object.assign(new Error(result.error || 'Please try again later.'), {
      code: result.code,
      status: response.status,
      fields: result.fields,
    })
  return result
}
