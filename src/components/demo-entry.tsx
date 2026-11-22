import { useEffect, useState } from 'react'
import { enterDemo } from '@/lib/demo-client'

export function DemoEntry({
  onAvailable,
}: {
  onAvailable?: (enabled: boolean) => void
}) {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    fetch('/api/demo', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => {
        if (live) {
          setEnabled(value?.enabled === true)
          onAvailable?.(value?.enabled === true)
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [onAvailable])
  if (!enabled) return null
  return (
    <section className="demo-entry" aria-label="Preview demo access">
      <p>
        Explore a private sample workspace. Public sandbox login:{' '}
        <b>demo / demo</b>.
      </p>
      <button
        type="button"
        className="public-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            await enterDemo()
          } catch (failure) {
            setError((failure as Error).message)
            setBusy(false)
          }
        }}
      >
        {busy ? 'Opening demo…' : 'Try demo'}
      </button>
      <a href="/login" target="_blank" rel="noopener noreferrer">
        Open preview in new tab
      </a>
      <details>
        <summary>Use demo username and password</summary>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy) return
            const fields = new FormData(event.currentTarget)
            setBusy(true)
            setError('')
            try {
              await enterDemo(
                String(fields.get('demoUsername')),
                String(fields.get('demoPassword')),
              )
            } catch (failure) {
              setError((failure as Error).message)
              setBusy(false)
            }
          }}
        >
          <label>
            Demo username
            <input
              name="demoUsername"
              autoComplete="off"
              autoCapitalize="none"
              required
            />
          </label>
          <label>
            Demo password
            <input
              name="demoPassword"
              type="password"
              autoComplete="off"
              required
            />
          </label>
          <button
            type="submit"
            className="public-button secondary"
            disabled={busy}
          >
            Open demo workspace
          </button>
        </form>
      </details>
      <p className="public-fine">
        Demo data expires after 7 days. Paid integrations, account connections,
        and external messages are disabled.
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
