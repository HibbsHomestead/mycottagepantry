import { useEffect, useState } from 'react'
import { PublicSite } from './public-site'
import { registrationRequest } from '@/lib/registration-client'
import { subscriptionConsent } from '@/lib/registration'
import { launchPricing, planUserLabel } from '@/lib/launch-plans'
import './registration.css'
import type { SignupSelection } from '@/lib/signup-plan'

type Overview = {
  workspace: { id: string; name: string }
  signupSelection?: SignupSelection | null
  currentAccess?: { planId: string | null; kind: string }
  accessSource: string
  billing: null | {
    plan_id: string | null
    source: string
    status: string
    environment: string | null
    paid_through: string | null
    next_billing_date: string | null
    canceled_date: string | null
    provider_status: string | null
    last_reconciled_at: string | null
    hasSubscription: boolean
  }
  billingOwner: 'you' | 'another_owner' | null
  attempts: {
    id: string
    plan_id: string
    status: string
    amount_cents: number | null
    checkout_url: string | null
    environment: string
    created_at: string
  }[]
  invoices: {
    id: string
    status: string
    amount_cents: number
    paid_cents: number
    refunded_cents: number
    service_from: string | null
    service_through: string | null
  }[]
  environment: 'sandbox' | 'production' | null
  checkoutEnabled: boolean
  checkoutBlocked: string | null
  purchasablePlans: string[]
  cancelAvailable: boolean
  consentVersion: string
  policies: { status: string; items: readonly (readonly [string, string])[] }
}

