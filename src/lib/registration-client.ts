export async function registrationRequest(view = '', data?: unknown) {
  const response = await fetch(
    `/api/registration${view ? '?view=' + encodeURIComponent(view) : ''}`,
    {
      method: data ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: data ? { 'Content-Type': 'application/json' } : undefined,
      body: data ? JSON.stringify(data) : undefined,
    },
  )
  const result = await response.json()
  if (!response.ok)
    throw Object.assign(new Error(result.error || 'Please try again later.'), {
      code: result.code,
      status: response.status,
    })
  return result
}
