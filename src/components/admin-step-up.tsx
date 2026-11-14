import { useState, type FormEvent } from 'react'
import { AdminCodeSignIn, AdminMfaSettings } from './admin-mfa'
import type { AdminMetadata } from '@/lib/platform-admin-types'

export function AdminStepUp({
  request,
}: {
  request: (query: string, body?: unknown) => Promise<AdminMetadata>
}) {
  const [session, setSession] = useState<AdminMetadata | null>(null)
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function check() {
    setBusy(true)
    setMessage('')
    try {
      setSession(await request('action=session'))
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function verify(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      const result = await request('action=password-verify', { password })
      if (result.stage !== 'authenticated')
        throw new Error('Verification did not complete.')
      window.location.reload()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setPassword('')
      setBusy(false)
    }
  }
  return (
    <details>
      <summary>
        Verify existing admin authentication for sensitive actions
      </summary>
      <p>
        Verify before changing billing credentials, membership, or security
        settings. Verification lasts ten minutes. Successful verification
        reloads this page and clears unsaved inputs.
      </p>
      <button disabled={busy} onClick={check}>
        Check verification methods
      </button>
      {session && (
        <>
          <p>
            {session.verificationCurrent
              ? `Current verification: ${session.verificationMethod}`
              : 'Confirm your administrator authentication for sensitive changes.'}
          </p>
          {session.totpEnabled ? (
            <AdminCodeSignIn
              request={request}
              onSuccess={() => window.location.reload()}
            />
          ) : (
            <form onSubmit={verify}>
              <p>
                Confirm your account password. You can then set up an
                authenticator app and recovery codes below.
              </p>
              <label>
                Current administrator password
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  maxLength={256}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button disabled={busy}>
                {busy ? 'Checking password…' : 'Verify password'}
              </button>
            </form>
          )}
          <AdminMfaSettings
            enabled={!!session.totpEnabled}
            available={!!session.totpAvailable}
            request={request}
            onChange={check}
          />
          <p>
            If you need a new password, sign out and use Reset password. Follow
            the email link, set your password, then sign in and confirm it here.
            An enrolled authenticator still requires its code or a recovery
            code.
          </p>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  )
}