const plans = launchPricing.plans
const planName = (id?: string | null) =>
  plans.find((p) => p.id === id)?.name || 'No plan'
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`
const date = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : '—'

const statusText: Record<string, string> = {
  free_active: 'Free — active',
  checkout_pending: 'Waiting for checkout',
  payment_processing: 'Payment pending confirmation',
  paid_active: 'Paid — active',
  past_due: 'Payment failed — grace period',
  payment_failed: 'Payment failed',
  cancelled: 'Cancelled — access until the end of the paid period',
  expired: 'Paid period ended — Free limits apply',
  needs_review: 'Under review — records are safe',
  complimentary: 'Complimentary',
}

/** Settings → Subscription & Billing. Owner-only; all values come from the server. */
export function BillingPage() {
  const [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [choice, setChoice] = useState(''),
    [consent, setConsent] = useState(false),
    [confirmCancel, setConfirmCancel] = useState(false)
  const returned =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('checkout')
  async function run(work: () => Promise<Overview | { url: string }>) {
    setBusy(true)
    setError('')
    try {
      const result = await work()
      if ('url' in result) window.location.assign(result.url)
      else {
        setData(result)
        if (result.signupSelection) setChoice(result.signupSelection.planId)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    let active = true
    // Returning from Square never grants access; ask the server to re-check Square.
    ;(returned
      ? registrationRequest('billing', { action: 'refresh' })
      : registrationRequest('billing')
    )
      .then((result) => {
        if (!active) return
        setData(result)
        if (result.signupSelection) setChoice(result.signupSelection.planId)
      })
      .catch((e) => active && setError((e as Error).message))
    return () => {
      active = false
    }
  }, [returned])
  const billing = data?.billing
  const complimentary =
    data?.accessSource === 'complimentary' ||
    data?.accessSource === 'legacy_complimentary'
  const currentPlan = complimentary
    ? null
    : plans.find((p) => p.id === (data?.currentAccess?.planId || 'free'))
  const subscriptionPlan = plans.find((p) => p.id === billing?.plan_id)
  const pending = (data?.attempts || []).find((a) =>
    ['checkout_pending', 'payment_processing', 'unknown'].includes(a.status),
  )
  const selected = plans.find((p) => p.id === choice)
  return (
    <PublicSite>
      <section className="registration-shell">
        <div className="registration-paper">
          <p className="public-eyebrow">Settings</p>
          <h1>Subscription & Billing</h1>
          {error && <p role="alert">{error}</p>}
          {!data && !error && (
            <p role="status">Checking your billing status…</p>
          )}
          {data && (
            <>
              <p>{data.workspace.name}</p>
              {data.signupSelection && (
                <p className="registration-notice">
                  Selected plan: {data.signupSelection.name} — $
                  {data.signupSelection.monthlyUsd} USD per business, monthly.{' '}
                  This is your saved preference, not proof of a paid
                  subscription.
                  {!data.checkoutEnabled &&
                    data.signupSelection.planId !== 'free' &&
                    ' Paid activation is not yet available for this business. Your current access is shown below.'}
                </p>
              )}
              {data.environment === 'sandbox' && (
                <p className="registration-notice">
                  Square Sandbox test mode. No real card is charged.
                </p>
              )}
              <dl className="billing-summary">
                <dt>Current plan</dt>
                <dd>
                  {complimentary
                    ? 'Complimentary access'
                    : currentPlan?.name || 'Free'}
                </dd>
                {currentPlan && (
                  <>
                    <dt>Intended plan scope</dt>
                    <dd>
                      {currentPlan.caption} {planUserLabel(currentPlan.id)}. New
                      plan definitions do not change existing account access.
                      Unfinished tools remain Coming soon.
                    </dd>
                  </>
                )}
                <dt>Access</dt>
                <dd>
                  {complimentary
                    ? 'Complimentary — no subscription or payment needed'
                    : statusText[billing?.status || 'free_active'] ||
                      billing?.status}
                </dd>
                <dt>Subscription price</dt>
                <dd>
                  {complimentary
                    ? '$0'
                    : billing?.hasSubscription
                      ? `$${subscriptionPlan?.monthlyUsd ?? 0} USD per month`
                      : '$0 — no paid subscription'}
                </dd>
                <dt>Billing cadence</dt>
                <dd>
                  {complimentary || !billing?.hasSubscription
                    ? 'None'
                    : 'Monthly'}
                </dd>
                {billing?.paid_through && (
                  <>
                    <dt>Paid through (confirmed)</dt>
                    <dd>{date(billing.paid_through)}</dd>
                  </>
                )}
                {billing?.next_billing_date && !billing.canceled_date && (
                  <>
                    <dt>Next renewal</dt>
                    <dd>{date(billing.next_billing_date)}</dd>
                  </>
                )}
                {billing?.canceled_date && (
                  <>
                    <dt>Cancellation effective</dt>
                    <dd>{date(billing.canceled_date)}</dd>
                  </>
                )}
                <dt>Billing managed by</dt>
                <dd>
                  {data.billingOwner === 'you'
                    ? 'You'
                    : data.billingOwner === 'another_owner'
                      ? 'Another Owner of this oven'
                      : 'Not set (the first Owner to subscribe manages billing)'}
                </dd>
              </dl>
              {pending && (
                <p role="status" className="registration-notice">
                  {pending.status === 'checkout_pending'
                    ? `Checkout for ${planName(pending.plan_id)} is open. Paid access starts only after Square confirms payment.`
                    : 'Payment pending confirmation. This can take a few minutes. Paid access starts once Square confirms the payment; refreshing never starts another charge.'}
                  {pending.checkout_url && (
                    <>
                      {' '}
                      <a href={pending.checkout_url}>Return to checkout</a>
                    </>
                  )}
                </p>
              )}

              {data.checkoutEnabled ? (
                <section aria-label="Choose a paid plan">
                  <h2>Choose a paid plan</h2>
                  <fieldset className="billing-plans">
                    <legend>Monthly plans</legend>
                    {plans
                      .filter((p) =>
                        (data.purchasablePlans || []).includes(p.id),
                      )
                      .map((p) => (
                        <label key={p.id} className="check-label">
                          <input
                            type="radio"
                            name="plan"
                            value={p.id}
                            checked={choice === p.id}
                            onChange={() => {
                              setChoice(p.id)
                              setConsent(false)
                            }}
                          />{' '}
                          {p.name} — ${p.monthlyUsd} USD / month
                        </label>
                      ))}
                  </fieldset>
                  {selected && (
                    <>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />{' '}
                        {subscriptionConsent.text(
                          selected.name,
                          selected.monthlyUsd,
                        )}
                      </label>
                      <button
                        className="public-button"
                        disabled={busy || !consent || !!pending}
                        onClick={() =>
                          run(() =>
                            registrationRequest('billing', {
                              action: 'checkout',
                              planId: selected.id,
                              consent: {
                                accepted: true,
                                version: data.consentVersion,
                              },
                            }),
                          )
                        }
                      >
                        Continue to secure Square checkout
                      </button>
                    </>
                  )}
                </section>
              ) : (
                data.checkoutBlocked && <p>{data.checkoutBlocked}</p>
              )}

              {data.cancelAvailable && (
                <section aria-label="Cancel subscription">
                  <h2>Cancel subscription</h2>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={confirmCancel}
                      onChange={(e) => setConfirmCancel(e.target.checked)}
                    />{' '}
                    Cancel at the end of the current paid month. Paid access
                    continues until then; records are kept.
                  </label>
                  <button
                    className="public-button"
                    disabled={busy || !confirmCancel}
                    onClick={() =>
                      run(() =>
                        registrationRequest('billing', {
                          action: 'cancel',
                          confirm: true,
                        }),
                      )
                    }
                  >
                    Cancel subscription
                  </button>
                </section>
              )}
              {billing?.hasSubscription && (
                <p className="form-hint">
                  Card changes: Square emails a payment link if a renewal fails.
                  A self-service card update page is not available yet.
                </p>
              )}

              <section aria-label="Payment activation help">
                <h2>Payment or activation help</h2>
                <p>
                  If Square confirms payment while access is still pending,
                  refresh billing status once. If access remains pending,
                  contact{' '}
                  <a href="mailto:cottagepantry@icloud.com">
                    cottagepantry@icloud.com
                  </a>{' '}
                  with your business name and checkout reference below. Do not
                  pay again or send card details.
                </p>
                {data.attempts?.slice(0, 1).map((attempt) => (
                  <p key={attempt.id}>
                    Checkout reference: <code>{attempt.id}</code>
                  </p>
                ))}
              </section>
              <h2>Invoices & payments</h2>
              {data.invoices?.length ? (
                <ul>
                  {data.invoices.map((i) => (
                    <li key={i.id}>
                      {date(i.service_from)} – {date(i.service_through)} ·{' '}
                      {usd(i.amount_cents)} · {i.status}
                      {i.refunded_cents
                        ? ` · refunded ${usd(i.refunded_cents)}`
                        : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No invoices yet. Sample invoices are never shown.</p>
              )}

              <details>
                <summary>Billing policies (proposed, pending approval)</summary>
                <ul>
                  {(data.policies?.items || []).map(([title, text]) => (
                    <li key={title}>
                      <strong>{title}:</strong> {text}
                    </li>
                  ))}
                </ul>
              </details>
              <div className="registration-actions">
                <button
                  className="public-button"
                  onClick={() =>
                    run(() =>
                      registrationRequest('billing', { action: 'refresh' }),
                    )
                  }
                  disabled={busy}
                >
                  Refresh status
                </button>
                <a className="public-text-link" href="/pricing">
                  Compare plans
                </a>
              </div>
            </>
          )}
          {!data && error && (
            <a href="/login" className="public-button">
              Log in as oven Owner
            </a>
          )}
          <div className="registration-actions">
            <a href="/oven#Settings" className="public-text-link">
              Back to oven settings
            </a>
            <a href="/help" className="public-text-link">
              Need help?
            </a>
          </div>
        </div>
      </section>
    </PublicSite>
  )
}
