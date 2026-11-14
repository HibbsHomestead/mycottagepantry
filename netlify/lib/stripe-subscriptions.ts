/* eslint-disable @typescript-eslint/no-explicit-any -- provider JSON is validated before access changes */
import { randomUUID } from 'node:crypto'
import type { AdminClient } from './platform-admin-core'
import { AdminError } from './platform-admin-core'
import {
  currentMembership,
  RegistrationError,
  type RegistrationActor,
  type RegistrationClient,
} from './registration-core'
import { effectiveAccess, latestManualGrant } from './manual-access'
import { launchPricing } from '../../src/lib/launch-plans'
import {
  openStripe,
  stripeRequest,
  stripeSettings,
  stripeEndpoint,
  validatedPrice,
  stripeTierPurchasable,
  stripePortalMatchesPolicy,
  type StripeEnvironment,
} from './stripe-provider'

const customerId = (value: any): string =>
  typeof value === 'string' ? value : value?.id
async function worker(c: RegistrationClient) {
  await c.query("SELECT set_config('app.billing_worker','true',true)")
}
async function owner(c: RegistrationClient, actor: RegistrationActor) {
  const member = await currentMembership(c, actor)
  if (!member || member.role !== 'Owner')
    throw new RegistrationError(
      403,
      'OWNER_REQUIRED',
      'Only an active business owner can manage its subscription.',
    )
  await worker(c)
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,717))', [
    member.id,
  ])
  return member
}
export async function stripeOwnerView(
  c: RegistrationClient,
  actor: RegistrationActor,
) {
  const member = await owner(c, actor)
  const billing = (
    await c.query('SELECT * FROM workspace_billing WHERE business_id=$1', [
      member.id,
    ])
  ).rows[0]
  const settings = (
    await c.query(
      'SELECT environment,checkout_enabled,configuration FROM stripe_provider_settings',
    )
  ).rows
  const attempts = (
    await c.query(
      'SELECT id,environment,plan_id,status,error_code,created_at,reconciled_at,subscription_id FROM stripe_checkouts WHERE business_id=$1 ORDER BY created_at DESC LIMIT 10',
      [member.id],
    )
  ).rows
  const business = (
    await c.query('SELECT identity_owner FROM businesses WHERE id=$1', [
      member.id,
    ])
  ).rows[0]
  const access = effectiveAccess(
    billing,
    await latestManualGrant(c, member.id),
    business.identity_owner,
  )
  const testAllowed =
    actor.privateTest ||
    (!access.suspended &&
      ((access.manualValid && access.source === 'test') ||
        billing?.source === 'stripe_test'))
  const available = settings.filter(
    (r) =>
      r.checkout_enabled &&
      ((r.environment === 'live' &&
        globalThis.Netlify?.env?.get('CONTEXT') === 'production') ||
        (r.environment === 'test' && testAllowed)),
  )
  const { currentSignupSelection } = await import('./signup-plan-intent')
  const signupSelection = await currentSignupSelection(c, actor)
  return {
    workspace: { id: member.id, name: member.business_name },
    signupSelection,
    billing: billing
      ? {
          plan: billing.plan_id,
          provider: billing.source,
          status: billing.status,
          providerStatus: billing.provider_status,
          paidThrough: billing.paid_through,
          cancellation: billing.canceled_date,
          lastReconciled: billing.last_reconciled_at,
        }
      : null,
    access,
    attempts,
    available: available.map((r) => ({
      environment: r.environment,
      plans: Object.entries(r.configuration.mappings || {})
        .filter(
          ([id, m]: [string, any]) =>
            m.purchase && stripeTierPurchasable(id, r.environment),
        )
        .map(([id]) => id),
    })),
  }
}
export async function stripeCheckout(
  c: RegistrationClient,
  actor: RegistrationActor,
  input: { environment: StripeEnvironment; plan: string; confirmed: boolean },
  prepareOnly = false,
) {
  const member = await owner(c, actor),
    e = input.environment
  const row = await stripeSettings(c, e, true)
  const mapping = row?.configuration?.mappings?.[input.plan]
  const tier = launchPricing.plans.find((p) => p.id === input.plan)
  const billing = (
    await c.query(
      'SELECT * FROM workspace_billing WHERE business_id=$1 FOR UPDATE',
      [member.id],
    )
  ).rows[0]
  let testAllowed = actor.privateTest
  if (e === 'test' && !testAllowed) {
    const business = (
      await c.query('SELECT identity_owner FROM businesses WHERE id=$1', [
        member.id,
      ])
    ).rows[0]
    const resolved = effectiveAccess(
      billing,
      await latestManualGrant(c, member.id),
      business.identity_owner,
    )
    testAllowed =
      !resolved.suspended &&
      ((resolved.manualValid && resolved.source === 'test') ||
        billing?.source === 'stripe_test')
  }
  if (
    !input.confirmed ||
    (e === 'live' &&
      globalThis.Netlify?.env?.get('CONTEXT') !== 'production') ||
    !row?.checkout_enabled ||
    !row.validated_at ||
    row.configuration?.apiError ||
    !row.webhook_verified_at ||
    !row.configuration?.policy ||
    !mapping?.purchase ||
    !tier ||
    !stripeTierPurchasable(input.plan, e) ||
    (e === 'test' && !testAllowed) ||
    !stripeEndpoint(e)
  )
    throw new RegistrationError(
      409,
      'CHECKOUT_DISABLED',
      'This tier or environment is not approved for checkout. Existing business access remains unchanged.',
    )
  if (
    billing?.subscription_id &&
    (!['cancelled', 'expired'].includes(billing.status) ||
      (billing.paid_through && Date.parse(billing.paid_through) > Date.now()))
  )
    throw new RegistrationError(
      409,
      'EXISTING_SUBSCRIPTION',
      'This business already has linked billing. Reconcile it before starting another subscription.',
    )
  if (
    (
      await c.query(
        "SELECT 1 FROM billing_subscriptions WHERE business_id=$1 AND status IN ('PENDING','ACTIVE','PAUSED') UNION ALL SELECT 1 FROM billing_attempts WHERE business_id=$1 AND status IN ('checkout_pending','payment_processing','unknown') LIMIT 1",
        [member.id],
      )
    ).rows.length
  )
    throw new RegistrationError(
      409,
      'SQUARE_BILLING_EXISTS',
      'Existing Square subscription or checkout requires review before Stripe checkout.',
    )
  let attempt = (
    await c.query(
      "SELECT * FROM stripe_checkouts WHERE business_id=$1 AND status IN ('creating','open','complete') FOR UPDATE",
      [member.id],
    )
  ).rows[0]
  const { key } = openStripe(row.ciphertext, e)
  if (attempt) {
    if (attempt.environment !== e || attempt.plan_id !== input.plan)
      throw new RegistrationError(
        409,
        'CHECKOUT_EXISTS',
        'Resume or expire the existing checkout before selecting another tier.',
      )
    if (attempt.session_id) {
      const session = await stripeRequest(
        key,
        '/checkout/sessions/' + attempt.session_id,
      )
      if (session.status === 'open') return { url: session.url }
      if (session.status === 'complete') {
        await reconcileStripeCheckout(c as AdminClient, attempt)
        return { verifying: true }
      }
      await c.query(
        "UPDATE stripe_checkouts SET status='expired',checkout_url=NULL WHERE id=$1",
        [attempt.id],
      )
      attempt = null
    }
  }
  await validatedPrice(key, mapping.price, input.plan, e)
  if (!attempt) {
    const id = randomUUID()
    attempt = (
      await c.query(
        'INSERT INTO stripe_checkouts(id,business_id,identity_id,environment,plan_id,price_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [id, member.id, actor.id, e, input.plan, mapping.price],
      )
    ).rows[0]
  }
  if (prepareOnly) return { prepared: true }
  const returnOrigin = new URL(stripeEndpoint(e)).origin
  const body = new URLSearchParams({
    mode: 'subscription',
    'payment_method_types[0]': 'card',
    'line_items[0][price]': attempt.price_id,
    'line_items[0][quantity]': '1',
    client_reference_id: attempt.id,
    'metadata[attempt_id]': attempt.id,
    'subscription_data[metadata][attempt_id]': attempt.id,
    success_url: returnOrigin + '/oven/billing?checkout=verifying',
    cancel_url: returnOrigin + '/oven/billing?checkout=cancelled',
  })
  // The durable attempt ID survives provider success followed by a lost HTTP response.
  const checkout = await stripeRequest(
    key,
    '/checkout/sessions',
    body,
    'cottage-checkout-' + attempt.id,
  )
  if (
    checkout.livemode !== (e === 'live') ||
    checkout.mode !== 'subscription' ||
    !/^https:\/\/checkout\.stripe\.com\//.test(checkout.url || '')
  )
    throw new RegistrationError(
      502,
      'CHECKOUT_INVALID',
      'Stripe checkout could not be verified.',
    )
  await c.query(
    "UPDATE stripe_checkouts SET session_id=$2,status='open',checkout_url=$3,expires_at=to_timestamp($4) WHERE id=$1",
    [attempt.id, checkout.id, checkout.url, checkout.expires_at],
  )
  return { url: checkout.url }
}
/** Re-fetch current provider objects, never grant access from event/redirect metadata. */
export async function reconcileStripeCheckout(c: AdminClient, attempt: any) {
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,717))', [
    attempt.business_id,
  ])
  if (
    attempt.environment === 'live' &&
    globalThis.Netlify?.env?.get('CONTEXT') !== 'production'
  )
    throw new RegistrationError(
      409,
      'LIVE_CONTEXT_FORBIDDEN',
      'Live billing management is available only on the production site.',
    )
  const row = await stripeSettings(c, attempt.environment),
    { key } = openStripe(row.ciphertext, attempt.environment)
  const session = await stripeRequest(
    key,
    '/checkout/sessions/' + attempt.session_id,
  )
  if (
    session.livemode !== (attempt.environment === 'live') ||
    session.client_reference_id !== attempt.id ||
    session.metadata?.attempt_id !== attempt.id ||
    session.mode !== 'subscription'
  )
    throw new AdminError(
      409,
      'STRIPE_LINK_MISMATCH',
      'Checkout relationship needs review.',
    )
  if (session.status === 'expired') {
    await c.query(
      "UPDATE stripe_checkouts SET status='expired',checkout_url=NULL,reconciled_at=NOW() WHERE id=$1",
      [attempt.id],
    )
    return
  }
  if (session.status !== 'complete' || !session.subscription) return
  const sub = await stripeRequest(
    key,
    '/subscriptions/' + customerId(session.subscription),
  )
  const customer = customerId(sub.customer),
    item = sub.items?.data?.[0]
  if (
    sub.livemode !== (attempt.environment === 'live') ||
    sub.metadata?.attempt_id !== attempt.id ||
    customer !== customerId(session.customer) ||
    sub.items?.data?.length !== 1 ||
    customerId(item?.price) !== attempt.price_id ||
    item.quantity !== 1 ||
    (attempt.subscription_id && attempt.subscription_id !== sub.id) ||
    (attempt.customer_id && attempt.customer_id !== customer)
  )
    throw new AdminError(
      409,
      'STRIPE_LINK_MISMATCH',
      'Subscription relationship needs review.',
    )
  const existing = (
    await c.query(
      'SELECT * FROM workspace_billing WHERE business_id=$1 FOR UPDATE',
      [attempt.business_id],
    )
  ).rows[0]
  if (
    existing?.subscription_id &&
    existing.subscription_id !== sub.id &&
    !(
      existing.status === 'cancelled' &&
      (!existing.paid_through ||
        Date.parse(String(existing.paid_through)) <= Date.now())
    )
  )
    throw new AdminError(
      409,
      'BILLING_CONFLICT',
      'Another subscription is linked to this business. Access was preserved for review.',
    )
  // List invoices rather than assuming latest_invoice is paid: a renewal can fail
  // while an earlier paid period is still valid. A subscription-created event is insufficient.
  const invoices = await stripeRequest(
    key,
    '/invoices?subscription=' + sub.id + '&limit=100',
  )
  let from = 0,
    through = 0
  for (const invoice of invoices.data || []) {
    if (
      invoice.status !== 'paid' ||
      invoice.currency !== 'usd' ||
      invoice.amount_paid <
        launchPricing.plans.find((p) => p.id === attempt.plan_id)!.monthlyUsd *
          100 ||
      customerId(invoice.customer) !== customer
    )
      continue
    const lines = await stripeRequest(
      key,
      '/invoices/' + invoice.id + '/lines?limit=100',
    )
    if (lines.has_more)
      throw new AdminError(
        409,
        'INVOICE_REVIEW',
        'Invoice contains too many lines for automatic coverage review.',
      )
    for (const line of lines.data || []) {
      const price = line.pricing?.price_details?.price || line.price?.id
      if (
        price === attempt.price_id &&
        line.period?.end > through &&
        line.period?.start <= Date.now() / 1000 &&
        line.amount >=
          launchPricing.plans.find((p) => p.id === attempt.plan_id)!
            .monthlyUsd *
            100
      ) {
        from = line.period.start
        through = line.period.end
      }
    }
  }
  // Preserve already verified coverage if it is older than this provider page.
  if (
    existing?.subscription_id === sub.id &&
    existing?.paid_through &&
    Date.parse(String(existing.paid_through)) > through * 1000
  ) {
    through = Date.parse(String(existing.paid_through)) / 1000
    from = Date.parse(String(existing.paid_from)) / 1000
  }
  const status =
    sub.status === 'canceled'
      ? 'cancelled'
      : through > Date.now() / 1000
        ? sub.status === 'past_due'
          ? 'past_due'
          : 'paid_active'
        : ['past_due', 'unpaid'].includes(sub.status)
          ? 'payment_failed'
          : 'payment_processing'
  const cancellation = sub.cancel_at_period_end
    ? item.current_period_end
    : sub.cancel_at || sub.canceled_at || null
  // Suspension is independent of billing reconciliation.
  const effectiveStatus =
    existing &&
    ['suspended', 'security_suspended', 'disabled'].includes(existing.status)
      ? existing.status
      : status
  await c.query(
    `INSERT INTO workspace_billing(business_id,plan_id,source,status,subscription_id,customer_id,environment,billing_owner_identity,plan_variation_id,provider_status,paid_from,paid_through,canceled_date,next_billing_date,last_reconciled_at,entitlement_policy)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp(NULLIF($11,0)),to_timestamp(NULLIF($12,0)),$13,$14,NOW(),'kitchen-two-v1') ON CONFLICT(business_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,source=EXCLUDED.source,status=EXCLUDED.status,subscription_id=EXCLUDED.subscription_id,customer_id=EXCLUDED.customer_id,environment=EXCLUDED.environment,billing_owner_identity=EXCLUDED.billing_owner_identity,plan_variation_id=EXCLUDED.plan_variation_id,provider_status=EXCLUDED.provider_status,paid_from=EXCLUDED.paid_from,paid_through=EXCLUDED.paid_through,canceled_date=EXCLUDED.canceled_date,next_billing_date=EXCLUDED.next_billing_date,last_reconciled_at=NOW(),updated_at=NOW()`,
    [
      attempt.business_id,
      attempt.plan_id,
      'stripe_' + attempt.environment,
      effectiveStatus,
      sub.id,
      customer,
      attempt.environment,
      attempt.identity_id,
      attempt.price_id,
      sub.status,
      from,
      through,
      cancellation ? new Date(cancellation * 1000).toISOString() : null,
      item.current_period_end
        ? new Date(item.current_period_end * 1000).toISOString()
        : null,
    ],
  )
  await c.query(
    'UPDATE stripe_checkouts SET status=$2,subscription_id=$3,customer_id=$4,reconciled_at=NOW(),error_code=NULL,access_verified_at=CASE WHEN $5 THEN NOW() ELSE access_verified_at END WHERE id=$1',
    [
      attempt.id,
      sub.status === 'canceled' ? 'cancelled' : 'complete',
      sub.id,
      customer,
      through > Date.now() / 1000 && effectiveStatus === status,
    ],
  )
}
export async function stripeRefresh(
  c: RegistrationClient,
  actor: RegistrationActor,
) {
  const member = await owner(c, actor)
  const attempts = (
    await c.query(
      "SELECT * FROM stripe_checkouts WHERE business_id=$1 AND session_id IS NOT NULL AND status IN ('open','complete','cancelled') ORDER BY created_at DESC LIMIT 1",
      [member.id],
    )
  ).rows
  for (const attempt of attempts)
    await reconcileStripeCheckout(c as AdminClient, attempt)
  return stripeOwnerView(c, actor)
}
export async function stripePortal(
  c: RegistrationClient,
  actor: RegistrationActor,
) {
  const member = await owner(c, actor)
  const attempt = (
    await c.query(
      'SELECT * FROM stripe_checkouts WHERE business_id=$1 AND customer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      [member.id],
    )
  ).rows[0]
  if (!attempt)
    throw new RegistrationError(
      409,
      'NO_STRIPE_BILLING',
      'This business has no linked Stripe customer.',
    )
  if (
    attempt.environment === 'live' &&
    globalThis.Netlify?.env?.get('CONTEXT') !== 'production'
  )
    throw new RegistrationError(
      409,
      'LIVE_CONTEXT_FORBIDDEN',
      'Live billing management is available only on the production site.',
    )
  const row = await stripeSettings(c, attempt.environment),
    { key } = openStripe(row.ciphertext, attempt.environment)
  const id = row.configuration?.policy?.portal
  if (!id)
    throw new RegistrationError(
      409,
      'PORTAL_POLICY_REQUIRED',
      'A reviewed billing portal configuration is required.',
    )
  const configuration = await stripeRequest(
    key,
    '/billing_portal/configurations/' + id,
  )
  if (!stripePortalMatchesPolicy(configuration, attempt.environment))
    throw new RegistrationError(
      409,
      'PORTAL_POLICY_CHANGED',
      'Portal actions changed. An administrator must review the configuration.',
    )
  const session = await stripeRequest(
    key,
    '/billing_portal/sessions',
    new URLSearchParams({
      customer: attempt.customer_id,
      configuration: id,
      return_url:
        new URL(stripeEndpoint(attempt.environment)).origin +
        '/oven/billing?checkout=verifying',
    }),
  )
  if (!/^https:\/\/billing\.stripe\.com\//.test(session.url || ''))
    throw new RegistrationError(
      502,
      'PORTAL_INVALID',
      'The billing portal destination is invalid.',
    )
  await c.query(
    'UPDATE stripe_checkouts SET portal_launched_at=NOW() WHERE id=$1',
    [attempt.id],
  )
  return { url: session.url }
}
export async function processStripeEvent(c: AdminClient, event: any) {
  const row = await stripeSettings(c, event.environment),
    { key } = openStripe(row.ciphertext, event.environment)
  const current = await stripeRequest(key, '/events/' + event.id)
  if (
    current.livemode !== (event.environment === 'live') ||
    current.type !== event.kind
  )
    throw new AdminError(
      409,
      'EVENT_MISMATCH',
      'Event environment or kind does not match.',
    )
  const object = current.data?.object
  let sessionId: string | undefined, subscriptionId: string | undefined
  if (event.kind.startsWith('checkout.session.')) sessionId = object.id
  else if (event.kind.startsWith('customer.subscription.'))
    subscriptionId = object.id
  else if (event.kind.startsWith('invoice.'))
    subscriptionId = customerId(
      object.parent?.subscription_details?.subscription || object.subscription,
    )
  let attempts = (
    await c.query(
      'SELECT * FROM stripe_checkouts WHERE environment=$1 AND (session_id=$2 OR subscription_id=$3) ORDER BY created_at DESC',
      [event.environment, sessionId || null, subscriptionId || null],
    )
  ).rows
  // Subscription events may arrive before checkout completion; retrieve sessions
  // with a server-owned pending attempt and reconcile only an exact session match.
  if (!attempts.length && subscriptionId) {
    const sessions = await stripeRequest(
      key,
      '/checkout/sessions?subscription=' + subscriptionId + '&limit=10',
    )
    const ids = (sessions.data || []).map((s: any) => s.id)
    attempts = (
      await c.query(
        'SELECT * FROM stripe_checkouts WHERE environment=$1 AND session_id=ANY($2::text[])',
        [event.environment, ids],
      )
    ).rows
  }
  if (!attempts.length && (sessionId || subscriptionId)) {
    const sessions = sessionId
      ? [await stripeRequest(key, '/checkout/sessions/' + sessionId)]
      : (
          await stripeRequest(
            key,
            '/checkout/sessions?subscription=' + subscriptionId + '&limit=10',
          )
        ).data || []
    for (const session of sessions) {
      // Recover provider success followed by a lost DB write. The reservation was
      // committed before checkout creation; no client-supplied business ID is used.
      if (
        session.livemode !== (event.environment === 'live') ||
        session.mode !== 'subscription' ||
        session.metadata?.attempt_id !== session.client_reference_id
      )
        continue
      const reserved = (
        await c.query(
          "SELECT * FROM stripe_checkouts WHERE id::text=$1 AND environment=$2 AND session_id IS NULL AND status='creating' FOR UPDATE",
          [session.client_reference_id, event.environment],
        )
      ).rows[0]
      if (!reserved) continue
      await c.query('UPDATE stripe_checkouts SET session_id=$2 WHERE id=$1', [
        reserved.id,
        session.id,
      ])
      attempts.push({ ...reserved, session_id: session.id })
    }
  }
  if ((sessionId || subscriptionId) && !attempts.length)
    throw new AdminError(
      409,
      'UNLINKED_EVENT',
      'No trusted checkout relationship exists. Review before retrying.',
    )
  for (const attempt of attempts) await reconcileStripeCheckout(c, attempt)
  await c.query(
    "UPDATE stripe_events SET status='processed',attempts=attempts+1,error_code=NULL,processed_at=NOW() WHERE id=$1",
    [event.id],
  )
}
