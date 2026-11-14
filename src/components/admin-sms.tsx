import { useEffect, useState, type FormEvent } from 'react'
type Request = (query: string, body?: unknown) => Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Sent = { expiresAt: string; resendAt: string; resendsRemaining?: number }
const codeError = (e: unknown) => (e as { code?: string })?.code || ''
const digits = (value: string) => value.replace(/\D/g, '').slice(0, 10)
const time = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

/**
 * Second factor after a verified password. Uses only explicitly requested code delivery.
 */
export function AdminSmsSignIn({
  masked,
  request,
  onSuccess,
  onUseAnotherMethod,
}: {
  masked: string
  request: Request
  onSuccess: () => void
  onUseAnotherMethod: () => void
}) {
  const [sent, setSent] = useState<Sent | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const now = useNow(!!sent)
  const wait = sent ? Math.ceil((Date.parse(sent.resendAt) - now) / 1000) : 0
  const expired = !!sent && Date.parse(sent.expiresAt) <= now
  async function send() {
    if (busy) return
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const result = await request('action=sms-send', {})
      setSent(result)
      setCode('')
      setStatus(
        `Text requested to ${result.masked}. The provider accepted the request; delivery usually takes under a minute but is not guaranteed. Only the newest code works.`,
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function verify(event: FormEvent) {
    event.preventDefault()
    if (busy || !code) return
    setBusy(true)
    setError('')
    try {
      await request('action=sms-verify', { code })
      setCode('')
      onSuccess()
    } catch (e) {
      setError((e as Error).message)
      setCode('')
      if (['SMS_EXPIRED', 'SMS_EXHAUSTED'].includes(codeError(e)))
        setSent((value) =>
          value ? { ...value, expiresAt: new Date(0).toISOString() } : value,
        )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Text-message sign-in">
      <h2>Sign in with password + text-message code</h2>
      <p>
        Your password is verified. We text a code only to the phone already
        enrolled from your authenticated admin session:{' '}
        <strong>{masked}</strong>. Codes are sent only when requested.
      </p>
      {status && <p role="status">{status}</p>}
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {!sent ? (
        <button className="admin-primary" disabled={busy} onClick={send}>
          {busy ? 'Requesting text…' : 'Text me a code'}
        </button>
      ) : (
        <form onSubmit={verify}>
          <label>
            Verification code
            <input
              required
              name="one-time-code"
              value={code}
              onChange={(e) => setCode(digits(e.target.value))}
              onPaste={(e) => {
                e.preventDefault()
                setCode(digits(e.clipboardData.getData('text')))
              }}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="\d{4,10}"
              maxLength={10}
              disabled={expired}
            />
          </label>
          <small>
            {expired
              ? 'This code is no longer valid. Request a new text.'
              : `Code expires at ${time(sent.expiresAt)} (within 5 minutes) or when a newer text is sent.`}
          </small>
          <button className="admin-primary" disabled={busy || expired || !code}>
            {busy ? 'Checking code…' : 'Verify code'}
          </button>
          <button
            type="button"
            className="admin-secondary"
            disabled={busy || wait > 0 || sent.resendsRemaining === 0}
            onClick={send}
          >
            {sent.resendsRemaining === 0
              ? 'Resend limit reached'
              : wait > 0
                ? `Resend code in ${wait}s`
                : 'Resend code'}
          </button>
        </form>
      )}
      <button
        type="button"
        className="admin-text-button"
        onClick={onUseAnotherMethod}
      >
        Use another verification method
      </button>
      <details>
        <summary>Text not arriving or phone lost?</summary>
        <p>
          Wait a minute and use Resend. Check that the phone has signal and can
          receive texts from short codes. If texts keep failing, use your
          password confirmation or enrolled authenticator / recovery code
          instead. Failed texts never skip verification. If you lost the phone
          and cannot use another method, contact the platform owner for audited,
          identity-verified recovery; the number can only be replaced from an
          authenticated session with recent verification.
        </p>
      </details>
    </section>
  )
}

export function AdminSmsSettings({
  enabled,
  masked,
  available,
  request,
  onChange,
}: {
  enabled: boolean
  masked: string | null
  available: boolean
  request: Request
  onChange: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [setup, setSetup] = useState(false)
  const [phone, setPhone] = useState('')
  const [sent, setSent] = useState<(Sent & { masked: string }) | null>(null)
  const [code, setCode] = useState('')
  const now = useNow(!!sent)
  const wait = sent ? Math.ceil((Date.parse(sent.resendAt) - now) / 1000) : 0
  async function prepare(purpose: 'sms-enroll' | 'sms-remove') {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      const result = await request('action=' + purpose, {})
      if (result.stage === 'sms_setup') setSetup(true)
      else if (result.stage === 'sms_removed') {
        setMessage(
          'Text-message sign-in removed. Other administrator sessions were signed out.',
        )
        onChange()
      }
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function sendCode(event?: FormEvent) {
    event?.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      const result = await request('action=sms-enroll-send', { phone })
      setSent(result)
      setCode('')
      setMessage(
        `Text requested to ${result.masked}. Enter the code to activate it. Nothing changes until the code is confirmed.`,
      )
    } catch (e) {
      setMessage((e as Error).message)
      if (codeError(e) === 'RECENT_AUTH_REQUIRED') reset()
    } finally {
      setBusy(false)
    }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      const result = await request('action=sms-enroll-confirm', { code })
      reset()
      setMessage(
        `Text-message sign-in is active for ${result.masked}. Other admin sessions were signed out. ${
          result.notification === 'sent'
            ? 'A security notice was emailed to your account address.'
            : 'Email notice is unavailable (outbound email is off); the change is recorded in the audit log.'
        }`,
      )
      onChange()
    } catch (e) {
      setMessage((e as Error).message)
      setCode('')
      if (codeError(e) === 'RECENT_AUTH_REQUIRED') reset()
    } finally {
      setBusy(false)
    }
  }
  function reset() {
    setSetup(false)
    setSent(null)
    setPhone('')
    setCode('')
  }
  async function cancel() {
    if (busy) return
    setBusy(true)
    try {
      await request('action=sms-enroll-cancel', {})
      reset()
      setMessage('Phone setup canceled. Existing methods are unchanged.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="admin-mfa-settings">
      <summary>Text-message sign-in</summary>
      <p>
        Status: {enabled ? `enabled for ${masked}` : 'not enrolled'}. Adding,
        changing or removing a phone requires recent administrator verification.
        Only US and Canadian (+1) mobile numbers are supported.
      </p>
      {message && <p role="status">{message}</p>}
      {sent ? (
        <form onSubmit={confirm}>
          <label>
            Code sent to {sent.masked}
            <input
              required
              value={code}
              onChange={(e) => setCode(digits(e.target.value))}
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={10}
            />
          </label>
          <small>Setup expires at {time(sent.expiresAt)}.</small>
          <button disabled={busy || !code}>Confirm and activate</button>
          <button
            type="button"
            disabled={busy || wait > 0}
            onClick={() => void sendCode()}
          >
            {wait > 0 ? `Resend in ${wait}s` : 'Resend code'}
          </button>
          <button type="button" disabled={busy} onClick={() => setSent(null)}>
            Use a different number
          </button>
          <button type="button" disabled={busy} onClick={cancel}>
            Cancel setup
          </button>
        </form>
      ) : setup ? (
        <form onSubmit={sendCode}>
          <label>
            Mobile number (US/Canada)
            <input
              required
              type="tel"
              autoComplete="tel-national"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={24}
            />
          </label>
          <small>
            We text a code to this number. It becomes your sign-in phone only
            after you enter that code here. Setup expires 10 minutes after your
            administrator verification.
          </small>
          <button disabled={busy}>Send verification text</button>
          <button type="button" disabled={busy} onClick={cancel}>
            Cancel setup
          </button>
        </form>
      ) : (
        <div>
          {!available && (
            <p>
              Text-message verification is not switched on yet (the SMS provider
              has not been configured). No texts can be sent. Password
              confirmation remains available.
            </p>
          )}
          <button
            disabled={busy || !available}
            onClick={() => prepare('sms-enroll')}
          >
            {enabled ? 'Change sign-in phone' : 'Set up text-message sign-in'}
          </button>
          {enabled && (
            <button disabled={busy} onClick={() => prepare('sms-remove')}>
              Remove text-message sign-in
            </button>
          )}
        </div>
      )}
    </details>
  )
}
