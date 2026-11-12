import { useState } from 'react'
import type { AccountAccess } from '@/lib/access-state'
import { OvenLoading } from './oven-loading'

export function SignOutAccountButton() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function signOut() {
    setBusy(true)
    setError('')
    try {
      const identity = await import('@netlify/identity')
      await identity.logout()
      window.location.replace('/login?signedOut=1')
    } catch {
      setError('Sign out could not complete. Please retry.')
      setBusy(false)
    }
  }
  return (
    <>
      <button
        className="public-button secondary"
        type="button"
        disabled={busy}
        onClick={() => void signOut()}
      >
        Sign out and use another account
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  )
}

export function AccessDiagnostics({
  access,
  traceId,
  events = [],
}: {
  access?: AccountAccess | null
  traceId: string
  events?: { stage: string; result: string }[]
}) {
  if (!traceId) return null
  return (
    <details className="access-technical">
      <summary>Technical details</summary>
      <p>Support reference: {traceId}</p>
      <p>This reference contains no credentials or account details.</p>
      <pre>
        {JSON.stringify(
          {
            traceId,
            environment: access?.environment,
            events: [...events, ...(access?.events || [])],
          },
          null,
          2,
        )}
      </pre>
    </details>
  )
}
export function AccountAccessStatus({
  loading,
  access,
  traceId,
  retry,
  errorMessage,
}: {
  loading: boolean
  error: boolean
  access: AccountAccess | null
  traceId: string
  retry: () => void
  errorMessage?: string
}) {
  if (loading) return <OvenLoading />
  const denied = access?.status === 'access_denied'
  return (
    <OvenLoading
      error={
        denied
          ? 'Your oven membership is inactive. Contact your oven owner.'
          : errorMessage ||
            'Your account or business could not be loaded. Your session has not been cleared.'
      }
      retry={retry}
    >
      <section>
        {!loading && <SignOutAccountButton />}
        {!loading && errorMessage && access?.status === 'no_workspace' && (
          <p>
            <a href="/pricing">Choose your intended plan again</a>
          </p>
        )}
        <a href="/help">Need help?</a>
        <AccessDiagnostics access={access} traceId={traceId} />
      </section>
    </OvenLoading>
  )
}
