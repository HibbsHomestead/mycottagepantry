import { useAccountAccess } from '@/lib/account-access-client'
import {
  AccountAccessStatus,
  SignOutAccountButton,
} from './account-access-status'
import { useEffect, useState, type FormEvent } from 'react'
import { PublicSite } from './public-site'
import { registrationRequest } from '@/lib/registration-client'
import { checklistSteps, signupSteps } from '@/lib/registration'
import { signupPlan } from '@/lib/signup-plan'
import { FreeWorkspaceSetup } from './free-workspace-setup'
import { resumeSelectedPlan } from '@/lib/signup-plan-client'
import type { SignupSelection } from '@/lib/signup-plan'
import './registration.css'

export function OnboardingPage() {
  const account = useAccountAccess('onboarding')
  const [access, setAccess] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [plan, setPlan] = useState('free')
  const [selection, setSelection] = useState<SignupSelection | null>(null)
  const [profile, setProfile] = useState<Record<string, string>>({
    name: '',
    country: 'US',
    timezone: 'America/Chicago',
    currency: 'USD',
    measurements: 'us',
    phone: '',
    website: '',
    description: '',
    focus: '',
  })
  const [marketing, setMarketing] = useState(false)
  const [fixture, setFixture] = useState(false)
  const [completed, setCompleted] = useState<string[]>([])
  useEffect(() => {
    let active = true
    if (
      account.loading ||
      account.error ||
      account.access?.status !== 'no_workspace'
    )
      return
    setLoading(true)
    const setup = account.access.privateTest
      ? registrationRequest().then(async (result) => ({
          ...result,
          selection: await resumeSelectedPlan(),
        }))
      : resumeSelectedPlan().then((selection) => ({
          privateTest: false,
          selection,
        }))
    setup
      .then((result) => {
        if (!active || !result) return
        setAccess(result)
        if ('selection' in result) setSelection(result.selection)
        if (result.draft?.profile?.name) setProfile(result.draft.profile)
        else
          setProfile((old) => ({
            ...old,
            timezone:
              Intl.DateTimeFormat().resolvedOptions().timeZone || old.timezone,
          }))
        setPlan(
          result.selection?.planId ||
            result.draft?.plan_id ||
            signupPlan(
              new URLSearchParams(location.search).get('plan') ?? 'free',
            ),
        )
        setMarketing(result.draft?.marketing_consent || false)
        setCompleted(result.draft?.checklist || [])
      })
      .catch(() => {
        if (active)
          setError(
            'Your saved setup could not be checked. Please retry; no oven was created.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [account.loading, account.error, account.access])
  const change = (key: string, value: string) =>
    setProfile((old) => ({ ...old, [key]: value }))
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await registrationRequest('', {
        action: 'saveDraft',
        planId: plan,
        profile,
        marketingConsent: marketing,
      })
      setAccess(result)
      setMessage(
        'Your private test draft is saved. Activation remains separate.',
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function activate() {
    if (!fixture || busy) return
    setBusy(true)
    setError('')
    try {
      await registrationRequest('', {
        action: 'acceptFixture',
        version: 'fixture:registration-v1',
        accepted: true,
      })
      const result = await registrationRequest('', { action: 'provisionTest' })
      setMessage(
        result.existing
          ? 'Your existing oven is preserved. No duplicate business was created.'
          : result.message,
      )
      account.retry()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function checklist(id: string) {
    if (busy) return
    const next = completed.includes(id)
      ? completed.filter((v) => v !== id)
      : [...completed, id]
    setBusy(true)
    setError('')
    try {
      await registrationRequest('', { action: 'checklist', completed: next })
      setCompleted(next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (
    account.loading ||
    account.error ||
    !account.access ||
    account.access.status !== 'no_workspace'
  )
    return <AccountAccessStatus {...account} />
  if (loading) return <AccountAccessStatus {...account} loading />
  if (!account.access.privateTest)
    return (
      <FreeWorkspaceSetup onCreated={account.retry} selection={selection} />
    )
  return (
    <PublicSite>
      <section className="registration-shell">
        <ol className="registration-steps" aria-label="Registration steps">
          {signupSteps.map((s, i) => (
            <li key={s} aria-current={i === 3 ? 'step' : undefined}>
              <span>{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <div className="registration-paper">
          <p className="public-eyebrow">Your business, in good order</p>
          <h1>Let’s make room for your business.</h1>
          <p className="registration-lead">
            Tell us a little about your business. You can update these details
            later.
          </p>
          {loading && (
            <p role="status">Checking your account and saved setup…</p>
          )}
          {error && (
            <p role="alert" className="registration-notice">
              {error}
              <button
                className="public-button secondary"
                type="button"
                onClick={() => window.location.reload()}
              >
                Retry access check
              </button>
            </p>
          )}
          {message && (
            <p role="status" className="registration-notice">
              {message}
            </p>
          )}
          {!loading && !error && !access?.privateTest && (
            <>
              <p>
                Your identity is verified, but no active oven membership was
                found. Public policy acceptance and account activation are
                blocked. Private testing is restricted to authorized existing
                administrators in a test deployment.
              </p>
              <SignOutAccountButton />
            </>
          )}
          {access?.privateTest && (
            <>
              <p className="registration-notice">
                Private development only. No production legal acceptance, live
                subscription or real charge is created here.
              </p>
              {selection && (
                <p>
                  Selected plan: {selection.name} — ${selection.monthlyUsd} USD
                  monthly per business. This is a saved preference; this
                  development fixture grants no paid access.
                </p>
              )}
              {access.membership && (
                <p>
                  You already belong to{' '}
                  <strong>{access.membership.name}</strong>. Setup never creates
                  a duplicate oven. <a href="/oven">Open oven</a>.
                </p>
              )}
              <form onSubmit={save} className="registration-form">
                <label>
                  Business/display name
                  <input
                    required
                    name="businessName"
                    autoComplete="organization"
                    maxLength={120}
                    minLength={2}
                    value={profile.name}
                    onChange={(e) => change('name', e.target.value)}
                  />
                </label>
                <div className="registration-grid">
                  <label>
                    Country/region
                    <select
                      value={profile.country}
                      onChange={(e) => change('country', e.target.value)}
                    >
                      {Object.entries({
                        US: 'United States',
                        CA: 'Canada',
                        GB: 'United Kingdom',
                        AU: 'Australia',
                        NZ: 'New Zealand',
                        IE: 'Ireland',
                        DE: 'Germany',
                        FR: 'France',
                      }).map(([code, name]) => (
                        <option key={code} value={code}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Timezone
                    <input
                      required
                      list="registration-timezones"
                      value={profile.timezone}
                      onChange={(e) => change('timezone', e.target.value)}
                    />
                    <datalist id="registration-timezones">
                      {[
                        'America/New_York',
                        'America/Chicago',
                        'America/Denver',
                        'America/Los_Angeles',
                        'Europe/London',
                        'Australia/Sydney',
                        'Pacific/Auckland',
                        'UTC',
                      ].map((zone) => (
                        <option key={zone} value={zone} />
                      ))}
                    </datalist>
                  </label>
                </div>
                <div className="registration-grid">
                  <label>
                    Business currency
                    <select
                      value={profile.currency}
                      onChange={(e) => change('currency', e.target.value)}
                    >
                      <option value="USD">USD — US dollars</option>
                    </select>
                  </label>
                  <label>
                    Preferred measurement display
                    <select
                      value={profile.measurements}
                      onChange={(e) => change('measurements', e.target.value)}
                    >
                      <option value="us">US customary</option>
                      <option value="metric">Metric</option>
                    </select>
                  </label>
                </div>
                <p className="registration-help">
                  Reporting and initial checkout support USD only. Display
                  preferences do not convert saved quantities or verified
                  conversions. Currency cannot silently relabel existing
                  transactions.
                </p>
                <div className="registration-grid">
                  <label>
                    Owner phone (optional)
                    <input
                      type="tel"
                      autoComplete="tel"
                      value={profile.phone}
                      onChange={(e) => change('phone', e.target.value)}
                      maxLength={40}
                    />
                  </label>
                  <label>
                    Website or social link (optional)
                    <input
                      type="url"
                      autoComplete="url"
                      value={profile.website}
                      onChange={(e) => change('website', e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  Short business description (optional)
                  <textarea
                    value={profile.description}
                    maxLength={600}
                    onChange={(e) => change('description', e.target.value)}
                  />
                </label>
                <label>
                  Business focus (optional)
                  <select
                    value={profile.focus}
                    onChange={(e) => change('focus', e.target.value)}
                  >
                    <option value="">Choose later</option>
                    <option value="baked">Baked goods</option>
                    <option value="cottage-food">Other cottage foods</option>
                    <option value="handmade">Handmade goods</option>
                    <option value="mixed">Mixed business</option>
                  </select>
                </label>
                {['handmade', 'mixed'].includes(profile.focus) && (
                  <p className="registration-notice">
                    Specialized handmade-materials and production workflows are
                    not implemented. Basic product flexibility does not include
                    those tools. Your focus does not change plan access.
                  </p>
                )}
                <p className="registration-help">
                  Logo uploads are not connected to this private setup form. No
                  home address is required or publicly displayed by default.
                  This creates an app oven, not a legal entity, permit or
                  compliance certification.
                </p>
                <label className="registration-checkbox">
                  <span>
                    <input
                      type="checkbox"
                      checked={marketing}
                      onChange={(e) => setMarketing(e.target.checked)}
                    />{' '}
                    Optional product updates (test preference only)
                  </span>
                </label>
                <div className="registration-actions">
                  <button
                    className="public-button"
                    disabled={busy}
                    type="submit"
                  >
                    {busy ? 'Saving…' : 'Save test setup'}
                  </button>
                  <a className="public-text-link" href="/pricing">
                    Back to plans
                  </a>
                </div>
              </form>
              {access.draft && !access.membership && (
                <div>
                  <h2>Development acceptance fixture</h2>
                  <details>
                    <summary>Read fixture version registration-v1</summary>
                    <p>
                      This is test-only text for exercising consent storage, not
                      Terms of Service, Privacy Policy or subscription terms. It
                      provides no production legal acceptance and authorizes no
                      charges.
                    </p>
                  </details>
                  <label>
                    <input
                      type="checkbox"
                      checked={fixture}
                      onChange={(e) => setFixture(e.target.checked)}
                    />{' '}
                    I understand this is a development fixture only.
                  </label>
                  <div className="registration-actions">
                    <button
                      className="public-button"
                      disabled={
                        !fixture ||
                        busy ||
                        plan !== 'free' ||
                        plan !== access.draft.plan_id
                      }
                      onClick={activate}
                    >
                      Create empty Free test oven
                    </button>
                  </div>
                </div>
              )}
              {access.membership && access.draft && (
                <div>
                  <h2>A little order, one step at a time.</h2>
                  <p>Skip any step and return when you’re ready.</p>
                  <ul className="registration-checklist">
                    {checklistSteps.map(([id, label]) => (
                      <li key={id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={completed.includes(id)}
                            disabled={busy}
                            onChange={() => checklist(id)}
                          />{' '}
                          {label}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <a className="public-button" href="/oven">
                    Open oven
                  </a>
                </div>
              )}
            </>
          )}
          <div className="registration-actions">
            <a className="public-text-link" href="/help">
              Need help?
            </a>
          </div>
        </div>
      </section>
    </PublicSite>
  )
}
