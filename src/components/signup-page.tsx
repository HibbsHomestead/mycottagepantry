import { useAccountAccess } from '@/lib/account-access-client'
import { AccountAccessStatus } from './account-access-status'
import { PublicSite } from './public-site'
import { signupSteps } from '@/lib/registration'
import { launchPricing, planVisible, type PlanId } from '@/lib/launch-plans'
import { signupPlan, signupPlanHref } from '@/lib/signup-plan'
import { signupPlanRequest } from '@/lib/signup-plan-client'
import { useStripePurchaseAvailability } from '@/lib/stripe-availability'
import { planAudience } from '@/lib/plan-presentation'
import { useSyncExternalStore, useState, type FormEvent } from 'react'
import './registration.css'

function subscribeToSearch(listener: () => void) {
  window.addEventListener('popstate', listener)
  return () => window.removeEventListener('popstate', listener)
}

export function SignupPage() {
  const account = useAccountAccess('signup')
  const availability = useStripePurchaseAvailability()
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
  const loginHref = plan
    ? signupPlanHref(plan, '/login') +
      (plan === 'free' ? '' : '&returnTo=%2Foven%2Fbilling')
    : '/login'
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
          <h1 id="signup-title">Get started</h1>
          <p className="registration-lead">
            Choose a plan for your food, handmade, or homestead business.
          </p>
          {(error || invalidSelection) && (
            <p role="alert">{error || invalidSelection}</p>
          )}
          {submitted ? (
            <div role="status">
              <h2>Check your email</h2>
              <p>
                Follow the verification link in your email, then log in to
                continue. If it hasn’t arrived, check your spam folder or visit
                Help for support.
              </p>
              <p>
                Your chosen plan is kept for when you return after verification.
              </p>
              <a href={loginHref}>Continue to login</a>
            </div>
          ) : (
            <form className="registration-form" onSubmit={submit}>
              <fieldset className="signup-plan-choice">
                <legend>Choose your plan</legend>
                {launchPricing.plans
                  .filter((p) => planVisible(p.id))
                  .map((p) => (
                    <label key={p.id} className="signup-plan-card">
                      <input
                        type="radio"
                        name="plan-choice"
                        value={p.id}
                        checked={plan === p.id}
                        disabled={busy}
                        onChange={() => {
                          setPlan(p.id)
                          setError('')
                          history.replaceState(
                            null,
                            '',
                            signupPlanHref(p.id) +
                              (p.id === 'free'
                                ? ''
                                : '&returnTo=%2Foven%2Fbilling'),
                          )
                        }}
                      />
                      <span>
                        <strong className="signup-plan-name">{p.name}</strong>
                        <span className="signup-plan-price">
                          ${p.monthlyUsd}
                          <span>/month</span>
                        </span>
                        <span className="signup-plan-scope">
                          {planAudience[p.id]}
                        </span>
                      </span>
                    </label>
                  ))}
              </fieldset>
              <div className="signup-plan-links">
                <span>Prices in USD, per business.</span>
                <a href="/pricing#plan-details-title">Compare plans</a>
              </div>
              {plan &&
                plan !== 'free' &&
                !availability.loading &&
                !availability.plans.includes(plan) && (
                  <p role="status">
                    Checkout for this plan is currently unavailable here. You
                    can still create an account.{' '}
                    <a href="https://mycottagepantry.com/pricing">
                      Check purchase options on our main site
                    </a>
                    .
                  </p>
                )}
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
                  aria-describedby="signup-password-help"
                />
              </label>
              <p id="signup-password-help">
                Use at least eight characters for your password.
              </p>
              <p className="signup-payment-note">
                {plan === 'free'
                  ? 'No payment method required.'
                  : plan && availability.plans.includes(plan)
                    ? 'Payment details are entered securely at checkout.'
                    : null}
              </p>
              <button
                className="public-button"
                type="submit"
                disabled={busy || !plan}
              >
                {busy ? 'Creating account…' : 'Continue'}
              </button>
            </form>
          )}
          <div className="registration-actions">
            <a className="public-text-link" href={loginHref}>
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
