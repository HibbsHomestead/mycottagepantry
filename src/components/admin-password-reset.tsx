import { useEffect, useRef, useState, type FormEvent } from 'react'

export function AdminPasswordReset({
  onComplete,
  onRequestLink,
}: {
  onComplete: () => void
  onRequestLink: () => void
}) {
  const [stage, setStage] = useState<'checking' | 'ready' | 'invalid'>(
    'checking',
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  // One-use links must not be redeemed twice during effect replay.
  const callback = useRef<Promise<unknown> | null>(null)
  useEffect(() => {
    let active = true
    const originalHash = window.location.hash
    callback.current ??= import('@netlify/identity').then(async (identity) => {
      const result = await identity.handleAuthCallback()
      if (result?.type !== 'recovery') throw new Error('RECOVERY_REQUIRED')
    })
    void callback.current
      .then(() => {
        if (active) setStage('ready')
      })
      .catch(() => {
        if (active) {
          setStage('invalid')
          setError(
            'This reset link is invalid, expired, or already used. Request a new link below.',
          )
        }
      })
      .finally(() => {
        // Never keep recovery material in browser history, including on failure.
        if (window.location.hash === originalHash)
          window.history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search,
          )
      })
    return () => {
      active = false
    }
  }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || stage !== 'ready') return
    if (password !== confirmation) {
      setError('The passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const identity = await import('@netlify/identity')
      await identity.updateUser({ password })
      setPassword('')
      setConfirmation('')
      // Recovery establishes only a provider session. Clear it and return to
      // the separate administrator email-and-password sign-in flow.
      await identity.logout().catch(() => {})
      onComplete()
    } catch {
      setError(
        'Your password could not be updated. Try again, or request a new reset link.',
      )
    } finally {
      setBusy(false)
    }
  }
  if (stage === 'checking')
    return <p role="status">Checking your reset link…</p>
  return (
    <div>
      <h2>Choose a new password</h2>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {stage === 'ready' && (
        <form className="admin-login" onSubmit={submit}>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={256}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={256}
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <button className="admin-primary" disabled={busy}>
            {busy ? 'Saving password…' : 'Save new password'}
          </button>
        </form>
      )}
      <button
        type="button"
        className="admin-text-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          const identity = await import('@netlify/identity')
          await identity.logout().catch(() => {})
          onRequestLink()
        }}
      >
        Request a new reset link
      </button>
    </div>
  )
}
