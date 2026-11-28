import { FormErrorNotice } from './form-error-notice'
import { useState } from 'react'
import type { AccountAccess } from '@/lib/access-state'
import { OvenLoading } from './oven-loading'
import { signOutIdentity } from '@/lib/identity-session'

export function SignOutAccountButton() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function signOut() {
    setBusy(true)
    setError('')
    try {
      await signOutIdentity()
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
      {error && <FormErrorNotice message={error} />}
    </>
  )
}

export function AccessDiagnostics({
  traceId,
}: {
  access?: AccountAccess | null
  traceId: string
  events?: { stage: string; result: string }[]
}) {
  return traceId ? (
    <a href={'/support?reference=' + encodeURIComponent(traceId)}>
      Contact support
    </a>
  ) : null
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
            <a href="/pricing">Choose your plan again</a>
          </p>
        )}
        <a href="/help">Need help?</a>
        <AccessDiagnostics access={access} traceId={traceId} />
      </section>
    </OvenLoading>
  )
}
