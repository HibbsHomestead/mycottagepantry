import { AdminStepUp } from './admin-step-up'
import { useState } from 'react'
import type { AdminMetadata } from '@/lib/platform-admin-types'

type Props = {
  data: AdminMetadata
  request: (query: string, body?: unknown) => Promise<AdminMetadata>
}
export function AdminStripeSettings({ data: initial, request }: Props) {
  const [data, setData] = useState(initial),
    [environment, setEnvironment] = useState('test'),
    [key, setKey] = useState(''),
    [signing, setSigning] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [plan, setPlan] = useState('cottage-kitchen'),
    [price, setPrice] = useState(''),
    [purchase, setPurchase] = useState(false),
    [portal, setPortal] = useState(''),
    [review, setReview] = useState(''),
    [search, setSearch] = useState('')
  const row =
      data?.rows?.find((r: AdminMetadata) => r.environment === environment) ||
      {},
    config = row.configuration || {},
    evidence =
      data?.evidence?.find((r: AdminMetadata) => r.environment === 'test') || {}
  async function act(operation: string, extra: AdminMetadata = {}) {
    setBusy(true)
    setMessage('')
    try {
      const result = await request('action=stripe', {
        environment,
        operation,
        ...extra,
      })
      setData(result)
      setMessage(
        operation === 'test' &&
          result.rows?.find((r: AdminMetadata) => r.environment === environment)
            ?.configuration?.apiError
          ? 'API connection test failed. Check the account, permissions and environment. New checkout is disabled; existing coverage is preserved.'
          : operation === 'test'
            ? 'API read permissions validated. Checkout and portal write permissions still require real test flows.'
            : 'Saved. Review setup evidence below.',
      )
      if (operation === 'save' || operation === 'rotate') {
        setKey('')
        setSigning('')
      }
      setConfirmation('')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const dt = (v: unknown) =>
    v ? new Date(String(v)).toLocaleString() : 'Not verified'
  const checks = [
    [
      'Test API connection',
      data?.rows?.find((r: AdminMetadata) => r.environment === 'test')
        ?.configuration?.apiError
        ? 'failed'
        : data?.rows?.find((r: AdminMetadata) => r.environment === 'test')
              ?.validated_at
          ? 'verified'
          : 'missing',
    ],
    [
      'Test tier mappings',
      Object.keys(
        data?.rows?.find((r: AdminMetadata) => r.environment === 'test')
          ?.configuration?.mappings || {},
      ).length
        ? 'configured'
        : 'missing',
    ],
    [
      'Test webhook',
      data?.rows?.find((r: AdminMetadata) => r.environment === 'test')
        ?.webhook_verified_at
        ? 'verified'
        : 'not tested',
    ],
    ['Test customer checkout', evidence.checkouts ? 'verified' : 'not tested'],
    ['Correct business access', evidence.access ? 'verified' : 'not tested'],
    [
      'Portal return reconciliation',
      evidence.portal ? 'verified return reconciliation' : 'not tested',
    ],
    [
      'Live credentials',
      data?.rows?.find((r: AdminMetadata) => r.environment === 'live')
        ?.fingerprint
        ? 'configured'
        : 'missing',
    ],
    [
      'Live mappings',
      Object.keys(
        data?.rows?.find((r: AdminMetadata) => r.environment === 'live')
          ?.configuration?.mappings || {},
      ).length
        ? 'configured'
        : 'missing',
    ],
    [
      'Live webhook',
      data?.rows?.find((r: AdminMetadata) => r.environment === 'live')
        ?.webhook_verified_at
        ? 'verified'
        : 'not tested',
    ],
    ['Required policies', config.policy ? 'configured' : 'missing'],
    [
      'Live checkout',
      data?.rows?.find((r: AdminMetadata) => r.environment === 'live')
        ?.checkout_enabled
        ? 'explicitly enabled'
        : 'disabled',
    ],
  ]
  return (
    <section
      className="admin-panel stripe-settings"
      aria-label="Stripe provider settings"
    >
      <h2>Provider settings · Stripe</h2>
      <AdminStepUp request={request} />
      <p>
        Cottage Pantry software subscriptions. Business Square sales connections
        remain separate.
      </p>
      <label>
        Environment
        <select
          value={environment}
          onChange={(e) => {
            setEnvironment(e.target.value)
            setKey('')
            setSigning('')
            setConfirmation('')
            setMessage('')
          }}
        >
          <option value="test">TEST</option>
          <option value="live">LIVE</option>
        </select>
      </label>
      <p>
        <strong>{row.account_name || 'No validated account'}</strong> ·{' '}
        {row.account_id || 'Unconnected'} ·{' '}
        {row.fingerprint || 'No saved credential'}
      </p>
      <p>
        API: {dt(row.validated_at)} · Webhook: {dt(row.webhook_verified_at)} ·
        New checkout: {row.checkout_enabled ? 'Enabled' : 'Disabled'}
      </p>
      {config.apiError && (
        <p role="alert">
          Last API connection test failed. Last successful validation remains
          historical; new checkout is disabled.
        </p>
      )}
      {!data?.encryptionReady && (
        <p role="alert">
          Hosting encryption setup is required before credentials can be saved.
          No plaintext fallback is available.
        </p>
      )}
      <details>
        <summary>Credentials · save or rotate</summary>
        <p>
          Hosted Checkout does not require a publishable key. Enter a secret or
          supported restricted API key and the endpoint signing secret. Existing
          values are never revealed. Rotating clears setup verification and
          disables new checkout.
        </p>
        <label>
          Stripe secret API key
          <input
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <label>
          Webhook signing secret
          <input
            type="password"
            autoComplete="new-password"
            value={signing}
            onChange={(e) => setSigning(e.target.value)}
          />
        </label>
        <p>
          Leave an input empty to retain its saved value. Sign out and
          authenticate again if credential changes require recent
          authentication.
        </p>
      </details>
      <label>
        Action confirmation
        <input
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder={`SAVE ${environment.toUpperCase()}`}
        />
      </label>
      <div className="button-row">
        <button
          disabled={busy || !data?.encryptionReady || (!key && !signing)}
          onClick={() => act('save', { key, signing, confirmation })}
        >
          Save credentials
        </button>
        <button
          disabled={busy || !row.fingerprint || (!key && !signing)}
          onClick={() => act('rotate', { key, signing, confirmation })}
        >
          Rotate credentials
        </button>
        <button disabled={busy || !row.fingerprint} onClick={() => act('test')}>
          Test connection
        </button>
        <button disabled={busy} onClick={() => act('disable')}>
          Disable new checkouts
        </button>
        <button
          disabled={busy}
          onClick={() => act('disconnect', { confirmation })}
        >
          Disconnect
        </button>
      </div>
      <p>
        Rotation confirmation: ROTATE {environment.toUpperCase()}. Disconnect
        confirmation: DISCONNECT {environment.toUpperCase()}. Disconnect blocks
        new checkout and reconciliation. Active subscriptions block
        disconnection. It never cancels external billing or removes verified
        paid coverage.
      </p>
      <details>
        <summary>Webhook setup</summary>
        <label>
          Stable webhook endpoint
          <input readOnly value={data?.endpoints?.[environment] || ''} />
        </label>
        <button
          onClick={() =>
            navigator.clipboard
              .writeText(data?.endpoints?.[environment] || '')
              .then(() => setMessage('Endpoint copied.'))
              .catch(() => setMessage('Select and copy the endpoint manually.'))
          }
        >
          Copy endpoint
        </button>
        <p>
          Create this endpoint in the matching Stripe environment, subscribe to
          these events, then save its signing secret. Send an actual signed
          Stripe test event. Preview test endpoints use a stable preview alias;
          live endpoints always use the production domain. Saving a signing
          secret does not verify delivery. No provider resources are created
          automatically.
        </p>
        <ul>
          {(data?.eventsRequired || []).map((event: string) => (
            <li key={event}>
              <code>{event}</code>
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Tier and recurring Price mappings</summary>
        <p>
          Set Stripe product metadata <code>cottage_pantry_tier</code> to the
          exact tier ID. USD monthly licensed pricing must match the approved
          amount. Existing subscribers retain their linked price.
        </p>
        <p>
          All four paid tiers are approved for test checkout. Cottage Mercantile
          includes five users plus the owner (six total); its live checkout
          remains disabled pending launch review. Internal assignments are
          separate from test purchase approval.
        </p>
        <div className="stripe-tier-list">
          {(data?.tiers || []).map((tier: AdminMetadata) => (
            <p key={tier.id}>
              <strong>{tier.name}</strong> · ${tier.monthlyUsd}/month ·{' '}
              {tier.users === null
                ? 'User allowance unresolved'
                : `${tier.users} users`}{' '}
              · internal {tier.assignable ? 'available' : 'blocked'} ·{' '}
              {config.mappings?.[tier.id]?.purchase
                ? 'purchase approved'
                : 'purchase disabled'}
              <br />
              <small>
                {config.mappings?.[tier.id]?.price || 'Missing mapping'}
              </small>
            </p>
          ))}
        </div>
        <label>
          Tier
          <select value={plan} onChange={(e) => setPlan(e.target.value)}>
            {(data?.tiers || [])
              .filter((t: AdminMetadata) => t.monthlyUsd > 0)
              .map((t: AdminMetadata) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.id})
                </option>
              ))}
          </select>
        </label>
        <label>
          Recurring Price ID
          <input value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={purchase}
            onChange={(e) => setPurchase(e.target.checked)}
          />{' '}
          Approve purchase availability for this mapped tier
        </label>
        <button
          disabled={busy}
          onClick={() => act('map', { plan, price, purchase })}
        >
          Validate and save mapping
        </button>
      </details>
      <details>
        <summary>Required policies and activation review</summary>
        <p>
          Supported policy for explicit approval: no trials; access through
          verified paid coverage only; no additional failed-payment grace; no
          automated downgrades, plan changes or proration. Cancellation requires
          separate review. The portal supports payment details and invoice
          history; plan changes and cancellations must be disabled in its Stripe
          configuration. Other policies remain unresolved and their actions stay
          blocked.
        </p>
        <label>
          Reviewed Stripe portal configuration ID
          <input value={portal} onChange={(e) => setPortal(e.target.value)} />
        </label>
        <button
          disabled={busy}
          onClick={() =>
            act('policy', { portalConfiguration: portal, confirmation })
          }
        >
          Approve policies
        </button>
        <p>
          For test checkout on production, explicitly designate a newly created
          disposable business using an existing Test manual grant. Do not
          designate Hibbs or a live customer for testing. Private previews can
          also test against their own stable webhook alias. Production
          activation checks use evidence recorded in that deployment's database.
        </p>
        <p>
          Type APPROVE POLICIES in Action confirmation to approve these terms.
          Stripe tax configuration and customer-facing billing terms must also
          receive your account review.
        </p>
        <label>
          Live Square subscriber findings and cutover decision
          <textarea
            value={review}
            onChange={(e) => setReview(e.target.value)}
          />
        </label>
        <p>
          Confirm authoritative live provider records. Preserve existing Square
          subscribers and their webhooks. Approval enables only new Stripe
          checkout; no migration or charge is created. Type ENABLE{' '}
          {environment.toUpperCase()} CHECKOUT in Action confirmation.
        </p>
        <button
          disabled={busy}
          onClick={() =>
            act('enable', { confirmation, subscriberReview: review })
          }
        >
          Confirm checkout activation
        </button>
      </details>
      <details open>
        <summary>Setup checklist</summary>
        <dl className="stripe-checklist">
          {checks.map(([name, status]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{status}</dd>
            </div>
          ))}
        </dl>
      </details>
      <details>
        <summary>Billing events and errors</summary>
        <label>
          Search events
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {(data?.events || [])
          .filter((r: AdminMetadata) =>
            JSON.stringify(r).toLowerCase().includes(search.toLowerCase()),
          )
          .map((event: AdminMetadata) => (
            <div className="stripe-event" key={event.id}>
              <strong>{event.kind}</strong>
              <small>
                {event.environment} · {event.id}
              </small>
              <span>
                {event.status} · {event.error_code || 'No processing error'} ·
                attempts {event.attempts}
              </span>
              <small>{dt(event.processed_at || event.received_at)}</small>
              {event.status === 'failed' && (
                <button
                  disabled={busy || event.environment !== environment}
                  onClick={() => act('retry', { eventId: event.id })}
                >
                  Retry reconciliation
                </button>
              )}
            </div>
          ))}
        <p>
          Retries retrieve provider state; they do not create subscriptions or
          charges. Stripe also retries failed deliveries.
        </p>
      </details>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
