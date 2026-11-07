import { useRef, useState, type FormEvent } from 'react'
import { registrationRequest } from '@/lib/registration-client'
import { useRegistrationPolicy } from '@/lib/registration-policy-client'
import { businessProfile } from '@/lib/registration'
import { PublicSite } from './public-site'
import { SignOutAccountButton } from './account-access-status'
import type { SignupSelection } from '@/lib/signup-plan'

export function FreeWorkspaceSetup({
  onCreated,
  selection,
  setupError,
  setupLoading,
  onRetrySetup,
}: {
  onCreated: () => void
  selection?: SignupSelection | null
  setupError?: string
  setupLoading?: boolean
  onRetrySetup?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [acceptedRevision, setAcceptedRevision] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [sessionError, setSessionError] = useState(false)
  const lock = useRef(false)
  const policies = useRegistrationPolicy()
  const policy = policies.policy
  const ready =
    !policies.loading && !policies.error && !setupError && !setupLoading
  const accepted = !!policy && acceptedRevision === policy.revision
  const consentRequired = !!policy
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current || (consentRequired && !accepted) || !ready) return
    const fields = new FormData(event.currentTarget)
    const profile = businessProfile.safeParse({
      name: String(fields.get('name')),
      country: String(fields.get('country')),
      timezone: String(fields.get('timezone')),
      currency: 'USD',
      measurements: String(fields.get('measurements')),
      phone: '',
      website: '',
      description: '',
      focus: '',
    })
    setFieldErrors({})
    if (!profile.success) {
      setFieldErrors(
        Object.fromEntries(
          profile.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.message,
          ]),
        ),
      )
      setError('Check the highlighted business details.')
      return
    }
    lock.current = true
    setBusy(true)
    setError('')
    setSessionError(false)
    try {
      await registrationRequest('free', {
        action: 'createFreeWorkspace',
        profile: profile.data,
        ...(policy
          ? { consent: { accepted: true, revision: policy.revision } }
          : {}),
      })
      onCreated()
    } catch (failure) {
      setError((failure as Error).message)
      const detail = failure as {
        code?: string
        status?: number
        fields?: Record<string, string>
      }
      if (detail.fields)
        setFieldErrors(
          Object.fromEntries(
            Object.entries(detail.fields).map(([key, value]) => [
              key.replace(/^profile\./, ''),
              value,
            ]),
          ),
        )
      setSessionError(
        detail.status === 401 || detail.code === 'EMAIL_UNVERIFIED',
      )
      if (['POLICY_CHANGED', 'POLICY_NOT_READY'].includes(detail.code || '')) {
        setAcceptedRevision('')
        policies.retry()
      }
    } finally {
      setBusy(false)
      lock.current = false
    }
  }
  return (
    <PublicSite>
      <section className="registration-shell">
        <div className="registration-paper">
          <h1>Create your business</h1>
          {selection && (
            <p className="registration-notice">
              Selected plan: {selection.name} — ${selection.monthlyUsd} USD per
              business, monthly.
              {selection.planId !== 'free' &&
                ' Your choice is saved. Paid activation is not yet available; no paid subscription exists.'}{' '}
              Current access: verified account only; no business is created yet.
            </p>
          )}
          <p>
            Your email is verified. Business setup uses the currently
            implemented Free access rules; it does not activate a paid plan.
            Review <a href="/pricing">View Plans</a> for monthly pricing and
            proposed features. Paid checkout is not yet available. Business oven
            setup requires a verified email and valid business details. Proposed
            Free count limits and feature restrictions are not active.
          </p>
          {policies.loading && (
            <p role="status">Checking published Terms and Privacy…</p>
          )}
          {setupLoading && <p role="status">Checking your saved setup…</p>}
          {policies.error && <p role="alert">{policies.error}</p>}
          {setupError && (
            <p role="alert">
              {setupError}{' '}
              <button
                type="button"
                className="public-button secondary"
                onClick={onRetrySetup}
              >
                Retry setup check
              </button>
            </p>
          )}
          <button
            type="button"
            className="public-button secondary"
            disabled={busy || policies.loading}
            onClick={policies.retry}
          >
            Check published policies again
          </button>
          {error && <p role="alert">{error}</p>}
          {sessionError && (
            <p>
              Sign in or finish email verification in another tab, then retry
              here to keep these details.{' '}
              <a href="/login" target="_blank" rel="noopener noreferrer">
                Open sign-in
              </a>{' '}
              ·{' '}
              <a href="/verify-email" target="_blank" rel="noopener noreferrer">
                Verify email
              </a>
            </p>
          )}
          <form onSubmit={submit} className="registration-form">
            <label>
              Business/display name
              <input
                name="name"
                autoComplete="organization"
                minLength={2}
                maxLength={120}
                required
                disabled={busy}
                aria-invalid={!!fieldErrors.name}
                aria-describedby={
                  fieldErrors.name ? 'setup-name-error' : undefined
                }
              />
            </label>
            {fieldErrors.name && (
              <span id="setup-name-error" role="alert">
                Enter a business name of 2–120 characters.
              </span>
            )}
            <label>
              Country code
              <input
                name="country"
                defaultValue="US"
                pattern="[A-Z]{2}"
                maxLength={2}
                required
                disabled={busy}
                aria-invalid={!!fieldErrors.country}
                aria-describedby={
                  fieldErrors.country ? 'setup-country-error' : undefined
                }
              />
            </label>
            {fieldErrors.country && (
              <span id="setup-country-error" role="alert">
                Enter a two-letter uppercase country code, such as US.
              </span>
            )}
            <label>
              Timezone
              <input
                name="timezone"
                defaultValue={
                  Intl.DateTimeFormat().resolvedOptions().timeZone ||
                  'America/Chicago'
                }
                required
                disabled={busy}
                aria-invalid={!!fieldErrors.timezone}
                aria-describedby={
                  fieldErrors.timezone ? 'setup-timezone-error' : undefined
                }
              />
            </label>
            {fieldErrors.timezone && (
              <span id="setup-timezone-error" role="alert">
                Choose a valid timezone, such as America/Chicago.
              </span>
            )}
            <label>
              Preferred measurement display
              <select name="measurements" disabled={busy}>
                <option value="us">US customary</option>
                <option value="metric">Metric</option>
              </select>
            </label>
            <p>Currency: USD. You can update business details in Settings.</p>
            {policy && !policies.error && (
              <>
                <details>
                  <summary>Read Terms · {policy.revision}</summary>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{policy.terms}</p>
                </details>
                <details>
                  <summary>Read Privacy · {policy.revision}</summary>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{policy.privacy}</p>
                </details>
                <label className="registration-checkbox">
                  <span>
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(event) =>
                        setAcceptedRevision(
                          event.target.checked ? policy.revision : '',
                        )
                      }
                      disabled={busy || !ready}
                      required
                    />{' '}
                    I agree to the Terms and acknowledge the Privacy policy
                    shown above.
                  </span>
                </label>
              </>
            )}
            {ready && consentRequired && !accepted && (
              <p role="status">
                Review the documents and check the agreement above to enable
                business creation.
              </p>
            )}
            <button
              className="public-button"
              type="submit"
              disabled={busy || !ready || (consentRequired && !accepted)}
            >
              {busy ? 'Creating oven…' : 'Create your business'}
            </button>
          </form>
          <SignOutAccountButton />
        </div>
      </section>
    </PublicSite>
  )
}
