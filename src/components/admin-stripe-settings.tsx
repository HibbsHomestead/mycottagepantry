import { AdminStepUp } from './admin-step-up'
import { useState } from 'react'
import type { AdminMetadata } from '@/lib/platform-admin-types'

type Props = {
  data: AdminMetadata
  request: (query: string, body?: unknown) => Promise<AdminMetadata>
}
export function AdminStripeSettings({ data: initial, request }: Props) {
  const [update, setUpdate] = useState<{
      initial: AdminMetadata
      data: AdminMetadata
    } | null>(null),
    [selectedEnvironment, setEnvironment] = useState<string | null>(null),
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
  const data = update?.initial === initial ? update.data : initial
  const liveRow = data?.rows?.find(
    (r: AdminMetadata) => r.environment === 'live',
  )
  const hasLiveConnection = !!(
    liveRow?.fingerprint ||
    liveRow?.validated_at ||
    data?.connectionErrors?.live
  )
  const environment =
    selectedEnvironment ?? (hasLiveConnection ? 'live' : 'test')
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
      setUpdate({ initial, data: result })
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
  async function refreshStorage() {
    setBusy(true)
    setMessage('')
    try {
      setUpdate({ initial, data: await request('action=stripe') })
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const dt = (v: unknown) =>
    v ? new Date(String(v)).toLocaleString() : 'Not verified'
  function connectionStatus(mode: string) {
    const saved = data?.rows?.find((r: AdminMetadata) => r.environment === mode)
    if (data?.connectionErrors?.[mode])
      return 'Status unavailable. Refresh to retry.'
    if (saved?.configuration?.apiError) return 'Connection test failed'
    if (saved?.validated_at && saved.account_id) return 'Connected'
    if (saved?.fingerprint)
      return 'Credentials saved. Test connection to verify.'
    return 'No account connected'
  }
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
      <div role="status" aria-label="Stripe account connections">
        <p>
          <strong>LIVE Stripe:</strong> {connectionStatus('live')}
        </p>
        <p>
          <strong>TEST Stripe:</strong> {connectionStatus('test')}
        </p>
      </div>
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
            setPrice('')
            setPurchase(false)
          }}
        >
          <option value="test">TEST</option>
          <option value="live">LIVE</option>
        </select>
      </label>
      <p>
        <strong>
          {environment.toUpperCase()} account:{' '}
          {row.account_name || 'No validated account'}
        </strong>{' '}
        · {row.account_id || 'No verified account ID'} ·{' '}
        {row.fingerprint || 'No saved credential'}
      </p>
      {data?.connectionErrors?.[environment] && (
        <p role="alert">
          {environment.toUpperCase()} connection status could not be loaded.
          Refresh connection status to retry. Check the credentials and API
          permissions for this environment if the problem continues.
        </p>
      )}
      {config.setupError && (
        <p role="alert">
          Billing setup is incomplete for {environment.toUpperCase()}. Select
          Set up {environment.toUpperCase()} billing to retry the prices, portal
          and webhook setup.
        </p>
      )}
      {row.validated_at && !config.apiError && (
        <p>
          Account connection is verified. Webhook delivery and new checkout
          availability have separate statuses below.
        </p>
      )}
      <p>
        Credentials configured securely in hosting are connected and set up
        automatically on the trusted deployed site. Set up billing creates the
        approved monthly prices, billing portal and webhook. It does not charge
        customers or enable checkout.
      </p>
      <button
        disabled={busy || !data?.encryptionReady || !row.validated_at}
        onClick={() => act('setup')}
      >
        Set up {environment.toUpperCase()} billing
      </button>
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
      {data?.encryptionReady ? (
        <p role="status">Encrypted credential storage: Ready.</p>
      ) : (
        <p role="alert">
          Hosting encryption setup is required before credentials can be saved.
          No plaintext fallback is available.
        </p>
      )}
      {!data?.encryptionReady && data?.encryptionStatus && (
        <p>
          Storage diagnostic:{' '}
          {data.encryptionStatus.status === 'missing'
            ? 'ROOT_MISSING'
            : data.encryptionStatus.status === 'empty'
              ? 'ROOT_EMPTY'
              : 'ROOT_INVALID_FORMAT'}
        </p>
      )}
      {!data?.encryptionReady &&
        data?.encryptionStatus?.status === 'invalid_format' && (
          <p>
            The hosting encryption key is present but must contain exactly 64
            hexadecimal characters. It is separate from your Stripe API key and
            webhook signing secret. Correct it in this deployment’s hosting
            settings, redeploy, then refresh storage status before entering
            Stripe credentials.
          </p>
        )}
      <button disabled={busy} onClick={refreshStorage}>
        Refresh connection status
      </button>
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
        {data?.apiVersion && (
          <p>
            In your Stripe Sandbox, add a webhook destination for events from
            your account using API version <code>{data.apiVersion}</code>. Use
            snapshot events and select every event listed below.
          </p>
        )}
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
              {tier.monthlyUsd === 0
                ? 'no checkout required'
                : environment === 'live' && !tier.stripeLiveApproved
                  ? 'live tier approval required'
                  : `${environment.toUpperCase()} tier approved`}
              <br />
              <small>
                {tier.monthlyUsd > 0 &&
                  (config.mappings?.[tier.id]?.price ||
                    'Missing validated recurring Price mapping')}
                {tier.monthlyUsd > 0 &&
                  config.mappings?.[tier.id]?.price &&
                  (config.mappings[tier.id].purchase
                    ? ' · mapped purchase enabled; provider activation is separate'
                    : ' · mapped purchase disabled')}
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
            disabled={
              environment === 'live' &&
              !data?.tiers?.find((tier: AdminMetadata) => tier.id === plan)
                ?.stripeLiveApproved
            }
            onChange={(e) => setPurchase(e.target.checked)}
          />{' '}
          Approve {environment.toUpperCase()} purchase availability for this
          mapped tier
        </label>
        <button
          disabled={busy}
          onClick={() => act('map', { plan, price, purchase })}
        >
          Validate and save mapping
        </button>
        {environment === 'live' && plan === 'cottage-mercantile' && (
          <p role="status">
            Cottage Mercantile · $40 USD/month · six total users, including the
            owner: live launch approval is required before mapped live purchases
            can be authorized. This approval does not enable checkout; provider
            activation and completed sandbox evidence remain separate. Public
            visibility and TEST mapping need no further tier approval.
          </p>
        )}
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
