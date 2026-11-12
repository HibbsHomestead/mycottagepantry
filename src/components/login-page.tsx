import { useRouter } from '@tanstack/react-router'
import { OvenLoading } from './oven-loading'
import { restoreIdentitySession } from '@/lib/identity-session'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { CallbackResult } from '@netlify/identity'
import { PublicSite } from './public-site'
import {
  readAccountAccess,
  accessTraceId,
  navigateAccount,
} from '@/lib/account-access-client'
import {
  accessDestination,
  hasIdentityCallback,
  type AccountAccess,
} from '@/lib/access-state'
import { AccessDiagnostics } from './account-access-status'
import { resumeSelectedPlan } from '@/lib/signup-plan-client'

export function LoginPage() {
  const router = useRouter({ warn: false })
  const submitting = useRef(false)
  const [opening, setOpening] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [recoveryComplete, setRecoveryComplete] = useState(false)
  const [ready, setReady] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [accessError, setAccessError] = useState(false)
  const reference = useRef('')
  const [traceId, setTraceId] = useState('')
  const sessionReported = useRef(false)
  const callback = useRef<Promise<CallbackResult | null> | null>(null)
  const [access, setAccess] = useState<AccountAccess | null>(null)
  const [events, setEvents] = useState<{ stage: string; result: string }[]>([])
  const record = useCallback((stage: string, result: string) => {
    setEvents((old) => [...old, { stage, result }])
    console.info(
      JSON.stringify({
        area: 'account_access',
        traceId: reference.current,
        stage,
        result,
      }),
    )
  }, [])
  const openWorkspace = useCallback(
    async (expectSession = sessionReported.current) => {
      sessionReported.current = expectSession
      setOpening(true)
      setAccessError(false)
      setError('')
      record('access_request', 'loading')
      try {
        const value = await readAccountAccess(reference.current)
        setAccess(value)
        const returnTo = new URLSearchParams(location.search).get('returnTo')
        let selection = null
        try {
          // A signup preference never participates in existing-business login.
          // Resolve it only for verified accounts that still need business setup.
          selection =
            value.status === 'no_workspace' ? await resumeSelectedPlan() : null
        } catch (failure) {
          setAccessError(true)
          setError((failure as Error).message)
          return
        }
        if (['workspace', 'workspace_selection'].includes(value.status))
          record('pending_plan', 'ignored_for_existing_membership')
        const destination = accessDestination(value, 'login', returnTo)
        if (destination) {
          record('redirect', new URL(destination, location.origin).pathname)
          navigateAccount(
            destination,
            reference.current,
            returnTo,
            selection?.planId,
            router
              ? (href) => {
                  void router.navigate({ href, replace: true })
                }
              : undefined,
          )
        } else if (value.status === 'signed_out') {
          setOpening(false)
          record(
            'browser_session',
            expectSession ? 'backend_session_missing' : 'signed_out_visit',
          )
          if (expectSession) {
            setAccessError(true)
            setError(
              'The browser reported a signed-in session, but the server could not verify it. Please log in again on this site.',
            )
          } else {
            setError('')
          }
        } else {
          setAccessError(true)
          setError(
            value.status === 'access_denied'
              ? 'Your oven membership is inactive. No oven was created.'
              : 'Your session or oven membership could not be checked. Please retry.',
          )
        }
      } catch {
        record('access_request', 'transport_error')
        setAccessError(true)
        setError(
          'Account access could not be checked. Retry without creating a new business.',
        )
      }
    },
    [record, router],
  )
  useEffect(() => {
    let active = true
    const originalHash = location.hash
    reference.current = accessTraceId()
    async function initialize() {
      try {
        const identity = await import('@netlify/identity')
        callback.current ??= identity.handleAuthCallback()
        const result = await callback.current
        if (!active) return
        setTraceId(reference.current)
        record('callback_completed', result?.type || 'none')
        if (result?.type === 'recovery') {
          setRecovery(true)
          setOpening(false)
          setMessage('Choose a new password to finish recovering your account.')
        } else if (result?.type === 'invite') {
          setOpening(false)
          setError(
            'Oven invitation acceptance is not available yet. Contact the owner; no oven access has been granted.',
          )
        } else {
          // SDK hydration starts refresh handling, but its cache is not an access decision.
          await restoreIdentitySession()
          const browserUser = result?.user || (await identity.getUser())
          if (!active) return
          record('browser_session', browserUser ? 'ready' : 'absent')
          await openWorkspace(Boolean(browserUser))
        }
      } catch {
        record('callback_completed', 'provider_error')
        if (location.hash === originalHash)
          history.replaceState(null, '', location.pathname + location.search)
        if (active) {
          setTraceId(reference.current)
          setOpening(false)
          if (!hasIdentityCallback(originalHash)) {
            setAccessError(true)
            setError(
              'Your session could not be restored right now. Retry without signing out.',
            )
            return
          }
          setError(
            'This sign-in link is invalid, expired, already used, or unavailable. Try logging in or review account recovery.',
          )
        }
      } finally {
        if (active) setReady(true)
      }
    }
    void initialize()
    return () => {
      active = false
    }
  }, [openWorkspace, record])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || busy || !ready) return
    submitting.current = true
    const form = event.currentTarget
    const fields = new FormData(form)
    setBusy(true)
    setError('')
    if (!reference.current) reference.current = accessTraceId()
    record('login_started', recovery ? 'recovery' : 'password')
    try {
      const identity = await import('@netlify/identity')
      if (recovery) {
        await identity.updateUser({ password: String(fields.get('password')) })
        await identity.logout().catch(() => {})
        form.reset()
        setRecovery(false)
        setRecoveryComplete(true)
        setMessage('Your password has been updated. Sign in to continue.')
        sessionReported.current = false
        return
      } else
        await identity.login(
          String(fields.get('email')),
          String(fields.get('password')),
        )
      setOpening(true)
      record('provider_result', 'success')
      record('browser_session', 'ready')
      await openWorkspace(true)
    } catch (failure) {
      const status = (failure as { status?: number }).status
      record(
        'provider_result',
        status === 400 || status === 401
          ? 'credentials_rejected'
          : 'provider_error',
      )
      setError(
        recovery
          ? 'The password could not be updated. The recovery link may have expired.'
          : 'We couldn’t sign you in. Check your email and password, or try again later.',
      )
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  if (opening || !ready || accessError)
    return (
      <OvenLoading
        error={accessError ? error : undefined}
        retry={() => void openWorkspace()}
      >
        {accessError && (
          <AccessDiagnostics
            access={access}
            traceId={traceId}
            events={events}
          />
        )}
      </OvenLoading>
    )
  return (
    <PublicSite>
      <section className="public-auth">
        <p className="public-eyebrow">Your business, in good order</p>
        <h1>{recovery ? 'Reset your password' : 'Welcome back.'}</h1>
        <p>
          {recovery
            ? 'Finish your existing provider recovery flow.'
            : 'Log in to your existing Cottage Pantry account.'}
        </p>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {typeof location !== 'undefined' &&
          new URLSearchParams(location.search).has('signedOut') && (
            <p role="status">You’re signed out.</p>
          )}
        {recoveryComplete && (
          <p>
            <a
              className="public-button"
              href="https://admin.mycottagepantry.com/admin"
            >
              Sign in to Cottage Pantry Admin
            </a>
          </p>
        )}
        {error && (
          <AccessDiagnostics
            access={access}
            traceId={traceId}
            events={events}
          />
        )}
        <form onSubmit={submit}>
          <fieldset disabled={busy || !ready}>
            <legend className="sr-only">
              {recovery ? 'New password' : 'Login details'}
            </legend>
            {!recovery && (
              <label>
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="username"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="next"
                  required
                />
              </label>
            )}
            <label>
              {recovery ? 'New password' : 'Password'}
              <input
                name="password"
                enterKeyHint="done"
                type={showPassword ? 'text' : 'password'}
                minLength={recovery ? 8 : undefined}
                autoComplete={recovery ? 'new-password' : 'current-password'}
                required
              />
            </label>
            <button
              className="public-text-link password-toggle"
              type="button"
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? 'Hide password' : 'Show password'}
            </button>
            <button className="public-button" type="submit">
              {!ready
                ? 'Checking session…'
                : busy
                  ? 'Please wait…'
                  : recovery
                    ? 'Save new password'
                    : 'Log in'}
            </button>
          </fieldset>
        </form>
        <p>
          <a className="public-text-link" href="/recover">
            Forgot your password?
          </a>
        </p>
        <p className="public-fine">
          New to Cottage Pantry?{' '}
          <a className="public-text-link" href="/signup">
            Get Started
          </a>
        </p>
        <a className="public-text-link" href="/help">
          Need help?
        </a>
      </section>
    </PublicSite>
  )
}
