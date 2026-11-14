export class SupportRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}
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
    throw new SupportRequestError(
      data?.error || 'Support is temporarily unavailable. Try again later.',
      response.status,
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

/** Downloads use the same authenticated request headers as inbox reads. */
export async function downloadSupportScreenshot(staff: boolean, id: string) {
  const response = await fetch(
    `/api/support?view=${staff ? 'staff' : 'customer'}&attachment=${encodeURIComponent(id)}`,
    {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: staff ? { 'x-cp-admin': '1' } : {},
    },
  )
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new SupportRequestError(
      data?.error || 'Screenshot download failed. Try again.',
      response.status,
    )
  }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = 'support-screenshot.png'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
