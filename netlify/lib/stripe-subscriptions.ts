import { deploymentRuntime } from './runtime-environment'
/* eslint-disable @typescript-eslint/no-explicit-any -- provider JSON is validated before access changes */
import { randomUUID } from 'node:crypto'
import type { AdminClient } from './platform-admin-core'
import { AdminError } from './platform-admin-core'
import {
  RegistrationError,
  type RegistrationActor,
  type RegistrationClient,
} from './registration-core'
import { effectiveAccess, latestManualGrant } from './manual-access'
import { launchPricing, planUserLimit } from '../../src/lib/launch-plans'
import { stripeBillingOwner } from './stripe-billing-owner'
import { stripePlanAvailability } from './stripe-availability'
import {
  publicStripeChange,
  stripeSeatUsage,
  verifiedChangeSchedule,
} from './stripe-changes'
import {
  openStripe,
  stripeRequest,
  stripeSettings,
  stripeEndpoint,
  validatedPrice,
  stripeTierPurchasable,
  stripeCheckoutEnabled,
  stripePortalMatchesPolicy,
  type StripeEnvironment,
} from './stripe-provider'

const customerId = (value: any): string =>
  typeof value === 'string' ? value : value?.id
const owner = stripeBillingOwner
async function checkoutBlock(
  c: RegistrationClient,
  business: string,
  billing: any,
) {
  if (
    billing?.subscription_id &&
    (!['cancelled', 'expired'].includes(billing.status) ||
      (billing.paid_through &&
        Date.parse(String(billing.paid_through)) > Date.now()))
  )
    return {
      code: 'EXISTING_SUBSCRIPTION',
      reason:
        'This business already has linked billing. Use subscription management. If the subscription has ended, wait until its verified paid coverage ends before subscribing again.',
    }
  if (
    (
      await c.query(
        "SELECT 1 FROM billing_subscriptions WHERE business_id=$1 AND status IN ('PENDING','ACTIVE','PAUSED') UNION ALL SELECT 1 FROM billing_attempts WHERE business_id=$1 AND status IN ('checkout_pending','payment_processing','unknown') LIMIT 1",
        [business],
      )
    ).rows.length
  )
    return {
      code: 'SQUARE_BILLING_EXISTS',
      reason:
        'Existing Square subscription or checkout requires support review before Stripe checkout. No additional subscription was created.',
    }
  return null
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
      'SELECT environment,account_id,validated_at,webhook_verified_at,checkout_enabled,configuration FROM stripe_provider_settings',
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
      stripeCheckoutEnabled(r, r.environment) &&
      ((r.environment === 'live' &&
        deploymentRuntime().context === 'production') ||
        (r.environment === 'test' && testAllowed)),
  )
  const { currentSignupSelection } = await import('./signup-plan-intent')
  const signupSelection = await currentSignupSelection(c, actor)
  const changes = (
    await c.query(
      'SELECT * FROM stripe_subscription_changes WHERE business_id=$1 ORDER BY created_at DESC LIMIT 10',
      [member.id],
    )
  ).rows
  const seatUsage = await stripeSeatUsage(c, member.id)
  const subscription = billing?.snapshot?.stripeSubscription || null
  const hasSubscription =
    !!billing?.subscription_id &&
    ['stripe_test', 'stripe_live'].includes(billing.source) &&
    !['canceled', 'incomplete_expired'].includes(billing.provider_status)
  const checkoutBlocked = await checkoutBlock(c, member.id, billing)
  const changeBlockedReason = !hasSubscription
    ? ''
    : subscription?.status !== 'active'
      ? 'Refresh billing and resolve the subscription status in Stripe before changing plans.'
      : subscription?.pendingUpdate
        ? 'Resolve the pending payment update in Stripe and refresh billing before changing plans.'
        : subscription?.cancelAtPeriodEnd
          ? 'Cancellation is scheduled. Resume the subscription before choosing another plan. Cancellations scheduled outside this app require support review.'
          : subscription?.providerSchedule
            ? 'Cancel the pending scheduled change before choosing another plan. Schedules created outside this app require support review.'
            : ''
  return {
    workspace: { id: member.id, name: member.business_name },
    canManage: true,
    hasSubscription,
    checkoutBlockedReason: checkoutBlocked?.reason || '',
    changeBlockedReason,
    subscription,
    seatUsage,
    includedUsers: planUserLimit(access.plan || 'free'),
    changes: changes.map(publicStripeChange),
    changePlans: hasSubscription
      ? stripePlanAvailability(
          settings.find((r) => r.environment === billing.environment),
          billing.environment,
          deploymentRuntime().context === 'production',
          false,
        )
      : [],
    historicalInvoices: (
      await c.query(
        'SELECT environment,status,amount_cents,paid_cents,refunded_cents,service_from,service_through FROM billing_invoices WHERE business_id=$1 ORDER BY service_from DESC NULLS LAST LIMIT 50',
        [member.id],
      )
    ).rows,
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
          nextBillingDate: billing.next_billing_date,
        }
      : null,
    access,
    attempts,
    available: available.map((r) => ({
      environment: r.environment,
      plans: stripePlanAvailability(
        r,
        r.environment,
        deploymentRuntime().context === 'production',
      )
        .filter((p) => p.purchasable)
        .map((p) => p.id),
      tiers: stripePlanAvailability(
        r,
        r.environment,
        deploymentRuntime().context === 'production',
      ),
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
    (e === 'live' && deploymentRuntime().context !== 'production') ||
    !stripeCheckoutEnabled(row, e) ||
    !row.validated_at ||
    row.configuration?.apiError ||
    !row.webhook_verified_at ||
    !row.configuration?.policy ||
    !mapping?.purchase ||
    !mapping?.verifiedAt ||
    mapping?.account !== row.account_id ||
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
  const blocked = await checkoutBlock(c, member.id, billing)
  if (blocked) throw new RegistrationError(409, blocked.code, blocked.reason)
  const usage = await stripeSeatUsage(c, member.id)
  if (usage > planUserLimit(tier.id)!)
    throw new RegistrationError(
      409,
      'SEAT_LIMIT',
      `This business has ${usage} active users. ${tier.name} allows ${planUserLimit(tier.id)} total users, including the owner. Resolve extra memberships with support before subscribing; no users or data were removed.`,
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
    deploymentRuntime().context !== 'production'
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
  const changes = (
    await c.query(
      `SELECT * FROM stripe_subscription_changes WHERE business_id=$1 AND subscription_id=$2 AND environment=$3 AND confirmed_at IS NOT NULL ORDER BY created_at DESC`,
      [attempt.business_id, sub.id, attempt.environment],
    )
  ).rows
  const currentPrice = customerId(item?.price)
  const priceChange = changes.find(
    (change) =>
      change.to_price === currentPrice &&
      ['applying', 'pending', 'scheduled', 'applied'].includes(change.status),
  )
  // Checkout history is immutable. A different recurring Price is accepted only
  // through a durable change authorized for this exact business/subscription.
  if (currentPrice !== attempt.price_id && !priceChange)
    throw new AdminError(
      409,
      'UNREVIEWED_SUBSCRIPTION_PRICE',
      'The subscription Price changed outside the reviewed workflow. Existing access was preserved for review.',
    )
  const currentPlan = priceChange?.to_plan || attempt.plan_id
  if (
    priceChange?.kind === 'downgrade' &&
    Date.parse(priceChange.effective_at) > Date.now() &&
    existing?.plan_id !== currentPlan
  )
    throw new AdminError(
      409,
      'CHANGE_TOO_EARLY',
      'Stripe reported the scheduled lower tier before its approved effective date. Current paid access was preserved for review.',
    )
  if (currentPrice !== attempt.price_id || priceChange)
    await validatedPrice(key, currentPrice, currentPlan, attempt.environment)
  const scheduled = changes.find(
    (change) =>
      change.kind === 'downgrade' &&
      change.status === 'scheduled' &&
      Date.parse(change.effective_at) > Date.now() &&
      sub.schedule,
  )
  if (scheduled) {
    const schedule = await stripeRequest(
      key,
      '/subscription_schedules/' + customerId(sub.schedule),
    )
    if (
      schedule.id !== scheduled.provider_schedule_id ||
      !verifiedChangeSchedule(
        schedule,
        sub,
        scheduled,
        attempt.environment,
        customer,
      )
    )
      throw new RegistrationError(
        409,
        'SCHEDULE_REVIEW_REQUIRED',
        'The scheduled plan differs from the confirmed change and needs support review. Existing verified access was preserved.',
      )
  }
  const monthlyCents =
    launchPricing.plans.find((p) => p.id === currentPlan)!.monthlyUsd * 100
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
  const pendingUpgrade = changes.find(
    (change) =>
      change.kind === 'upgrade' &&
      ['applying', 'pending'].includes(change.status),
  )
  let pendingUpgradeInvoice: string | null = null
  for (const invoice of invoices.data || []) {
    const pendingEvidence =
      pendingUpgrade &&
      invoice.id ===
        (pendingUpgrade.provider_invoice_id ||
          customerId(sub.latest_invoice)) &&
      invoice.billing_reason === 'subscription_update' &&
      invoice.created >= pendingUpgrade.preview.prorationDate - 5
    if (
      (invoice.status !== 'paid' && !pendingEvidence) ||
      invoice.currency !== 'usd' ||
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
        pendingEvidence &&
        price === pendingUpgrade.to_price &&
        line.period?.end === pendingUpgrade.preview.periodEnd
      )
        pendingUpgradeInvoice = invoice.id
      if (invoice.status !== 'paid') continue
      if (
        price === currentPrice &&
        line.period?.end > through &&
        line.period?.start <= Date.now() / 1000 &&
        line.amount >= monthlyCents &&
        invoice.amount_paid >= monthlyCents
      ) {
        from = line.period.start
        through = line.period.end
      }
      // An immediate upgrade pays only the provider-previewed prorated delta.
      // It may extend the already verified tier for the remainder of that paid
      // period, never create a new paid period from a redirect or an open invoice.
      if (
        price === currentPrice &&
        priceChange?.kind === 'upgrade' &&
        priceChange.from_plan === existing?.plan_id &&
        invoice.billing_reason === 'subscription_update' &&
        invoice.id ===
          (priceChange.provider_invoice_id || customerId(sub.latest_invoice)) &&
        invoice.created >= priceChange.preview.prorationDate - 5 &&
        invoice.amount_paid >= priceChange.preview.amountDue &&
        line.period?.start <= Date.now() / 1000 &&
        Date.parse(String(existing.paid_through)) > Date.now()
      ) {
        const coveredThrough = Math.min(
          Date.parse(String(existing.paid_through)) / 1000,
          line.period.end,
          item.current_period_end,
        )
        if (coveredThrough > through) {
          from = Date.parse(String(existing.paid_from)) / 1000
          through = coveredThrough
        }
      }
    }
  }
  // Preserve already verified coverage if it is older than this provider page.
  if (
    existing?.subscription_id === sub.id &&
    (existing.plan_id === currentPlan ||
      (!existing.plan_id && currentPrice === attempt.price_id)) &&
    existing?.paid_through &&
    Date.parse(String(existing.paid_through)) > through * 1000
  ) {
    through = Date.parse(String(existing.paid_through)) / 1000
    from = Date.parse(String(existing.paid_from)) / 1000
  }
  let verifiedPlan = currentPlan,
    verifiedPrice = currentPrice
  if (
    through <= Date.now() / 1000 &&
    existing?.subscription_id === sub.id &&
    existing.plan_id &&
    existing.plan_id !== currentPlan
  ) {
    // Stripe can report a changed item before the corresponding invoice is paid.
    // Keep the previous verified access until its original paid-through date.
    verifiedPlan = existing.plan_id
    verifiedPrice = existing.plan_variation_id
    through = existing.paid_through
      ? Date.parse(String(existing.paid_through)) / 1000
      : 0
    from = existing.paid_from
      ? Date.parse(String(existing.paid_from)) / 1000
      : 0
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
  // The two-phase schedule has fulfilled its reviewed purpose after a paid
  // downgrade. Release it at the new Price so the owner can change plans again
  // without waiting through an unnecessary second billing period.
  if (
    priceChange?.kind === 'downgrade' &&
    sub.schedule &&
    verifiedPlan === priceChange.to_plan &&
    through > Date.now() / 1000
  ) {
    const schedule = await stripeRequest(
      key,
      '/subscription_schedules/' + customerId(sub.schedule),
    )
    if (
      schedule.id !== priceChange.provider_schedule_id ||
      !verifiedChangeSchedule(
        schedule,
        sub,
        priceChange,
        attempt.environment,
        customer,
      )
    )
      throw new RegistrationError(
        409,
        'SCHEDULE_REVIEW_REQUIRED',
        'The effective schedule needs review before it can be released. Existing access was preserved.',
      )
    await stripeRequest(
      key,
      '/subscription_schedules/' + schedule.id + '/release',
      new URLSearchParams({ preserve_cancel_date: 'true' }),
      'cottage-fulfilled-' + priceChange.id,
    )
    const released = await stripeRequest(key, '/subscriptions/' + sub.id)
    if (
      released.id !== sub.id ||
      released.livemode !== sub.livemode ||
      customerId(released.customer) !== customer ||
      released.schedule ||
      customerId(released.items?.data?.[0]?.price) !== currentPrice
    )
      throw new RegistrationError(
        409,
        'SCHEDULE_RELEASE_UNVERIFIED',
        'Refresh billing to verify the completed schedule. No additional subscription was created.',
      )
    sub.schedule = null
  }
  // A new subscription adopts the current policy even on an older Free account.
  // Reconciliation of the same historical subscription retains its saved policy.
  await c.query(
    `INSERT INTO workspace_billing(business_id,plan_id,source,status,subscription_id,customer_id,environment,billing_owner_identity,plan_variation_id,provider_status,paid_from,paid_through,canceled_date,next_billing_date,last_reconciled_at,entitlement_policy)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp(NULLIF($11,0)),to_timestamp(NULLIF($12,0)),$13,$14,NOW(),'kitchen-two-v1') ON CONFLICT(business_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,entitlement_policy=CASE WHEN workspace_billing.subscription_id IS DISTINCT FROM EXCLUDED.subscription_id THEN EXCLUDED.entitlement_policy ELSE workspace_billing.entitlement_policy END,source=EXCLUDED.source,status=EXCLUDED.status,subscription_id=EXCLUDED.subscription_id,customer_id=EXCLUDED.customer_id,environment=EXCLUDED.environment,billing_owner_identity=EXCLUDED.billing_owner_identity,plan_variation_id=EXCLUDED.plan_variation_id,provider_status=EXCLUDED.provider_status,paid_from=EXCLUDED.paid_from,paid_through=EXCLUDED.paid_through,canceled_date=EXCLUDED.canceled_date,next_billing_date=EXCLUDED.next_billing_date,last_reconciled_at=NOW(),updated_at=NOW()`,
    [
      attempt.business_id,
      verifiedPlan,
      'stripe_' + attempt.environment,
      effectiveStatus,
      sub.id,
      customer,
      attempt.environment,
      attempt.identity_id,
      verifiedPrice,
      sub.status,
      from,
      through,
      cancellation ? new Date(cancellation * 1000).toISOString() : null,
      item.current_period_end
        ? new Date(item.current_period_end * 1000).toISOString()
        : null,
    ],
  )
  // Store only provider-verified display data, alongside existing snapshot keys.
  // A selected application plan never supplies the subscription amount/status.
  const providerPrice = item.price || {}
  const snapshot = {
    plan: currentPlan,
    monthlyCents: Number.isSafeInteger(providerPrice.unit_amount)
      ? providerPrice.unit_amount
      : null,
    currency: providerPrice.currency || null,
    interval: providerPrice.recurring?.interval || null,
    intervalCount: providerPrice.recurring?.interval_count || null,
    status: sub.status,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    endsAt: cancellation ? new Date(cancellation * 1000).toISOString() : null,
    renewsAt: item.current_period_end
      ? new Date(item.current_period_end * 1000).toISOString()
      : null,
    pendingUpdate: !!sub.pending_update,
    environment: attempt.environment,
    providerSchedule: !!sub.schedule,
    verifiedAt: new Date().toISOString(),
  }
  await c.query(
    "UPDATE workspace_billing SET snapshot=snapshot || jsonb_build_object('stripeSubscription',$2::jsonb) WHERE business_id=$1",
    [attempt.business_id, JSON.stringify(snapshot)],
  )
  if (
    priceChange &&
    verifiedPlan === priceChange.to_plan &&
    through > Date.now() / 1000
  ) {
    await c.query(
      "UPDATE workspace_billing SET entitlement_policy='kitchen-two-v1' WHERE business_id=$1",
      [attempt.business_id],
    )
  }
  for (const change of changes) {
    if (
      !['applying', 'pending', 'scheduled', 'releasing'].includes(change.status)
    )
      continue
    if (
      change.to_price === currentPrice &&
      verifiedPlan === change.to_plan &&
      through > Date.now() / 1000 &&
      !sub.pending_update
    ) {
      await c.query(
        "UPDATE stripe_subscription_changes SET status='applied',error_code=NULL,updated_at=now() WHERE id=$1 AND business_id=$2",
        [change.id, attempt.business_id],
      )
    } else if (
      change.id === pendingUpgrade?.id &&
      pendingUpgradeInvoice &&
      change.status === 'applying' &&
      sub.pending_update
    ) {
      await c.query(
        "UPDATE stripe_subscription_changes SET status='pending',provider_invoice_id=$2,updated_at=now() WHERE id=$1 AND business_id=$3",
        [change.id, pendingUpgradeInvoice, attempt.business_id],
      )
    } else if (
      change.kind === 'upgrade' &&
      (change.status === 'pending' ||
        (change.status === 'applying' &&
          pendingUpgradeInvoice &&
          change.id === pendingUpgrade?.id)) &&
      !sub.pending_update &&
      currentPrice === change.from_price
    ) {
      await c.query(
        "UPDATE stripe_subscription_changes SET status='failed',error_code='PAYMENT_NOT_COMPLETED',updated_at=now() WHERE id=$1 AND business_id=$2",
        [change.id, attempt.business_id],
      )
    } else if (change.kind === 'cancel' && sub.status === 'canceled') {
      await c.query(
        "UPDATE stripe_subscription_changes SET status='applied',updated_at=now() WHERE id=$1 AND business_id=$2",
        [change.id, attempt.business_id],
      )
    } else if (
      change.kind === 'cancel' &&
      change.status === 'scheduled' &&
      !sub.cancel_at_period_end &&
      Date.parse(change.effective_at) > Date.now()
    ) {
      await c.query(
        "UPDATE stripe_subscription_changes SET status='cancelled',updated_at=now() WHERE id=$1 AND business_id=$2",
        [change.id, attempt.business_id],
      )
    } else if (
      change.kind === 'downgrade' &&
      change.status === 'scheduled' &&
      !sub.schedule &&
      currentPrice === change.from_price &&
      Date.parse(change.effective_at) > Date.now()
    ) {
      await c.query(
        "UPDATE stripe_subscription_changes SET status='cancelled',updated_at=now() WHERE id=$1 AND business_id=$2",
        [change.id, attempt.business_id],
      )
    }
  }
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
    deploymentRuntime().context !== 'production'
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
