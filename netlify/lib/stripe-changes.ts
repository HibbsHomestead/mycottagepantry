/* eslint-disable @typescript-eslint/no-explicit-any -- Stripe objects are checked against server-owned subscription links */
import { randomUUID, createHash } from 'node:crypto'
import {
  launchPricing,
  planUserLimit,
  planIncludes,
  launchFeatures,
  type PlanId,
} from '../../src/lib/launch-plans'
import { subscriptionChangePolicy } from '../../src/lib/plan-presentation'
import { legacyPlanIncludes } from './legacy-plan-scope'
import {
  RegistrationError,
  type RegistrationClient,
  type RegistrationActor,
} from './registration-core'
import { deploymentRuntime } from './runtime-environment'
import { stripeBillingOwner } from './stripe-billing-owner'
import { stripePlanAvailability } from './stripe-availability'
import {
  openStripe,
  stripeSettings,
  stripeRequest,
  validatedPrice,
  type StripeEnvironment,
} from './stripe-provider'

export const stripeObjectId = (v: any): string =>
  typeof v === 'string' ? v : v?.id
function fail(code: string, message: string): never {
  throw new RegistrationError(409, code, message)
}
const iso = (seconds: number) => new Date(seconds * 1000).toISOString()
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex')
const fingerprint = (sub: any) =>
  hash({
    id: sub.id,
    price: stripeObjectId(sub.items.data[0].price),
    item: sub.items.data[0].id,
    start: sub.items.data[0].current_period_start,
    end: sub.items.data[0].current_period_end,
    schedule: stripeObjectId(sub.schedule),
    cancel: sub.cancel_at_period_end,
    invoice: stripeObjectId(sub.latest_invoice),
    discounts: sub.discounts,
    tax: sub.automatic_tax,
  })

export async function stripeChangeContext(
  c: RegistrationClient,
  actor: RegistrationActor,
) {
  const member = await stripeBillingOwner(c, actor)
  const billing = (
    await c.query(
      'SELECT * FROM workspace_billing WHERE business_id=$1 FOR UPDATE',
      [member.id],
    )
  ).rows[0]
  if (
    !billing?.subscription_id ||
    !['stripe_test', 'stripe_live'].includes(billing.source)
  )
    fail(
      'NO_SUBSCRIPTION',
      'Refresh verified billing first. This business has no verified Stripe subscription to change.',
    )
  const environment = billing.environment as StripeEnvironment
  if (
    !['test', 'live'].includes(environment) ||
    billing.source !== 'stripe_' + environment
  )
    fail('BILLING_LINK', 'The subscription environment needs review.')
  if (environment === 'live' && deploymentRuntime().context !== 'production')
    fail(
      'LIVE_CONTEXT_FORBIDDEN',
      'LIVE subscription management is available only on the production site.',
    )
  const attempt = (
    await c.query(
      'SELECT * FROM stripe_checkouts WHERE business_id=$1 AND subscription_id=$2 AND environment=$3',
      [member.id, billing.subscription_id, environment],
    )
  ).rows[0]
  if (!attempt?.customer_id || attempt.customer_id !== billing.customer_id)
    fail(
      'BILLING_LINK',
      'A verified business subscription relationship is required.',
    )
  const settings = await stripeSettings(c, environment)
  if (
    !settings?.ciphertext ||
    !settings.validated_at ||
    settings.configuration?.apiError
  )
    fail(
      'STRIPE_VERIFICATION_REQUIRED',
      'The Stripe connection needs verification. Existing access is preserved.',
    )
  const { key } = openStripe(settings.ciphertext, environment)
  const sub = await stripeRequest(
    key,
    '/subscriptions/' + billing.subscription_id,
  )
  if (
    sub.id !== billing.subscription_id ||
    sub.livemode !== (environment === 'live') ||
    stripeObjectId(sub.customer) !== billing.customer_id ||
    sub.metadata?.attempt_id !== attempt.id ||
    sub.items?.data?.length !== 1 ||
    sub.items.data[0].quantity !== 1
  )
    fail(
      'BILLING_LINK',
      'Subscription ownership could not be verified. No change was made.',
    )
  return {
    member,
    billing,
    attempt,
    settings,
    key,
    sub,
    environment,
    item: sub.items.data[0],
  }
}

export async function stripeSeatUsage(c: RegistrationClient, business: string) {
  const row = (
    await c.query(
      'SELECT count(*)::int AS count FROM users WHERE business_id=$1 AND active=true',
      [business],
    )
  ).rows[0]
  return Number(row?.count || 0)
}

