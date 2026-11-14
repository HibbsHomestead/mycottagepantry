export async function supportRequest(path = '', options: RequestInit = {}) {
  const headers = new Headers(options.headers)
  if (path.includes('view=staff') || path.includes('settings='))
    headers.set('x-cp-admin', '1')
  const response = await fetch('/api/support' + path, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data)
    throw new Error(
      data?.error || 'Support is temporarily unavailable. Try again later.',
    )
  return data
}
export function supportPost(staff: boolean, action: string, data: unknown) {
  return supportRequest(staff ? '?view=staff' : '', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data }),
  })
}
export async function uploadSupportScreenshot(
  staff: boolean,
  messageId: string,
  file: File,
  submissionKey: string,
) {
  const form = new FormData()
  form.set('screenshot', file)
  return supportRequest(
    `?upload=1&view=${staff ? 'staff' : 'customer'}&messageId=${messageId}&submissionKey=${submissionKey}`,
    { method: 'POST', body: form },
  )
}

export function supportAiRequest(staff = false, data?: unknown) {
  return supportRequest(
    '?ai=1&view=' + (staff ? 'staff' : 'customer'),
    data === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
  )
}
