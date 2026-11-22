let checked: Promise<boolean> | null = null
/** Server decides; this cache only avoids starting Identity in a sandbox tab. */
export function activeDemoSession() {
  checked ??= fetch('/api/demo?session=1', {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
    .then(
      async (response) =>
        response.ok && (await response.json()).active === true,
    )
    .catch(() => false)
  return checked
}
export async function enterDemo(username = 'demo', password = 'demo') {
  const response = await fetch('/api/demo', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'enter', username, password }),
  })
  const result = await response.json()
  if (!response.ok)
    throw new Error(result.error || 'Demo access is unavailable.')
  checked = null
  if (!(await activeDemoSession()))
    throw new Error(
      'This browser blocked the demo session cookie. Open the preview in a new tab, then choose Try demo there.',
    )
  window.location.assign('/oven')
}