async function requireSeats(
  c: RegistrationClient,
  business: string,
  plan: PlanId,
) {
  const count = await stripeSeatUsage(c, business),
    limit = planUserLimit(plan)!
  if (count > limit)
    fail(
      'SEAT_LIMIT',
      `This business has ${count} active users. The selected plan allows ${limit} total ${limit === 1 ? 'user' : 'users'}, including the owner. Resolve the extra memberships with support before changing plans; invitations and member administration are not available in the app. No users or data were removed.`,
    )
  return count
}

async function providerPreview(
  key: string,
  sub: any,
  price: string,
  prorationDate: number,
) {
  const invoice = await stripeRequest(
    key,
    '/invoices/create_preview',
    new URLSearchParams({
      subscription: sub.id,
      'subscription_details[items][0][id]': sub.items.data[0].id,
      'subscription_details[items][0][price]': price,
      'subscription_details[items][0][quantity]': '1',
      'subscription_details[proration_behavior]': 'always_invoice',
      'subscription_details[proration_date]': String(prorationDate),
    }),
  )
  if (
    invoice.currency !== 'usd' ||
    !Number.isSafeInteger(invoice.amount_due) ||
    !Number.isSafeInteger(invoice.total) ||
    invoice.livemode !== sub.livemode
  )
    fail(
      'PREVIEW_UNVERIFIED',
      'Stripe did not return a verified USD change preview. No change was made.',
    )
  return {
    amountDue: invoice.amount_due,
    total: invoice.total,
    currency: invoice.currency,
    credit: Math.max(0, -invoice.total),
  }
}

async function ownedSchedule(
  key: string,
  sub: any,
  change: any,
  environment: StripeEnvironment,
  customer: string,
) {
  let schedule = sub.schedule
    ? await stripeRequest(
        key,
        '/subscription_schedules/' + stripeObjectId(sub.schedule),
      )
    : null
  if (!schedule || schedule.metadata?.cottage_change_id !== change.id) {
    if (
      schedule?.metadata?.cottage_change_id ||
      Date.now() - Date.parse(change.confirmed_at) > 23 * 3600000
    )
      fail(
        'SCHEDULE_CONFLICT',
        'The schedule relationship needs support review before changing it.',
      )
    // from_subscription cannot be combined with other creation parameters.
    // Recover an untagged schedule from a lost response using the committed
    // operation's original idempotency key, then tag it in the update call.
    const recovered = await stripeRequest(
      key,
      '/subscription_schedules',
      new URLSearchParams({ from_subscription: sub.id }),
      'cottage-schedule-' + change.id,
    )
    if (schedule && recovered.id !== schedule.id)
      fail(
        'SCHEDULE_CONFLICT',
        'A different schedule is attached. No schedule was changed.',
      )
    schedule = recovered
  }
  if (
    schedule.livemode !== (environment === 'live') ||
    stripeObjectId(schedule.subscription) !== sub.id ||
    stripeObjectId(schedule.customer) !== customer
  )
    fail('SCHEDULE_CONFLICT', 'Schedule ownership could not be verified.')
  return schedule
}

export function verifiedChangeSchedule(
  schedule: any,
  sub: any,
  change: any,
  environment: StripeEnvironment,
  customer: string,
) {
  const current = schedule.phases?.find(
    (p: any) =>
      p.end_date === change.preview.periodEnd &&
      stripeObjectId(p.items?.[0]?.price) === change.from_price,
  )
  const next = schedule.phases?.find(
    (p: any) => p.start_date === change.preview.periodEnd,
  )
  return (
    schedule.livemode === (environment === 'live') &&
    stripeObjectId(schedule.subscription) === sub.id &&
    stripeObjectId(schedule.customer) === customer &&
    schedule.metadata?.cottage_change_id === change.id &&
    schedule.end_behavior === 'release' &&
    schedule.phases?.length === 2 &&
    current?.items?.length === 1 &&
    current.items[0].quantity === 1 &&
    next?.items?.length === 1 &&
    next.items[0].quantity === 1 &&
    stripeObjectId(next.items[0].price) === change.to_price &&
    next.end_date > next.start_date
  )
}

