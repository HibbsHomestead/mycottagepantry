import { useState, type FormEvent } from 'react'
import { useAccountAccess } from '@/lib/account-access-client'
import {
  AccountAccessStatus,
  AccessDiagnostics,
  SignOutAccountButton,
} from './account-access-status'
import { PublicSite } from './public-site'
import './registration.css'
export function VerificationPage({ recovery = false }: { recovery?: boolean }) {
  return recovery ? <VerificationContent recovery /> : <VerificationAccount />
}
function VerificationAccount() {
  const account = useAccountAccess('verify-email')
  if (
    account.loading ||
    account.error ||
    !account.access ||
    account.access.status !== 'email_unverified'
  )
    return <AccountAccessStatus {...account} />
  return (
    <VerificationContent
      recovery={false}
      actions={
        <>
          <p>
            Your session is recognized, but the provider has not confirmed this
            account’s email. Logging in again with the same account does not
            verify it.
          </p>
          <button className="public-button" onClick={account.retry}>
            Check account status
          </button>
          <SignOutAccountButton />
          <AccessDiagnostics
            access={account.access}
            traceId={account.traceId}
          />
        </>
      }
    />
  )
}
function VerificationContent({
  recovery,
  actions,
}: {
  recovery: boolean
  actions?: import('react').ReactNode
}) {
  return (
    <PublicSite>
      <section className="registration-shell">
        <div className="registration-paper">
          <p className="public-eyebrow">Your account, kept safe</p>
          <h1>{recovery ? 'Recover your account.' : 'Verify your email.'}</h1>
          <p>
            {recovery
              ? 'Enter your account email to request a link for choosing a new password.'
              : 'Verify your email using the provider confirmation link, then log in to continue business oven setup. Setup requires approved Terms and Privacy. Paid checkout is not yet available.'}
          </p>
          {recovery ? (
            <PasswordRecoveryRequest />
          ) : (
            <p className="registration-notice">
              Signup requests a confirmation email when required by the
              provider. This page does not send or resend it. No email has been
              requested from this page.
            </p>
          )}
          <p>
            Expired or already-used link? Return to login. A valid verification
            link can be opened in another browser; log in afterward to resume
            any setup saved to your account.
          </p>
          {actions}
          <div className="registration-actions">
            {recovery && (
              <a className="public-button" href="/login">
                Return to login
              </a>
            )}
            <a className="public-text-link" href="/help">
              Need help?
            </a>
          </div>
        </div>
      </section>
    </PublicSite>
  )
}
function PasswordRecoveryRequest() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const identity = await import('@netlify/identity')
      await identity.requestPasswordRecovery(email.trim().toLowerCase())
      setMessage(
        'If this address has an account, a password reset link has been sent. Check your inbox and spam folder.',
      )
    } catch {
      setError('The reset link could not be requested. Please try again later.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="registration-form" onSubmit={submit}>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <label>
        Email address
        <input
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <button className="public-button" disabled={busy}>
        {busy ? 'Sending reset link…' : 'Send reset link'}
      </button>
    </form>
  )
}
