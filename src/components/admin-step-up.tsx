import { useState } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { AdminCodeSignIn } from './admin-mfa'
import { AdminSmsSignIn } from './admin-sms'
import type { AdminMetadata } from '@/lib/platform-admin-types'
/** Reuses enrolled platform factors and session rotation; never enrolls a new factor. */
export function AdminStepUp({
  request,
}: {
  request: (query: string, body?: unknown) => Promise<AdminMetadata>
}) {
  const [session, setSession] = useState<AdminMetadata | null>(null),
    [prepared, setPrepared] = useState<{
      options: PublicKeyCredentialRequestOptionsJSON
      expiresAt: string
    } | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  async function check() {
    setBusy(true)
    try {
      setSession(await request('action=session'))
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function prepare() {
    setBusy(true)
    try {
      const result = await request('action=mfa-options', {
        kind: 'authentication',
        method: 'device',
      })
      setPrepared({ options: result.options, expiresAt: result.expiresAt })
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function verify() {
    if (!prepared) return
    if (Date.parse(prepared.expiresAt) <= Date.now()) {
      setPrepared(null)
      setMessage('Verification challenge expired. Prepare a new challenge.')
      return
    }
    setBusy(true)
    try {
      const response = await startAuthentication({
        optionsJSON: prepared.options,
      })
      await request('action=mfa-verify', response)
      window.location.reload()
    } catch (e) {
      setMessage((e as Error).message)
      setPrepared(null)
    } finally {
      setBusy(false)
    }
  }
  return (
    <details>
      <summary>
        Verify existing admin authentication for sensitive actions
      </summary>
      <p>
        Stripe credential changes and membership updates use the existing
        enrolled platform authentication. Verify before entering secrets.
        Verification reloads this page and clears unsaved inputs.
      </p>
      <button disabled={busy} onClick={check}>
        Check enrolled verification methods
      </button>
      {session && (
        <>
          <p>
            {session.mfaMethod
              ? `Current verification: ${session.mfaMethod}`
              : 'Password verified; additional verification is required for sensitive changes.'}
          </p>
          {session.credentials?.length > 0 && (
            <div className="button-row">
              <button disabled={busy} onClick={prepare}>
                Prepare passkey verification
              </button>
              <button disabled={busy || !prepared} onClick={verify}>
                Verify with enrolled passkey
              </button>
            </div>
          )}
          {session.totpEnabled && (
            <AdminCodeSignIn
              request={request}
              onSuccess={() => window.location.reload()}
            />
          )}
          {session.smsEnabled && !session.mfaMethod && (
            <AdminSmsSignIn
              masked={session.smsMasked}
              request={request}
              onSuccess={() => window.location.reload()}
              onUsePasskey={prepare}
            />
          )}
          {!session.credentials?.length &&
            !session.totpEnabled &&
            !session.smsEnabled && (
              <p>
                No enrolled method is available. Existing owner-verified
                enrollment/recovery is required; this screen cannot bypass it or
                create a replacement factor.
              </p>
            )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  )
}
