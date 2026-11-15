import { SubscriptionExpenses } from './subscription-expenses'
import { useEffect, useRef, useState } from 'react'
import {
  launchPricing,
  launchFeatures,
  planUserLabel,
  type PlanId,
} from '@/lib/launch-plans'
import {
  featurePresentation,
  teamAvailabilityNotice,
  subscriptionChangePolicy,
} from '@/lib/plan-presentation'
import { billingRequest } from '@/lib/billing-client'
import type { AdminMetadata } from '@/lib/platform-admin-types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import './subscription-billing.css'

const tier = (id: string) => launchPricing.plans.find((p) => p.id === id)
const date = (value: unknown) =>
  value ? new Date(String(value)).toLocaleString() : 'Not verified'
const amount = (cents: number | null, currency = 'usd') =>
  Number.isSafeInteger(cents)
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency.toUpperCase(),
      }).format(Number(cents) / 100)
    : 'Price not verified'

export function StripeOwnerBilling({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const [data, setData] = useState<AdminMetadata | null>(null)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false),
    [choice, setChoice] = useState('')
  const [confirmed, setConfirmed] = useState(false),
    [preview, setPreview] = useState<AdminMetadata | null>(null)
  const [keepPlan, setKeepPlan] = useState(false),
    [blocked, setBlocked] = useState(false)
  const requestedPlan = useRef<string | null>(null)
  function display(result: AdminMetadata) {
    setData(result)
    const saved = requestedPlan.current || result.signupSelection?.planId
    if (saved && tier(saved)) setChoice((current) => current || saved)
  }
  async function request(body?: AdminMetadata) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await billingRequest(body)
      if (result.url) {
        if (!/^https:\/\/(checkout|billing)\.stripe\.com\//.test(result.url))
          throw new Error('The billing destination could not be verified.')
        window.location.assign(result.url)
      } else if (result.preview) {
        setConfirmed(false)
        setPreview(result.preview)
      } else if (result.workspace) {
        display(result)
        if (body?.action === 'confirm_change') {
          setPreview(null)
          const change = result.changes?.find(
            (c: AdminMetadata) => c.id === body.changeId,
          )
          setNotice(
            change?.status === 'applied'
              ? 'Stripe confirmed the plan change.'
              : change?.status === 'scheduled'
                ? 'Stripe confirmed the scheduled change. Your current paid access stays until the displayed date.'
                : 'The change is awaiting Stripe confirmation. Refresh verified billing to check payment and access.',
          )
        }
        if (body?.action === 'cancel_pending') {
          setKeepPlan(false)
          setNotice(
            result.changes?.some((c: AdminMetadata) =>
              ['scheduled', 'releasing'].includes(c.status),
            )
              ? 'The request is still being verified. Refresh billing before retrying.'
              : 'Stripe confirmed that the pending change was cancelled.',
          )
        }
      } else if (result.verifying)
        setNotice(
          'Payment is being verified. Refresh verified billing; access changes only after Stripe confirms payment.',
        )
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    let active = true
    requestedPlan.current = new URLSearchParams(window.location.search).get(
      'plan',
    )
    billingRequest({ action: 'refresh' })
      .then((result) => {
        if (active) display(result)
      })
      .catch((failure) => {
        if (active) {
          setError(failure.message)
          setBlocked(failure.code === 'OWNER_REQUIRED')
        }
      })
    return () => {
      active = false
    }
  }, [])
  const pending = data?.changes?.find((c: AdminMetadata) =>
    ['applying', 'pending', 'scheduled', 'releasing'].includes(c.status),
  )
  const subscription = data?.subscription
  const subscribed = data?.hasSubscription === true
  const currentPlan = subscribed ? data?.billing?.plan : data?.access?.plan
  const selected = tier(choice)
  const accessChanges = preview
    ? {
        added: launchFeatures
          .filter((f) => preview.added?.includes(f.id))
          .map((f) => ({ ...f, ...featurePresentation(preview.toPlan, f.id) })),
        removed: launchFeatures.filter((f) => preview.removed?.includes(f.id)),
      }
    : null
  return (
    <section
      className="subscription-billing"
      aria-label="Billing & Subscription"
      aria-busy={busy}
    >
      {!embedded && <h2>Billing &amp; Subscription</h2>}
      {!data && !error && (
        <div className="billing-loading" role="status">
          Loading verified subscription…
        </div>
      )}
      {error && (
        <p role="alert" className="billing-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="billing-notice">
          {notice}
        </p>
      )}
      {!data && !blocked && error && (
        <>
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() => request({ action: 'refresh' })}
          >
            Retry billing status
          </button>
          <a href="/login?returnTo=%2Foven%2Fbilling">
            Sign in to manage billing
          </a>
        </>
      )}
      {blocked && (
        <p>
          The business owner manages billing. Ask the owner to open Settings →
          Billing &amp; Subscription.
        </p>
      )}
      {data && (
        <SubscriptionExpenses
          key={String(data.billing?.lastReconciled || data.workspace?.id)}
        />
      )}
      {data && (
        <>
          <p className="eyebrow">BILLING FOR {data.workspace.name}</p>
          <div className="billing-overview">
            <div>
              <span>Current subscription tier</span>
              <h3>
                {subscribed
                  ? tier(subscription?.plan || data.billing?.plan)?.name ||
                    'Awaiting verification'
                  : 'No current paid subscription'}
              </h3>
              {subscription && subscribed && (
                <p>
                  {amount(
                    subscription.monthlyCents,
                    subscription.currency || 'usd',
                  )}{' '}
                  {subscription.currency?.toUpperCase()} per business /{' '}
                  {subscription.intervalCount > 1
                    ? subscription.intervalCount + ' '
                    : ''}
                  {subscription.interval || 'interval not verified'}
                </p>
              )}
              {!subscribed && (
                <p>
                  Current access:{' '}
                  {tier(data.access?.plan)?.name || 'Not assigned'}. Selecting a
                  plan does not activate a subscription.
                </p>
              )}
            </div>
            <span className="status neutral">
              {subscription?.status?.replaceAll('_', ' ') ||
                data.billing?.status?.replaceAll('_', ' ') ||
                'No provider subscription'}
            </span>
          </div>
          <dl className="billing-facts">
            <div>
              <dt>
                {subscription?.endsAt
                  ? 'Subscription end date'
                  : 'Next renewal'}
              </dt>
              <dd>
                {date(
                  subscription?.endsAt ||
                    subscription?.renewsAt ||
                    data.billing?.nextBillingDate,
                )}
              </dd>
            </div>
            <div>
              <dt>Included users</dt>
              <dd>{planUserLabel((currentPlan || 'free') as PlanId)}</dd>
            </div>
            <div>
              <dt>Current seat usage</dt>
              <dd>
                {Number.isInteger(data.seatUsage)
                  ? `${data.seatUsage} active users, including the owner`
                  : 'Not available'}
              </dd>
            </div>
            <div>
              <dt>Paid through</dt>
              <dd>{date(data.billing?.paidThrough)}</dd>
            </div>
            <div>
              <dt>Current access tier</dt>
              <dd>{tier(data.access?.plan)?.name || 'Unassigned'}</dd>
            </div>
            <div>
              <dt>Billing last updated</dt>
              <dd>{date(data.billing?.lastReconciled)}</dd>
            </div>
          </dl>
          {['cottage-kitchen', 'cottage-mercantile'].includes(currentPlan) && (
            <p className="billing-small">{teamAvailabilityNotice}</p>
          )}
          {subscription?.environment === 'test' && (
            <p className="billing-notice">
              TEST subscription — disposable test billing only. No LIVE
              subscription is changed here.
            </p>
          )}
          {pending && (
            <div className="billing-notice" role="status">
              <h3>
                {pending.status === 'scheduled'
                  ? 'Scheduled subscription change'
                  : 'Subscription change awaiting confirmation'}
              </h3>
              <p>
                {tier(pending.fromPlan)?.name} → {tier(pending.toPlan)?.name} ·{' '}
                {date(pending.effectiveAt)}
              </p>
              <p>
                {pending.kind === 'upgrade'
                  ? 'Payment may need attention. Use Stripe billing to review invoices, then refresh verified billing.'
                  : 'Current paid access remains until the effective date. The destination allowance also caps new memberships while this change is pending.'}
              </p>
              {pending.status === 'applying' && (
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() =>
                    request({
                      action: 'confirm_change',
                      changeId: pending.id,
                      confirmed: true,
                    })
                  }
                >
                  Check / resume confirmed request
                </button>
              )}
              {(['scheduled', 'releasing'].includes(pending.status) ||
                (pending.status === 'applying' &&
                  pending.kind !== 'upgrade')) && (
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => setKeepPlan(true)}
                >
                  {pending.kind === 'cancel'
                    ? 'Resume subscription'
                    : 'Cancel pending change'}
                </button>
              )}
            </div>
          )}
          {data.changes?.[0]?.status === 'failed' && (
            <p role="alert">
              The last plan change did not complete. Review payment in Stripe,
              refresh, and request a new preview. Current verified access is
              shown above.
            </p>
          )}
          {subscription?.pendingUpdate && !pending && (
            <p role="status">
              Stripe has a pending update. Review payment in Stripe and refresh
              before requesting another change.
            </p>
          )}
          {subscription?.providerSchedule && !pending && (
            <p role="status">
              Stripe has a subscription schedule that needs support review
              before another plan change.
            </p>
          )}
          {subscribed && !pending && data.changeBlockedReason && (
            <p role="status">{data.changeBlockedReason}</p>
          )}
          {!subscribed && data.checkoutBlockedReason && (
            <p role="status">{data.checkoutBlockedReason}</p>
          )}
          {data.attempts?.some(
            (a: AdminMetadata) =>
              ['creating', 'open'].includes(a.status) ||
              (a.status === 'complete' &&
                data.billing?.status === 'payment_processing'),
          ) && (
            <p>
              Returning from checkout does not grant access. Refresh verified
              billing to confirm payment. An unfinished checkout resumes the
              same request.
            </p>
          )}
          {subscribed && !pending && !data.changeBlockedReason && (
            <div className="billing-plan-select">
              <h3>Change plan</h3>
              <p>
                {subscriptionChangePolicy.upgrade}{' '}
                {subscriptionChangePolicy.downgrade}
              </p>
              <label>
                New plan
                <select
                  value={choice}
                  onChange={(e) => {
                    setChoice(e.target.value)
                    setPreview(null)
                  }}
                  disabled={busy}
                >
                  <option value="">Choose a plan</option>
                  {launchPricing.plans
                    .filter((p) => p.id !== currentPlan)
                    .map((p) => {
                      const available =
                        p.id === 'free' ||
                        data.changePlans?.some(
                          (a: AdminMetadata) => a.id === p.id && a.purchasable,
                        )
                      return (
                        <option key={p.id} value={p.id} disabled={!available}>
                          {p.name} · ${p.monthlyUsd} USD/month
                          {!available ? ' · unavailable' : ''}
                        </option>
                      )
                    })}
                </select>
              </label>
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() =>
                  request({ action: 'preview_change', plan: 'free' })
                }
              >
                Review cancellation at renewal
              </button>
              {selected && (
                <p>
                  {planUserLabel(selected.id)}.{' '}
                  {selected.users > 1 && teamAvailabilityNotice}
                </p>
              )}
              {data.changePlans
                ?.filter(
                  (a: AdminMetadata) => !a.purchasable && a.id !== 'free',
                )
                .map((a: AdminMetadata) => (
                  <p className="billing-small" key={a.id}>
                    {tier(a.id)?.name}: {a.reason}
                  </p>
                ))}
              <button
                className="btn primary"
                disabled={
                  busy ||
                  !selected ||
                  choice === currentPlan ||
                  subscription?.pendingUpdate ||
                  subscription?.providerSchedule ||
                  (choice !== 'free' &&
                    !data.changePlans?.some(
                      (p: AdminMetadata) => p.id === choice && p.purchasable,
                    ))
                }
                onClick={() =>
                  request({ action: 'preview_change', plan: choice })
                }
              >
                Review plan change
              </button>
              <p className="billing-small">
                Select Free to schedule cancellation at renewal. Existing
                records and exports remain available.
              </p>
            </div>
          )}
          {!subscribed &&
            !data.checkoutBlockedReason &&
            (data.available || []).map((env: AdminMetadata) => (
              <div className="billing-plan-select" key={env.environment}>
                <h3>
                  {env.environment === 'test'
                    ? 'TEST — disposable test subscription'
                    : 'Subscribe to a plan'}
                </h3>
                {env.environment === 'live' && (
                  <p>
                    LIVE — real recurring software subscription for{' '}
                    {data.workspace.name}.
                  </p>
                )}
                <label>
                  Approved tier
                  <select
                    value={env.plans.includes(choice) ? choice : ''}
                    onChange={(e) => {
                      setChoice(e.target.value)
                      setConfirmed(false)
                    }}
                    disabled={busy}
                  >
                    <option value="">Choose a plan</option>
                    {env.plans.map((id: string) => (
                      <option value={id} key={id}>
                        {tier(id)?.name} · ${tier(id)?.monthlyUsd} USD / month
                      </option>
                    ))}
                  </select>
                </label>
                {selected && (
                  <p>
                    {planUserLabel(selected.id)}.{' '}
                    {selected.users > 1 && teamAvailabilityNotice}
                  </p>
                )}
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I authorize the displayed monthly subscription for{' '}
                  {data.workspace.name}. No trial.{' '}
                  {subscriptionChangePolicy.upgrade}{' '}
                  {subscriptionChangePolicy.downgrade}
                </label>
                <button
                  className="btn primary"
                  disabled={busy || !env.plans.includes(choice) || !confirmed}
                  onClick={() =>
                    request({
                      action: 'checkout',
                      environment: env.environment,
                      plan: choice,
                      confirmed,
                    })
                  }
                >
                  Continue / resume hosted checkout
                </button>
              </div>
            ))}
          {!subscribed && !data.checkoutBlockedReason && (
            <p>
              {(data.available || []).some((e: AdminMetadata) => e.plans.length)
                ? 'Free access needs no payment method. Choose a paid plan above when ready.'
                : 'No approved checkout is currently available for this business. Free access needs no payment method; view pricing for availability details.'}{' '}
              <a href="/pricing">Compare all plans</a>.
            </p>
          )}
          <div className="button-row billing-actions">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => request({ action: 'refresh' })}
            >
              Refresh verified billing
            </button>
            {data.billing?.provider?.startsWith('stripe_') && (
              <>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => request({ action: 'portal' })}
                >
                  Manage payment method
                </button>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => request({ action: 'portal' })}
                >
                  View invoices &amp; billing history
                </button>
              </>
            )}
          </div>
          <p className="billing-small">
            Payment methods and invoices open in the existing Stripe Customer
            Portal. Returning triggers verification; a redirect alone never
            confirms a change. Manual access grants are separate from
            subscription billing.
          </p>
        </>
      )}
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setPreview(null)
            setConfirmed(false)
          }
        }}
      >
        <DialogContent className="billing-review">
          <DialogHeader>
            <DialogTitle>Review subscription change</DialogTitle>
            <DialogDescription>
              Billing for {data?.workspace.name}. Review the provider amount,
              timing and access changes.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <>
              <h3>
                {tier(preview.fromPlan)?.name} → {tier(preview.toPlan)?.name}
              </h3>
              <dl className="billing-facts">
                <div>
                  <dt>Current monthly price</dt>
                  <dd>{amount(preview.fromMonthlyCents)} USD</dd>
                </div>
                <div>
                  <dt>New recurring price</dt>
                  <dd>
                    {amount(preview.toMonthlyCents)} USD/month per business
                  </dd>
                </div>
                <div>
                  <dt>Takes effect</dt>
                  <dd>
                    {preview.kind === 'upgrade'
                      ? 'Immediately after Stripe confirms payment'
                      : date(preview.effectiveAt)}
                  </dd>
                </div>
                <div>
                  <dt>Immediate amount due</dt>
                  <dd>
                    {amount(preview.amountDue)} USD
                    {preview.kind === 'upgrade'
                      ? ' · Stripe preview'
                      : ' · no immediate charge or proration'}
                  </dd>
                </div>
                {preview.credit > 0 && (
                  <div>
                    <dt>Provider-previewed credit</dt>
                    <dd>
                      {amount(preview.credit)} USD · applied to Stripe billing
                      balance
                    </dd>
                  </div>
                )}
                <div>
                  <dt>User allowance</dt>
                  <dd>
                    {preview.fromUsers ?? 'Historical allowance'} →{' '}
                    {preview.toUsers} total users, including the owner.
                    Currently {preview.seatUsage} active.
                  </dd>
                </div>
              </dl>
              <p>{preview.timing}</p>
              <p>{teamAvailabilityNotice}</p>
              <details>
                <summary>Feature access changes</summary>
                {accessChanges?.added.length ? (
                  <>
                    <h4>Added to the plan’s scope</h4>
                    <ul>
                      {accessChanges.added.map((f) => (
                        <li key={f.id}>
                          {f.label} — {f.text}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>No additional feature allocations.</p>
                )}
                {!!accessChanges?.removed.length && (
                  <>
                    <h4>Removed at the effective date</h4>
                    <ul>
                      {accessChanges.removed.map((f) => (
                        <li key={f.id}>{f.label}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p>
                  Partial and Coming soon capabilities keep their stated
                  availability. Records, history and exports are retained.
                </p>
                <a href="/pricing" target="_blank" rel="noreferrer">
                  Open full comparison
                </a>
              </details>
              <p className="billing-small">
                Review expires {date(preview.expiresAt)}. Stripe’s preview
                includes the current tax and balance treatment; the recurring
                base price is shown above.
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  disabled={busy}
                />
                I confirm the displayed amount, timing and access change for{' '}
                {data?.workspace.name}.
              </label>
              {error && <p role="alert">{error}</p>}
              <div className="button-row">
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => setPreview(null)}
                >
                  Keep current plan
                </button>
                <button
                  className="btn primary"
                  disabled={busy || !confirmed}
                  onClick={() =>
                    request({
                      action: 'confirm_change',
                      changeId: preview.id,
                      confirmed: true,
                    })
                  }
                >
                  {busy ? 'Verifying change…' : 'Confirm subscription change'}
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={keepPlan} onOpenChange={setKeepPlan}>
        <DialogContent className="billing-review">
          <DialogHeader>
            <DialogTitle>Keep your current subscription?</DialogTitle>
            <DialogDescription>
              This cancels the pending change for {data?.workspace.name}. Your
              current plan continues at its recurring price.
            </DialogDescription>
          </DialogHeader>
          <p>
            {tier(currentPlan)?.name}: ${tier(currentPlan)?.monthlyUsd}{' '}
            USD/month per business.
          </p>
          {error && <p role="alert">{error}</p>}
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              request({ action: 'cancel_pending', confirmed: true })
            }
          >
            Confirm keeping current subscription
          </button>
        </DialogContent>
      </Dialog>
    </section>
  )
}
