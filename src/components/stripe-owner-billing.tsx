import { useEffect, useState } from 'react'
import { launchPricing } from '@/lib/launch-plans'
import type { AdminMetadata } from '@/lib/platform-admin-types'
export function StripeOwnerBilling() {
  const [data, setData] = useState<AdminMetadata | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [choice, setChoice] = useState(''),
    [confirmed, setConfirmed] = useState(false)
  function display(result: AdminMetadata) {
    setData(result)
    const saved = result.signupSelection?.planId
    if (
      saved &&
      result.available?.some((e: AdminMetadata) => e.plans.includes(saved))
    )
      setChoice((current) => current || saved)
  }
  async function request(body?: unknown) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/stripe/billing', {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        signal: AbortSignal.timeout(20000),
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      if (result.url) window.location.assign(result.url)
      else if (result.verifying) {
        setError(
          'Payment is being verified. Use Refresh verified billing below; access only changes after payment evidence is confirmed.',
        )
      } else display(result)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    let active = true
    const returned =
      new URLSearchParams(window.location.search).get('checkout') ===
      'verifying'
    fetch('/api/stripe/billing', {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(20000),
      ...(returned
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'refresh' }),
          }
        : {}),
    })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
        if (active) display(result)
      })
      .catch((e) => {
        if (active) setError((e as Error).message)
      })
    return () => {
      active = false
    }
  }, [])
  const date = (v: unknown) =>
    v ? new Date(String(v)).toLocaleString() : 'Not verified'
  return (
    <section
      className="registration-notice"
      aria-label="Stripe subscription billing"
    >
      <h2>Stripe subscription billing</h2>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Loading verified billing…</p>}
      {!data && error && (
        <button
          className="btn secondary"
          disabled={busy}
          onClick={() => request()}
        >
          Retry billing status
        </button>
      )}
      {data && (
        <>
          <p>
            Business: {data.workspace.name} · Assigned tier:{' '}
            {data.billing?.plan || 'Unassigned'} · Effective tier:{' '}
            {data.access?.plan || 'Unassigned'}
          </p>
          <p>
            Access source: {data.access?.source || 'unassigned'} · Provider:{' '}
            {data.billing?.provider || 'No provider subscription'} · Status:{' '}
            {data.billing?.status || 'No paid subscription'}
          </p>
          <p>
            Verified paid through: {date(data.billing?.paidThrough)} · Last
            reconciliation: {date(data.billing?.lastReconciled)}
          </p>
          {data.billing?.cancellation && (
            <p>
              Cancellation scheduled/recorded: {date(data.billing.cancellation)}
            </p>
          )}
          {data.attempts.some(
            (a: AdminMetadata) =>
              ['creating', 'open'].includes(a.status) ||
              (a.status === 'complete' &&
                data.billing?.status === 'payment_processing'),
          ) && (
            <p>
              Returning from checkout does not grant access. Refresh verified
              billing to recover a pending payment or expired checkout. A
              cancelled browser checkout can be resumed with the same business
              and tier; it does not create another subscription.
            </p>
          )}
          {(data.available || []).length === 0 && (
            <p>
              New Stripe checkout is disabled until administrator setup and
              approval are complete. Existing access remains visible above.
            </p>
          )}
          {(data.available || []).map((env: AdminMetadata) => (
            <div key={env.environment}>
              <p>
                {env.environment === 'test'
                  ? 'TEST — disposable test billing only'
                  : 'LIVE — real recurring software subscription'}
              </p>
              <label>
                Approved tier
                <select
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  <option value="">Choose a tier</option>
                  {env.plans.map((id: string) => (
                    <option value={id} key={id}>
                      {launchPricing.plans.find((p) => p.id === id)?.name} · $
                      {launchPricing.plans.find((p) => p.id === id)?.monthlyUsd}{' '}
                      USD / month
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{' '}
                I authorize the displayed recurring monthly business
                subscription. No trial or extra failed-payment grace. Plan
                changes and cancellation require a separate reviewed policy.
              </label>
              <button
                className="btn primary"
                disabled={busy || !choice || !confirmed}
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
          <div className="button-row">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => request({ action: 'refresh' })}
            >
              Refresh verified billing
            </button>
            {data.billing?.provider?.startsWith('stripe_') && (
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => request({ action: 'portal' })}
              >
                Manage billing with Stripe
              </button>
            )}
          </div>
          <p>
            Portal changes are confirmed through reconciliation after return.
            Manual grants never mark billing paid or stop existing provider
            charges.
          </p>
        </>
      )}
    </section>
  )
}