export async function stripeChangePreview(
  c: RegistrationClient,
  actor: RegistrationActor,
  toPlan: string,
) {
  const context = await stripeChangeContext(c, actor)
  const { member, billing, environment, settings, sub, item, key } = context
  const target = launchPricing.plans.find((p) => p.id === toPlan)
  const current = launchPricing.plans.find((p) => p.id === billing.plan_id)
  if (!target || !current || target.id === current.id)
    fail('PLAN_REQUIRED', 'Choose a different listed plan.')
  if (
    sub.status !== 'active' ||
    sub.pending_update ||
    sub.cancel_at_period_end ||
    sub.cancel_at ||
    sub.pause_collection ||
    sub.schedule ||
    stripeObjectId(item.price) !== billing.plan_variation_id
  )
    fail(
      'CHANGE_NOT_READY',
      'Resolve pending payment, cancellation or scheduled changes and refresh billing before changing plans.',
    )
  if (
    (
      await c.query(
        "SELECT id FROM stripe_subscription_changes WHERE business_id=$1 AND status IN ('applying','pending','scheduled','releasing')",
        [member.id],
      )
    ).rows.length
  )
    fail(
      'CHANGE_PENDING',
      'A subscription change is already pending. Refresh billing or cancel the scheduled change first.',
    )
  const seatUsage = await requireSeats(c, member.id, target.id)
  const kind =
    target.id === 'free'
      ? 'cancel'
      : target.monthlyUsd > current.monthlyUsd
        ? 'upgrade'
        : 'downgrade'
  const mapping = settings.configuration?.mappings?.[target.id]
  if (target.id !== 'free') {
    const availability = stripePlanAvailability(
      settings,
      environment,
      deploymentRuntime().context === 'production',
      false,
    ).find((p) => p.id === target.id)!
    if (!availability.purchasable) fail('PLAN_UNAVAILABLE', availability.reason)
    await validatedPrice(key, mapping?.price, target.id, environment)
  }
  if (
    !Number.isInteger(item.current_period_end) ||
    item.current_period_end <= Date.now() / 1000
  )
    fail(
      'PERIOD_UNVERIFIED',
      'Refresh billing to verify the next renewal before changing plans.',
    )
  // Schedules must preserve the current subscription's terms. Unsupported custom
  // terms are rejected rather than rebuilt with guessed defaults.
  if (
    kind === 'downgrade' &&
    (sub.trial_end ||
      sub.billing_mode?.type === 'flexible' ||
      sub.pending_invoice_item_interval ||
      sub.billing_thresholds ||
      item.billing_thresholds)
  )
    fail(
      'CUSTOM_TERMS',
      'This subscription has custom billing terms that require support review before a scheduled downgrade.',
    )
  const prorationDate = Math.floor(Date.now() / 1000)
  const amounts =
    kind === 'upgrade'
      ? await providerPreview(key, sub, mapping.price, prorationDate)
      : { amountDue: 0, total: 0, currency: 'usd', credit: 0 }
  const currentlyIncludes = (feature: (typeof launchFeatures)[number]['id']) =>
    billing.entitlement_policy === 'legacy'
      ? legacyPlanIncludes(current.id, feature)
      : planIncludes(current.id, feature)
  const preview = {
    ...amounts,
    policy: subscriptionChangePolicy.version,
    fingerprint: fingerprint(sub),
    prorationDate,
    periodEnd: item.current_period_end,
    fromUsers:
      billing.entitlement_policy === 'legacy'
        ? null
        : planUserLimit(current.id),
    toUsers: planUserLimit(target.id),
    seatUsage,
    fromMonthlyCents: current.monthlyUsd * 100,
    toMonthlyCents: target.monthlyUsd * 100,
    added: launchFeatures
      .filter((f) => !currentlyIncludes(f.id) && planIncludes(target.id, f.id))
      .map((f) => f.id),
    removed: launchFeatures
      .filter((f) => currentlyIncludes(f.id) && !planIncludes(target.id, f.id))
      .map((f) => f.id),
    effectiveAt:
      kind === 'upgrade' ? iso(prorationDate) : iso(item.current_period_end),
    timing:
      kind === 'upgrade'
        ? subscriptionChangePolicy.upgrade
        : subscriptionChangePolicy.downgrade,
  }
  const change = (
    await c.query(
      `INSERT INTO stripe_subscription_changes(id,business_id,identity_id,environment,subscription_id,from_plan,to_plan,from_price,to_price,kind,preview,effective_at,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+interval '10 minutes') RETURNING *`,
      [
        randomUUID(),
        member.id,
        actor.id,
        environment,
        sub.id,
        current.id,
        target.id,
        stripeObjectId(item.price),
        target.id === 'free' ? null : mapping.price,
        kind,
        preview,
        preview.effectiveAt,
      ],
    )
  ).rows[0]
  return { preview: publicStripeChange(change) }
}

