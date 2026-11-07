import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

declare const __APP_VERSION__: string
const bundledVersion =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''

const updateParameter = '__app_update'

/** A new document URL bypasses cached HTML while keeping the route and session. */
export function refreshApplication(
  version: string,
  location: Pick<Location, 'href' | 'replace'> = window.location,
) {
  const target = new URL(location.href)
  target.searchParams.set(updateParameter, version)
  // Native beforeunload guards protect dirty editors. No tabs reload automatically.
  location.replace(target.href)
}

/** Compare against the version bundled with this tab, never a first-fetch baseline. */
export function AppUpdateNotice({
  version = bundledVersion,
  refresh = refreshApplication,
}: {
  version?: string
  refresh?: (version: string) => void
}) {
  const [latest, setLatest] = useState<{
    running: string
    published: string
  } | null>(null)
  const available = latest?.running === version && latest.published !== version
  useEffect(() => {
    if (!version) return
    // Remove only our navigation marker, never saved data or browser storage.
    const current = new URL(window.location.href)
    if (current.searchParams.has(updateParameter)) {
      current.searchParams.delete(updateParameter)
      window.history.replaceState(window.history.state, '', current.href)
    }
    let stopped = false
    let pending = false
    let controller: AbortController | undefined
    const check = async () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine || pending)
        return
      pending = true
      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), 10000)
      try {
        const response = await fetch(`/app-version.json?t=${Date.now()}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (
          !response.ok ||
          !response.headers.get('content-type')?.includes('application/json')
        )
          return
        const next = await response.json()
        if (
          !stopped &&
          typeof next?.version === 'string' &&
          /^[a-zA-Z0-9_-]{1,128}$/.test(next.version)
        )
          setLatest({ running: version, published: next.version })
      } catch {
        // Offline, older deployments, and temporary errors leave the workspace usable.
      } finally {
        window.clearTimeout(timeout)
        pending = false
      }
    }
    void check()
    const interval = window.setInterval(() => void check(), 5 * 60 * 1000)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      stopped = true
      controller?.abort()
      window.clearInterval(interval)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [version])
  if (!available) return null
  return (
    <div className="app-update-notice" role="status">
      <RefreshCw size={18} aria-hidden="true" />
      <p>
        <strong>A Cottage Pantry update is available.</strong> Save your work,
        then refresh to get the latest version.
      </p>
      <button
        type="button"
        className="btn secondary"
        onClick={() => {
          if (latest) refresh(latest.published)
        }}
      >
        Refresh app
      </button>
    </div>
  )
}
