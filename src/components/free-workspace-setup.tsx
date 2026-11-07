import { useState, type FormEvent } from 'react'
import { registrationRequest } from '@/lib/registration-client'
import {
  freeRegistrationPolicy,
  freeRegistrationPolicyReady,
} from '@/lib/free-registration-policy'
import { PublicSite } from './public-site'
import { SignOutAccountButton } from './account-access-status'
import type { SignupSelection } from '@/lib/signup-plan'

export function FreeWorkspaceSetup({
  onCreated,
  selection,
}: {
  onCreated: () => void
  selection?: SignupSelection | null
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)
  const ready = freeRegistrationPolicyReady()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !accepted || !ready) return
    const fields = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      await registrationRequest('free', {
        action: 'createFreeWorkspace',
        profile: {
          name: String(fields.get('name')),
          country: String(fields.get('country')),
          timezone: String(fields.get('timezone')),
          currency: 'USD',
          measurements: String(fields.get('measurements')),
          phone: '',
          website: '',
          description: '',
          focus: '',
        },
        consent: { accepted: true, revision: freeRegistrationPolicy.revision },
      })
      onCreated()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
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
            setup requires approved Terms and Privacy. Proposed Free count
            limits and feature restrictions are not active.
          </p>
          {!ready && (
            <p role="status" className="registration-notice">
              The owner needs to publish approved Terms and Privacy content
              before oven creation can open. Your account remains intact; no
              oven or subscription has been created.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
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
              />
            </label>
            <label>
              Country code
              <input
                name="country"
                defaultValue="US"
                pattern="[A-Z]{2}"
                maxLength={2}
                required
                disabled={busy}
              />
            </label>
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
              />
            </label>
            <label>
              Preferred measurement display
              <select name="measurements" disabled={busy}>
                <option value="us">US customary</option>
                <option value="metric">Metric</option>
              </select>
            </label>
            <p>Currency: USD. You can update business details in Settings.</p>
            {ready && (
              <>
                <details>
                  <summary>
                    Read Terms · {freeRegistrationPolicy.revision}
                  </summary>
                  <p style={{ whiteSpace: 'pre-wrap' }}>
                    {freeRegistrationPolicy.terms}
                  </p>
                </details>
                <details>
                  <summary>
                    Read Privacy · {freeRegistrationPolicy.revision}
                  </summary>
                  <p style={{ whiteSpace: 'pre-wrap' }}>
                    {freeRegistrationPolicy.privacy}
                  </p>
                </details>
                <label className="registration-checkbox">
                  <span>
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(event) => setAccepted(event.target.checked)}
                      disabled={busy}
                      required
                    />{' '}
                    I agree to the Terms and acknowledge the Privacy policy
                    shown above.
                  </span>
                </label>
              </>
            )}
            <button
              className="public-button"
              type="submit"
              disabled={busy || !ready || !accepted}
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
