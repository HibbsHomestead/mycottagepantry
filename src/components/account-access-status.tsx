import { useState } from 'react'
import type { AccountAccess } from '@/lib/access-state'
import { PublicSite } from './public-site'

export function SignOutAccountButton() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function signOut() {
    setBusy(true)
    setError('')
    try {
      const identity = await import('@netlify/identity')
      await identity.logout()
      window.location.replace('/login')
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
    <details>
      <summary>Access diagnostic reference: {traceId}</summary>
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
  const denied = access?.status === 'access_denied'
  return (
    <PublicSite>
      <section className="public-auth">
        <h1>
          {loading
            ? 'Checking account access…'
            : denied
              ? 'Oven access denied'
              : 'Account access unavailable'}
        </h1>
        <p role={loading ? 'status' : 'alert'}>
          {loading
            ? 'Waiting for your session and oven membership.'
            : denied
              ? 'Your oven membership is inactive. Contact your oven owner. No new oven was created.'
              : errorMessage ||
                'Your session or oven membership could not be checked. Retry without creating a new business.'}
        </p>
        {!loading &&
          ['workspace', 'workspace_selection'].includes(
            access?.status || '',
          ) && (
            <p>
              <a className="public-button" href="/oven">
                Open your existing business with its current access
              </a>
            </p>
          )}
        {!loading && (
          <button className="public-button" type="button" onClick={retry}>
            Retry access check
          </button>
        )}
        {!loading && <SignOutAccountButton />}
        {!loading && errorMessage && access?.status === 'no_workspace' && (
          <p>
            <a href="/pricing">Choose your intended plan again</a>
          </p>
        )}
        <a href="/help">Need help?</a>
        <AccessDiagnostics access={access} traceId={traceId} />
      </section>
    </PublicSite>
  )
}
