import { useState } from 'react'
export function DemoBanner() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function action(action: 'reset' | 'exit') {
    if (
      action === 'reset' &&
      !window.confirm(
        'Reset your demo workspace? All changes in this demo session will be replaced with fresh sample data. Other workspaces are unaffected.',
      )
    )
      return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, confirm: true }),
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'The demo could not be updated.')
      window.location.assign(action === 'exit' ? '/login' : '/oven')
    } catch (failure) {
      setError((failure as Error).message)
      setBusy(false)
    }
  }
  return (
    <aside className="demo-workspace-banner" aria-label="Demo workspace">
      <span>Demo workspace — sample data only.</span>
      <span className="button-row">
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => void action('reset')}
        >
          Reset demo data
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => void action('exit')}
        >
          Leave demo
        </button>
      </span>
      {error && <p role="alert">{error}</p>}
    </aside>
  )
}
