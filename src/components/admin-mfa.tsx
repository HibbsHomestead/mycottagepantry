import { useEffect, useState, type FormEvent } from 'react'
import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import QRCode from 'qrcode'

type Request = (query: string, body?: unknown) => Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any

export function AdminCodeSignIn({
  request,
  onSuccess,
}: {
  request: Request
  onSuccess: () => void
}) {
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await request('action=' + (recovery ? 'totp-recover' : 'totp-verify'), {
        code: code.trim(),
      })
      setCode('')
      onSuccess()
    } catch (e) {
      setError((e as Error).message)
      setCode('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Authenticator sign-in">
      <h2>Sign in with password + authenticator code</h2>
      <p>
        Your password is verified. Enter the code from the authenticator app
        enrolled through your phone admin session. No USB key is needed for this
        method.
      </p>
      <form onSubmit={submit}>
        <label>
          {recovery ? 'Single-use recovery code' : 'Authenticator code'}
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode={recovery ? 'text' : 'numeric'}
            maxLength={recovery ? 39 : 6}
          />
        </label>
        {error && (
          <p role="alert" className="admin-error">
            {error}
          </p>
        )}
        <button className="admin-primary" disabled={busy}>
          {busy
            ? 'Checking code…'
            : recovery
              ? 'Use recovery code'
              : 'Verify authenticator code'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setRecovery(!recovery)
            setCode('')
            setError('')
          }}
        >
          {recovery ? 'Use authenticator app' : 'Use a recovery code'}
        </button>
      </form>
      <p>
        Recovery codes work once with your password. They do not remove or
        replace your phone passkey.
      </p>
    </section>
  )
}

type Purpose = 'totp-enroll' | 'totp-remove' | 'totp-recovery'
type Prepared = {
  options: PublicKeyCredentialRequestOptionsJSON
  expiresAt: string
  purpose: Purpose
}
export function AdminMfaSettings({
  enabled,
  available,
  request,
  onChange,
}: {
  enabled: boolean
  available: boolean
  request: Request
  onChange: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(
    null,
  )
  const [qr, setQr] = useState('')
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  useEffect(() => {
    let active = true
    if (setup)
      void QRCode.toDataURL(setup.uri, { width: 220, margin: 2 })
        .then((url) => {
          if (active) setQr(url)
        })
        .catch(() => {
          if (active)
            setMessage(
              'QR display is unavailable. Enter the setup key manually in your authenticator app.',
            )
        })
    return () => {
      active = false
    }
  }, [setup])
  async function prepare(purpose: Purpose) {
    if (busy) return
    setBusy(true)
    setMessage('')
    setPrepared(null)
    try {
      const result = await request('action=mfa-options', {
        kind: 'authentication',
        method: 'device',
        purpose,
      })
      setPrepared({ ...result, purpose })
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function verify() {
    if (busy || !prepared) return
    if (Date.parse(prepared.expiresAt) <= Date.now()) {
      setPrepared(null)
      setMessage('Verification expired. Prepare a fresh passkey request.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      // Direct gesture: no network await before the existing-passkey ceremony.
      const assertion = await startAuthentication({
        optionsJSON: prepared.options,
      })
      const result = await request('action=mfa-verify', assertion)
      if (result.stage === 'totp_setup') {
        setSetup({ secret: result.secret, uri: result.uri })
        setQr('')
      } else if (result.stage === 'recovery_codes')
        setCodes(result.recoveryCodes)
      else if (result.stage === 'totp_removed') {
        setMessage(
          'Authenticator codes removed. Your phone passkey is preserved. Other admin sessions were signed out.',
        )
        onChange()
      } else throw new Error('Fresh passkey verification did not complete.')
    } catch {
      setMessage(
        'Passkey verification was canceled or failed. The pending request cleared. Prepare verification again; your existing methods remain unchanged.',
      )
    } finally {
      setBusy(false)
      setPrepared(null)
    }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      const result = await request('action=totp-confirm', { code: code.trim() })
      setSetup(null)
      setQr('')
      setCode('')
      setCodes(result.recoveryCodes)
      onChange()
    } catch (e) {
      setMessage((e as Error).message)
      setCode('')
    } finally {
      setBusy(false)
    }
  }
  async function cancel() {
    if (busy) return
    setBusy(true)
    try {
      await request('action=totp-cancel', {})
      setSetup(null)
      setQr('')
      setCode('')
      setPrepared(null)
      setMessage('Setup canceled. Existing methods are unchanged.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="admin-mfa-settings">
      <summary>Admin sign-in security</summary>
      <p>
        Phone passkey: preserved. Authenticator codes:{' '}
        {enabled ? 'enabled' : 'not enrolled'}.
      </p>
      <p>
        Authenticator codes are not phishing-resistant like passkeys. Set up
        this alternative here on your authenticated phone using a fresh
        verification with your existing phone passkey. No enrollment reset is
        needed.
      </p>
      {message && <p role="status">{message}</p>}
      {codes.length > 0 ? (
        <section aria-label="Save recovery codes">
          <h3>Save your single-use recovery codes now</h3>
          <p>
            Store these offline in a safe place. Each code works once with your
            password. Anyone with both can access admin. These codes are shown
            only in this response; generating new codes invalidates the previous
            set.
          </p>
          <ul>
            {codes.map((value) => (
              <li key={value}>
                <code>{value}</code>
              </li>
            ))}
          </ul>
          <button
            onClick={() => {
              setCodes([])
              setMessage(
                'Recovery codes hidden. To generate replacements, verify your phone passkey again.',
              )
            }}
          >
            I saved my recovery codes
          </button>
        </section>
      ) : setup ? (
        <form onSubmit={confirm}>
          <h3>Connect your authenticator app</h3>
          <p>
            Setup expires in five minutes. Scan this QR with your authenticator
            app on another device, or enter this key manually on this phone. Do
            not share it. Codes are inactive until confirmed.
          </p>
          {qr && (
            <img
              width={220}
              height={220}
              src={qr}
              alt="Authenticator enrollment QR code"
            />
          )}
          <p>
            Setup key: <code>{setup.secret}</code>
          </p>
          <label>
            First authenticator code
            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button disabled={busy}>
            Confirm and enable authenticator codes
          </button>
          <button type="button" disabled={busy} onClick={cancel}>
            Cancel setup
          </button>
        </form>
      ) : prepared ? (
        <div>
          <p>
            {prepared.purpose === 'totp-remove'
              ? 'Remove authenticator codes and their recovery codes; keep the phone passkey. Other admin sessions will be signed out.'
              : prepared.purpose === 'totp-recovery'
                ? 'Generate new recovery codes; previous recovery codes will stop working.'
                : 'Authorize authenticator enrollment using your existing phone passkey.'}
          </p>
          <button disabled={busy} onClick={verify}>
            {busy ? 'Verifying…' : 'Verify existing phone passkey'}
          </button>
          <button disabled={busy} onClick={() => setPrepared(null)}>
            Cancel
          </button>
        </div>
      ) : (
        <div>
          {!available && (
            <p>
              Authenticator setup is unavailable until server encryption is
              configured. Your existing phone passkey still works.
            </p>
          )}
          {!enabled ? (
            <button
              disabled={busy || !available}
              onClick={() => prepare('totp-enroll')}
            >
              Set up authenticator app
            </button>
          ) : (
            <>
              <button disabled={busy} onClick={() => prepare('totp-recovery')}>
                Prepare recovery code replacement
              </button>
              <button disabled={busy} onClick={() => prepare('totp-remove')}>
                Prepare authenticator removal
              </button>
            </>
          )}
        </div>
      )}
    </details>
  )
}
