import { useAccountAccess } from '@/lib/account-access-client'
import { AccountAccessStatus } from './account-access-status'
import { PublicSite } from './public-site'
import { signupSteps } from '@/lib/registration'
import { launchPricing, planUserLabel, type PlanId } from '@/lib/launch-plans'
import { signupPlan, signupPlanHref } from '@/lib/signup-plan'
import { signupPlanRequest } from '@/lib/signup-plan-client'
import { freeRegistrationPolicyReady } from '@/lib/free-registration-policy'
import { useSyncExternalStore, useState, type FormEvent } from 'react'
import './registration.css'

function subscribeToSearch(listener: () => void) {
  window.addEventListener('popstate', listener)
  return () => window.removeEventListener('popstate', listener)
}

export function SignupPage() {
  const account = useAccountAccess('signup')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const search = useSyncExternalStore(
    subscribeToSearch,
    () => location.search,
    () => '',
  )
  const [choice, setPlan] = useState<PlanId | null>(null)
  let plan = choice
  let invalidSelection = ''
  if (!plan) {
    try {
      plan = signupPlan(new URLSearchParams(search).get('plan') ?? 'free')
    } catch (failure) {
      invalidSelection = (failure as Error).message
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || submitted || !plan) return
    const fields = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const identity = await import('@netlify/identity')
      const intent = await signupPlanRequest({
        action: 'prepare',
        planId: plan,
      })
      if (!intent.intentId)
        throw new Error('Plan selection was not saved. Please retry.')
      const user = await identity.signup(
        String(fields.get('email')),
        String(fields.get('password')),
        { cottage_signup_intent: intent.intentId },
      )
      if (user.confirmedAt) account.retry()
      else setSubmitted(true)
    } catch (failure) {
      const status = (failure as { status?: number }).status
      setError(
        status === 400 || status === 409 || status === 422
          ? 'Account creation was not completed. If you already have an account, log in or recover it. Otherwise check your email and use a password of at least eight characters.'
          : 'Account creation is temporarily unavailable. Please try again; no oven or subscription was created.',
      )
    } finally {
      setBusy(false)
    }
  }
  if (
    account.loading ||
    account.error ||
    !account.access ||
    account.access.status !== 'signed_out'
  )
    return <AccountAccessStatus {...account} />
  return (
    <PublicSite>
      <section className="registration-shell" aria-labelledby="signup-title">
        <ol className="registration-steps" aria-label="Registration steps">
          {signupSteps.map((step, index) => (
            <li key={step} aria-current={index === 0 ? 'step' : undefined}>
              <span>{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        <div className="registration-paper">
          <p className="public-eyebrow">A little room for your business</p>
          <h1 id="signup-title">Get Started</h1>
          <p className="registration-lead">
            A thoughtful oven for the business behind your baking.
          </p>
          <p>
            Review <a href="/pricing">View Plans</a> for monthly pricing and
            intended feature scope. Your selected plan is a saved preference,
            not a subscription. You can create your account now. Paid activation
            is not yet available. Creating an account does not activate a paid
            plan or collect payment.
          </p>
          {!freeRegistrationPolicyReady() && (
            <p className="registration-notice">
              Account creation is open. Oven setup needs owner-approved Terms
              and Privacy content before you can complete it.
            </p>
          )}
          {(error || invalidSelection) && (
            <p role="alert">{error || invalidSelection}</p>
          )}
          {submitted ? (
            <div role="status">
              <h2>Check your email</h2>
              <p>
                The provider accepted the signup request. Follow its
                verification email, then log in here to continue. Delivery has
                not been independently confirmed.
              </p>
              <p>
                Your chosen plan is kept for when you return after verification.
              </p>
              <a href={plan ? signupPlanHref(plan, '/login') : '/login'}>
                Continue to login
              </a>
            </div>
          ) : (
            <form className="registration-form" onSubmit={submit}>
              <fieldset className="signup-plan-choice">
                <legend>Choose your intended plan</legend>
                {launchPricing.plans.map((p) => (
                  <label key={p.id} className="check-label">
                    <input
                      type="radio"
                      name="plan-choice"
                      value={p.id}
                      checked={plan === p.id}
                      disabled={busy}
                      onChange={() => {
                        setPlan(p.id)
                        setError('')
                        history.replaceState(null, '', signupPlanHref(p.id))
                      }}
                    />
                    <span>
                      {p.name} — ${p.monthlyUsd} USD/month per business
                      {p.id !== 'free'
                        ? ' (not yet available for purchase)'
                        : ''}
                      <span className="signup-plan-scope">
                        {planUserLabel(p.id)}.{' '}
                        {p.id === 'cottage-kitchen'
                          ? 'All intended program features except resale and consignment. Invitations and member administration Coming soon.'
                          : p.id === 'cottage-mercantile'
                            ? 'Full intended program, including resale and consignment. Invitations Coming soon; new team member setup awaits a confirmed user limit.'
                            : ''}
                      </span>
                    </span>
                  </label>
                ))}
                <p role="status">
                  {plan === 'free'
                    ? 'Free setup requires email verification and approved Terms and Privacy. Proposed record and feature limits are not active.'
                    : 'You can create your account now. Paid activation is not yet available. Your selected plan will be saved; no paid access or subscription is granted.'}
                </p>
              </fieldset>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={busy}
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  disabled={busy}
                />
              </label>
              <p>
                Your email and password are sent to the existing authentication
                provider to create your account. No policy acceptance is
                recorded by this form.
              </p>
              <button
                className="public-button"
                type="submit"
                disabled={busy || !plan}
              >
                {busy ? 'Creating account…' : 'Get Started'}
              </button>
            </form>
          )}
          <div className="registration-actions">
            <a
              className="public-text-link"
              href={plan ? signupPlanHref(plan, '/login') : '/login'}
            >
              Already have an account? Log in.
            </a>
          </div>
          <a className="public-text-link" href="/help">
            Need help?
          </a>
        </div>
      </section>
    </PublicSite>
  )
}
