import { useState } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { AdminCodeSignIn, AdminMfaSettings } from './admin-mfa'
import { AdminSmsSignIn, AdminSmsSettings } from './admin-sms'
import type { AdminMetadata } from '@/lib/platform-admin-types'
/** Reverification uses enrolled factors; security settings retain fresh-passkey enrollment guards. */
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
  async function prepare(method: 'phone' | 'device' = 'phone') {
    setBusy(true)
    setPrepared(null)
    setMessage('')
    try {
      const result = await request('action=mfa-options', {
        kind: 'authentication',
        method,
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
      setMessage(
        `${(e as Error).message} No verification completed. Retry with your phone or tablet, choose an enrolled code method, or follow the recovery instructions below.`,
      )
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
          <p>
            No desktop passkey is needed. Use an enrolled authenticator code,
            recovery code, text message, or a passkey held on your phone or
            tablet. For a phone passkey, choose “Use a phone or tablet” in the
            browser; compatible devices need Bluetooth enabled and must be
            nearby. If the chooser offers only a USB key, cancel it and try
            current Chrome or Edge with “Use a phone or tablet”, or choose a
            code method below.
          </p>
          {session.credentials?.length > 0 && (
            <div className="button-row">
              <button disabled={busy} onClick={() => prepare()}>
                Prepare phone passkey verification
              </button>
              <button disabled={busy} onClick={() => prepare('device')}>
                Prepare existing passkey on this device
              </button>
              <button disabled={busy || !prepared} onClick={verify}>
                Use existing phone or tablet passkey
              </button>
            </div>
          )}
          {session.totpEnabled && session.totpAvailable && (
            <AdminCodeSignIn
              request={request}
              onSuccess={() => window.location.reload()}
            />
          )}
          {session.smsEnabled && session.smsAvailable && (
            <AdminSmsSignIn
              masked={session.smsMasked}
              request={request}
              onSuccess={() => window.location.reload()}
              onUsePasskey={() => prepare()}
            />
          )}
          {session.mfaMethod && (
            <>
              <AdminMfaSettings
                enabled={!!session.totpEnabled}
                available={!!session.totpAvailable}
                request={request}
                onChange={check}
              />
              <AdminSmsSettings
                enabled={!!session.smsEnabled}
                masked={session.smsMasked || null}
                available={!!session.smsAvailable}
                method={session.mfaMethod}
                request={request}
                onChange={check}
              />
            </>
          )}
          <p>
            If the browser cannot use your phone passkey and no code method is
            enrolled, open this admin site on your phone, verify its existing
            passkey, and set up an authenticator app under Admin sign-in
            security when server setup is available. Then return here and choose
            Check enrolled verification methods. If no enrolled device is
            accessible, use owner-verified recovery.
          </p>
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
