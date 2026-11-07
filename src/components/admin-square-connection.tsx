import { useState } from 'react'
import type { AdminMetadata } from '@/lib/platform-admin-types'
import { billablePlanIds, planMonthlyCents } from '@/lib/launch-plans'

type Props = {
  data: AdminMetadata
  request: (query: string, body?: unknown) => Promise<AdminMetadata>
}
export function AdminSquareConnection({ data, request }: Props) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [location, setLocation] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [candidate, setCandidate] = useState<AdminMetadata | null>(
    data.oauth?.pending?.candidate || null,
  )
  const [callbackReady, setCallbackReady] = useState(
    !!data.oauth?.pending?.callbackReady,
  )
  async function act(action: string, environment: string, body: unknown = {}) {
    setBusy(true)
    setMessage('')
    try {
      const result = await request(
        `action=${action}&environment=${environment}`,
        body,
      )
      if (action === 'billing-connect') {
        window.location.assign(result.url)
        return
      }
      if (action === 'billing-oauth-complete') {
        setCallbackReady(false)
        if (!result.ok) {
          setMessage(result.error)
          return
        }
        setCandidate(result.candidate)
        return
      }
      if (result.problems?.length) {
        setMessage(
          result.problems
            .map((p: AdminMetadata) => `${p.planId}: ${p.problem}`)
            .join(' '),
        )
        return
      }
      window.location.assign('/admin?section=billing')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="admin-panel" aria-label="Square billing connection">
      <h2>Square subscription billing connection</h2>
      <p>
        Connect the platform account receiving Cottage Pantry subscription
        revenue. Customer Square sales connections are separate. Authorization
        alone does not enable paid checkout.
      </p>
      {typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('square') ===
          'failed' && (
          <p role="alert">
            Square authorization was cancelled, expired, or could not be
            verified. The existing connection was preserved. Start Connect
            Square again.
          </p>
        )}
      {(data.connection || []).map((env: AdminMetadata) => {
        const e = env.environment
        const connection = data.oauth?.connections?.find(
          (c: AdminMetadata) => c.environment === e,
        )
        const check = data.checks?.find(
          (c: AdminMetadata) => c.environment === e,
        )
        const setup = data.oauth?.setup?.find(
          (s: AdminMetadata) => s.environment === e,
        )
        const sync = data.syncRuns?.find(
          (s: AdminMetadata) => s.environment === e,
        )
        const webhook = data.webhookEvidence?.find(
          (w: AdminMetadata) =>
            w.environment === e &&
            w.merchant_id === connection?.merchant_id &&
            Date.parse(w.verified_at) >= Date.parse(connection.verified_at),
        )
        const mappings = (data.mappings || []).filter(
          (m: AdminMetadata) => m.environment === e,
        )
        const mappingsReady = billablePlanIds.every((id) =>
          mappings.some(
            (m: AdminMetadata) =>
              m.plan_id === id &&
              Number(m.amount_cents) === planMonthlyCents(id) &&
              m.cadence === 'MONTHLY',
          ),
        )
        const connected = connection?.status === 'connected'
        const statuses = [
          [
            'Square account connected',
            connected
              ? 'Verified'
              : connection
                ? 'Reconnect required'
                : 'Not verified',
          ],
          [
            'Required permissions verified',
            connected && connection.permissionsVerified
              ? 'Verified at authorization'
              : 'Not verified',
          ],
          [
            'Billing location selected',
            connected && connection.location_id
              ? 'Selected and verified'
              : 'Not selected',
          ],
          [
            'Plan mappings ready',
            mappingsReady ? 'Four monthly USD mappings recorded' : 'Not ready',
          ],
          [
            'Webhook processing verified',
            webhook &&
            data.events?.some(
              (event: AdminMetadata) =>
                event.environment === e && event.status === 'processed',
            )
              ? 'Verified'
              : webhook
                ? 'Signature verified; processing pending'
                : 'Not verified',
          ],
          [
            'Subscription synchronization ready',
            sync
              ? `Last successful provider check: ${new Date(sync.completed_at).toLocaleString()}`
              : 'Not verified',
          ],
          [
            'Live checkout enabled',
            e === 'production' && env.releaseApproved && !env.missing.length
              ? 'Release approved; readiness review required'
              : 'Disabled',
          ],
        ]
        const pendingHere = data.oauth?.pending?.environment === e
        return (
          <div className="admin-billing-env" key={e}>
            <h3>{e === 'sandbox' ? 'Sandbox' : 'Production'}</h3>
            {connection && (
              <p>
                Business: <strong>{connection.merchant_name}</strong> ·
                Merchant: {connection.merchant_id}
                <br />
                Billing location:{' '}
                {connection.locations?.find(
                  (l: AdminMetadata) => l.id === connection.location_id,
                )?.name ||
                  connection.location_id ||
                  'Not selected'}
              </p>
            )}
            <dl>
              {statuses.map(([title, value]) => (
                <div key={title}>
                  <dt>{title}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {check && (
              <p>
                Last billing configuration check:{' '}
                {new Date(check.checked_at).toLocaleString()} ·{' '}
                {check.ok ? 'Verified' : check.error_code || 'Incomplete'}
              </p>
            )}
            {!env.deploymentAllowed && (
              <p>
                Checkout is disabled in this deployment context or awaits
                Production release approval.
              </p>
            )}
            <div className="admin-actions">
              <button
                className="btn primary"
                disabled={busy || !!setup?.missing?.length}
                onClick={() => act('billing-connect', e)}
              >
                {connected ? 'Reconnect Square' : 'Connect Square'}
              </button>
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => act('billing-verify', e)}
              >
                Verify billing configuration
              </button>
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => act('billing-verify-mappings', e)}
              >
                Verify existing plan mappings
              </button>
              {e === 'sandbox' && (
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => act('billing-sync-plans', e)}
                >
                  Create or reuse Sandbox plans
                </button>
              )}
              {pendingHere && callbackReady && (
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => act('billing-oauth-complete', e)}
                >
                  Verify Square authorization
                </button>
              )}
            </div>
            {pendingHere && candidate && (
              <div>
                <h4>Confirm platform billing account</h4>
                <p>
                  Authorized business: <strong>{candidate.merchantName}</strong>{' '}
                  · Merchant {candidate.merchantId}. Confirmation saves this
                  account and location for {e} subscription billing. Replacing a
                  connection with existing subscriptions or open checkouts
                  requires an impact review first.
                </p>
                <label>
                  Billing location
                  <select
                    value={location}
                    onChange={(event) => {
                      setLocation(event.target.value)
                      setConfirmed(false)
                    }}
                  >
                    <option value="">Choose a billing location</option>
                    {candidate.locations.map((l: AdminMetadata) => (
                      <option
                        key={l.id}
                        value={l.id}
                        disabled={
                          l.status !== 'ACTIVE' ||
                          l.currency !== 'USD' ||
                          !l.capabilities.includes('CREDIT_CARD_PROCESSING')
                        }
                      >
                        {l.name} · {l.currency} · {l.status}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  I confirm this platform merchant and billing location,
                  including replacement of the current connection if shown
                  above.
                </label>
                <button
                  className="btn primary"
                  disabled={busy || !location || !confirmed}
                  onClick={() =>
                    act('billing-confirm-connection', e, {
                      locationId: location,
                      confirm: true,
                    })
                  }
                >
                  Confirm account and billing location
                </button>
              </div>
            )}
            <details>
              <summary>One-time Square setup</summary>
              <p>
                Enter application credentials securely in Netlify project
                configuration → Environment variables, with Functions scope and
                this deployment context. Never paste credentials into chat or
                this page.
              </p>
              {setup?.missing?.length > 0 && (
                <p>Missing OAuth configuration: {setup.missing.join(', ')}</p>
              )}
              {env.missing.length > 0 && (
                <p>
                  Billing configuration still missing: {env.missing.join(', ')}.
                  A confirmed OAuth connection supplies the access token,
                  merchant and location.
                </p>
              )}
              <p>
                Register this exact OAuth callback URL:{' '}
                <code>{setup?.callbackUrl}</code>
              </p>
              <p>
                Register this exact webhook URL:{' '}
                <code>{setup?.webhookUrl}</code>. The deployment supplies this
                URL automatically. An explicit SQUARE_{e.toUpperCase()}
                _WEBHOOK_URL setting overrides it and must match the registered
                URL exactly. Store its signature key as SQUARE_{e.toUpperCase()}
                _WEBHOOK_SIGNATURE_KEY.
              </p>
              <p>Supported webhook events: {setup?.events?.join(', ')}</p>
              <p>
                Sandbox requires a private test deployment. Production plans
                cannot be created here; exact resource approval, policy
                approval, Sandbox acceptance and explicit Production release
                approval remain required.
              </p>
            </details>
          </div>
        )
      })}
      <h3>Plan mappings</h3>
      {data.mappings?.length ? (
        <ul>
          {data.mappings.map((m: AdminMetadata) => (
            <li key={m.environment + m.plan_id}>
              {m.environment} · {m.plan_id} · $
              {(m.amount_cents / 100).toFixed(2)} USD / month · {m.variation_id}
            </li>
          ))}
        </ul>
      ) : (
        <p>No Square plan variations are mapped yet.</p>
      )}
      {message && <p role="alert">{message}</p>}
    </section>
  )
}