export function publicStripeChange(change: any) {
  return {
    id: change.id,
    fromPlan: change.from_plan,
    toPlan: change.to_plan,
    kind: change.kind,
    status: change.status,
    effectiveAt: change.effective_at,
    expiresAt: change.expires_at,
    errorCode: change.error_code,
    ...Object.fromEntries(
      Object.entries(change.preview || {}).filter(
        ([key]) => !['fingerprint'].includes(key),
      ),
    ),
  }
}

/** Reserve in a separate committed transaction before any provider mutation. */
export async function stripeConfirmChange(
  c: RegistrationClient,
  actor: RegistrationActor,
  id: string,
  prepareOnly = false,
) {
  const context = await stripeChangeContext(c, actor)
  const { member, billing, sub, item, key, environment, settings } = context
  const change = (
    await c.query(
      'SELECT * FROM stripe_subscription_changes WHERE id=$1 AND business_id=$2 AND subscription_id=$3 AND environment=$4 FOR UPDATE',
      [id, member.id, sub.id, environment],
    )
  ).rows[0]
  if (!change || change.identity_id !== actor.id)
    fail(
      'CHANGE_NOT_FOUND',
      'This change is unavailable for this business owner.',
    )
  if (['scheduled', 'pending', 'applied'].includes(change.status))
    return { change: publicStripeChange(change) }
  if (!['previewed', 'applying'].includes(change.status))
    fail(
      'CHANGE_NOT_READY',
      'This preview is no longer available. Refresh billing and review a new preview.',
    )
  await requireSeats(c, member.id, change.to_plan)
  if (change.status === 'previewed') {
    if (
      Date.parse(change.expires_at) <= Date.now() ||
      fingerprint(sub) !== change.preview.fingerprint ||
      sub.status !== 'active' ||
      sub.pending_update ||
      sub.schedule ||
      sub.cancel_at_period_end ||
      sub.cancel_at ||
      sub.pause_collection
    )
      fail(
        'PREVIEW_EXPIRED',
        'Billing changed or the preview expired. Review a new provider preview before confirming.',
      )
    if (
      (
        await c.query(
          "SELECT id FROM stripe_subscription_changes WHERE business_id=$1 AND status IN ('applying','pending','scheduled','releasing')",
          [member.id],
        )
      ).rows.length
    )
      fail(
        'CHANGE_PENDING',
        'Another subscription change is pending. Refresh billing first.',
      )
    if (change.to_plan !== 'free') {
      const availability = stripePlanAvailability(
        settings,
        environment,
        deploymentRuntime().context === 'production',
        false,
      ).find((p) => p.id === change.to_plan)
      if (
        !availability?.purchasable ||
        settings.configuration.mappings[change.to_plan]?.price !==
          change.to_price
      )
        fail(
          'PLAN_UNAVAILABLE',
          'Purchase availability or the Price mapping changed. Review a new preview.',
        )
      await validatedPrice(key, change.to_price, change.to_plan, environment)
    }
    if (change.kind === 'upgrade') {
      const latest = await providerPreview(
        key,
        sub,
        change.to_price,
        change.preview.prorationDate,
      )
      if (
        latest.amountDue !== change.preview.amountDue ||
        latest.total !== change.preview.total
      )
        fail(
          'PREVIEW_CHANGED',
          'Stripe changed the amount due. Review a new preview before confirming.',
        )
    }
    await c.query(
      "UPDATE stripe_subscription_changes SET status='applying',confirmed_at=now(),updated_at=now() WHERE id=$1",
      [id],
    )
    change.status = 'applying'
    change.confirmed_at = new Date()
  }
  if (prepareOnly) return { prepared: true }
  // An applying reservation can outlive a lost response. Never charge again after
  // Stripe's idempotency window; reconcile the provider result or require review.
  if (Date.now() - Date.parse(change.confirmed_at) > 23 * 3600000)
    fail(
      'CHANGE_REVIEW_REQUIRED',
      'This pending request needs support reconciliation before retrying. No additional payment was attempted.',
    )
  if (change.kind === 'upgrade') {
    if (stripeObjectId(item.price) === change.to_price || sub.pending_update)
      return { verifying: true }
    if (fingerprint(sub) !== change.preview.fingerprint)
      fail(
        'CHANGE_REVIEW_REQUIRED',
        'The subscription changed while confirmation was pending. Refresh billing; no additional change was attempted.',
      )
    const updated = await stripeRequest(
      key,
      '/subscriptions/' + sub.id,
      new URLSearchParams({
        'items[0][id]': item.id,
        'items[0][price]': change.to_price,
        'items[0][quantity]': '1',
        proration_behavior: 'always_invoice',
        proration_date: String(change.preview.prorationDate),
        payment_behavior: 'pending_if_incomplete',
      }),
      'cottage-change-' + id,
    )
    if (
      updated.id !== sub.id ||
      updated.livemode !== (environment === 'live') ||
      stripeObjectId(updated.customer) !== billing.customer_id
    )
      fail(
        'CHANGE_UNVERIFIED',
        'Refresh billing to verify the provider result. No success has been assumed.',
      )
    await c.query(
      "UPDATE stripe_subscription_changes SET status='pending',provider_invoice_id=$2,updated_at=now() WHERE id=$1",
      [id, stripeObjectId(updated.latest_invoice) || null],
    )
  } else if (change.kind === 'cancel') {
    if (!sub.cancel_at_period_end) {
      if (fingerprint(sub) !== change.preview.fingerprint)
        fail(
          'CHANGE_REVIEW_REQUIRED',
          'The subscription changed. Refresh billing before retrying.',
        )
      await stripeRequest(
        key,
        '/subscriptions/' + sub.id,
        new URLSearchParams({ cancel_at_period_end: 'true' }),
        'cottage-change-' + id,
      )
    }
    const verified = await stripeRequest(key, '/subscriptions/' + sub.id)
    if (
      !verified.cancel_at_period_end ||
      verified.id !== sub.id ||
      verified.livemode !== (environment === 'live')
    )
      fail(
        'CHANGE_UNVERIFIED',
        'Cancellation is not yet verified. Refresh billing before retrying.',
      )
    await c.query(
      "UPDATE stripe_subscription_changes SET status='scheduled',updated_at=now() WHERE id=$1",
      [id],
    )
  } else {
    if (!sub.schedule && fingerprint(sub) !== change.preview.fingerprint)
      fail(
        'CHANGE_REVIEW_REQUIRED',
        'The subscription changed. Refresh billing before retrying.',
      )
    const schedule = await ownedSchedule(
      key,
      sub,
      change,
      environment,
      billing.customer_id,
    )
    if (
      verifiedChangeSchedule(
        schedule,
        sub,
        change,
        environment,
        billing.customer_id,
      )
    ) {
      await c.query(
        "UPDATE stripe_subscription_changes SET status='scheduled',provider_schedule_id=$2,updated_at=now() WHERE id=$1",
        [id, schedule.id],
      )
      return { verifying: true }
    }
    const body = new URLSearchParams({
      end_behavior: 'release',
      proration_behavior: 'none',
      'metadata[cottage_change_id]': id,
    })
    const phase = schedule.phases?.find(
      (p: any) => p.start_date === schedule.current_phase?.start_date,
    )
    if (
      !phase ||
      phase.end_date !== change.preview.periodEnd ||
      phase.add_invoice_items?.length ||
      phase.billing_thresholds ||
      phase.items?.[0]?.billing_thresholds ||
      phase.invoice_settings?.account_tax_ids?.length ||
      (phase.invoice_settings?.issuer?.type &&
        phase.invoice_settings.issuer.type !== 'self')
    )
      fail(
        'SCHEDULE_REVIEW_REQUIRED',
        'The current schedule period needs review. Existing paid access is preserved.',
      )
    // Reuse inherited phase settings, including discounts, taxes and payment method.
    for (const [index, price] of [
      [0, change.from_price],
      [1, change.to_price],
    ] as const) {
      const prefix = `phases[${index}]`
      body.set(
        `${prefix}[start_date]`,
        String(index === 0 ? phase.start_date : change.preview.periodEnd),
      )
      body.set(`${prefix}[items][0][price]`, price)
      body.set(`${prefix}[items][0][quantity]`, '1')
      body.set(`${prefix}[proration_behavior]`, 'none')
      if (index === 0)
        body.set(`${prefix}[end_date]`, String(change.preview.periodEnd))
      else body.set(`${prefix}[iterations]`, '1')
      for (const field of [
        'collection_method',
        'default_payment_method',
        'description',
        'application_fee_percent',
        'on_behalf_of',
      ] as const) {
        const value = phase[field]
        if (value !== null && value !== undefined)
          body.set(
            `${prefix}[${field}]`,
            String(typeof value === 'object' ? value.id : value),
          )
      }
      if (phase.automatic_tax)
        body.set(
          `${prefix}[automatic_tax][enabled]`,
          String(phase.automatic_tax.enabled),
        )
      for (const [i, tax] of (phase.default_tax_rates || []).entries())
        body.set(`${prefix}[default_tax_rates][${i}]`, stripeObjectId(tax))
      for (const [i, tax] of (phase.items?.[0]?.tax_rates || []).entries())
        body.set(`${prefix}[items][0][tax_rates][${i}]`, stripeObjectId(tax))
      if (phase.invoice_settings?.days_until_due)
        body.set(
          `${prefix}[invoice_settings][days_until_due]`,
          String(phase.invoice_settings.days_until_due),
        )
      if (phase.transfer_data?.destination) {
        body.set(
          `${prefix}[transfer_data][destination]`,
          stripeObjectId(phase.transfer_data.destination),
        )
        if (phase.transfer_data.amount_percent != null)
          body.set(
            `${prefix}[transfer_data][amount_percent]`,
            String(phase.transfer_data.amount_percent),
          )
      }
      for (const [i, discount] of (phase.discounts || []).entries()) {
        const field = discount.promotion_code
          ? 'promotion_code'
          : discount.coupon
            ? 'coupon'
            : 'discount'
        body.set(
          `${prefix}[discounts][${i}][${field}]`,
          stripeObjectId(discount[field]) || discount.id,
        )
      }
    }
    const updated = await stripeRequest(
      key,
      '/subscription_schedules/' + schedule.id,
      body,
      'cottage-schedule-phases-' + id,
    )
    if (
      updated.id !== schedule.id ||
      !verifiedChangeSchedule(
        updated,
        sub,
        change,
        environment,
        billing.customer_id,
      )
    )
      fail(
        'SCHEDULE_UNVERIFIED',
        'The future plan is not yet verified. Refresh billing before retrying.',
      )
    await c.query(
      "UPDATE stripe_subscription_changes SET status='scheduled',provider_schedule_id=$2,updated_at=now() WHERE id=$1",
      [id, schedule.id],
    )
  }
  return { verifying: true }
}

export async function stripeCancelPending(
  c: RegistrationClient,
  actor: RegistrationActor,
) {
  const { member, sub, key, environment, billing } = await stripeChangeContext(
    c,
    actor,
  )
  const change = (
    await c.query(
      "SELECT * FROM stripe_subscription_changes WHERE business_id=$1 AND subscription_id=$2 AND status IN ('scheduled','releasing','applying') FOR UPDATE",
      [member.id, sub.id],
    )
  ).rows[0]
  if (!change)
    fail(
      'NO_SCHEDULED_CHANGE',
      'There is no supported scheduled change to cancel. Refresh billing for the latest status.',
    )
  if (
    !['downgrade', 'cancel'].includes(change.kind) ||
    Date.parse(change.effective_at) <= Date.now()
  )
    fail(
      'CHANGE_ALREADY_DUE',
      'This change is already due or requires payment review. Refresh billing before continuing.',
    )
  await c.query(
    "UPDATE stripe_subscription_changes SET status='releasing',updated_at=now() WHERE id=$1",
    [change.id],
  )
  if (change.kind === 'downgrade') {
    if (sub.schedule) {
      const schedule = await ownedSchedule(
        key,
        sub,
        change,
        environment,
        billing.customer_id,
      )
      await stripeRequest(
        key,
        '/subscription_schedules/' + schedule.id + '/release',
        new URLSearchParams({ preserve_cancel_date: 'false' }),
        'cottage-release-' + change.id,
      )
    }
  } else if (sub.cancel_at_period_end) {
    await stripeRequest(
      key,
      '/subscriptions/' + sub.id,
      new URLSearchParams({ cancel_at_period_end: 'false' }),
      'cottage-resume-' + change.id,
    )
  }
  const verified = await stripeRequest(key, '/subscriptions/' + sub.id)
  if (
    verified.id !== sub.id ||
    verified.livemode !== (environment === 'live') ||
    verified.schedule ||
    verified.cancel_at_period_end
  )
    fail(
      'RESUME_UNVERIFIED',
      'The pending change is not yet confirmed as cancelled. Refresh billing before retrying.',
    )
  await c.query(
    "UPDATE stripe_subscription_changes SET status='cancelled',updated_at=now() WHERE id=$1",
    [change.id],
  )
  return { verifying: true }
}
