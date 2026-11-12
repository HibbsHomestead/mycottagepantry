/* eslint-disable @typescript-eslint/no-explicit-any -- untyped Square provider JSON */
import { randomUUID } from 'node:crypto'
import { markSquareReconnect } from './square-credentials'
import { z } from 'zod'
import {
  launchPricing,
  billablePlanIds,
  planBillable,
  planMonthlyCents,
  type BillablePlanId,
} from '../../src/lib/launch-plans'
import {
  billingPolicyProposal,
  sandboxBillingPolicy,
  subscriptionConsent,
} from '../../src/lib/registration'
import {
  currentMembership,
  RegistrationError,
  type RegistrationActor,
  type RegistrationClient,
} from './registration-core'
import {
  activeBillingEnvironment,
  billingConfiguration,
  consentHash,
  correlateCheckout,
  createHostedSubscriptionCheckout,
  normalizeInvoice,
  squareBillingRequest,
  subscriptionCoverage,
  syncSandboxPlans,
  verifyConnection,
  variationProblem,
  PRODUCTION_BILLING_RELEASE_APPROVED,
  type BillingEnvironment,
} from './square-billing'

/** Checkout links older than this without a completed payment are abandoned. */
export const CHECKOUT_EXPIRY_MS = 24 * 3600000
const planName = (plan: string) =>
  launchPricing.plans.find((p) => p.id === plan)?.name || plan

/** Elevates to the billing worker for server-owned provider state, restoring the
 * previous setting afterwards (nesting-safe). Callers have already scoped the oven. */
async function asWorker<T>(client: RegistrationClient, fn: () => Promise<T>) {
  const previous =
    (
      await client.query(
        "SELECT current_setting('app.billing_worker',true) AS value",
      )
    ).rows[0]?.value === 'true'
  await client.query("SELECT set_config('app.billing_worker','true',true)")
  try {
    return await fn()
  } finally {
    await client.query("SELECT set_config('app.billing_worker',$1,true)", [
      String(previous),
    ])
  }
}
async function ownerMembership(
  client: RegistrationClient,
  actor: RegistrationActor,
) {
  const member = await currentMembership(client, actor)
  if (!member || member.role !== 'Owner')
    throw new RegistrationError(
      403,
      'OWNER_REQUIRED',
      'Only an active oven Owner can view or change billing.',
    )
  return member
}
async function businessSettings(client: RegistrationClient, id: string) {
  return (
    await client.query(
      "SELECT data FROM settings WHERE business_id=$1 AND id='business'",
      [id],
    )
  ).rows[0]?.data
}
/** How this oven's access is decided, independent of platform-admin permissions. */
export function accessSource(billing: any, settings: any) {
  if (billing?.source === 'complimentary') return 'complimentary'
  if (!billing)
    return settings?.freeRegistration ? 'free_app' : 'legacy_complimentary'
  return billing.source as string
}

/* ---------------- Owner view ---------------- */
export async function billingOverview(
  client: RegistrationClient,
  actor: RegistrationActor,
) {
  const member = await ownerMembership(client, actor)
  const { currentSignupSelection } = await import('./signup-plan-intent')
  const signupSelection = await currentSignupSelection(client, actor)
  const billing = (
    await client.query('SELECT * FROM workspace_billing WHERE business_id=$1', [
      member.id,
    ])
  ).rows[0]
  const settings = await businessSettings(client, member.id)
  const { effectiveAccess, latestManualGrant } = await import('./manual-access')
  const business = (
    await client.query('SELECT identity_owner FROM businesses WHERE id=$1', [
      member.id,
    ])
  ).rows[0]
  const resolved = effectiveAccess(
    billing,
    await latestManualGrant(client, member.id),
    business?.identity_owner || '',
  )
  const source = resolved.access
    ? resolved.source
    : accessSource(billing, settings)
  const complimentary =
    ['legacy_complimentary', 'complimentary'].includes(source) &&
    !resolved.manualValid
  const verifiedAccess = resolved.access
  const currentAccess = {
    planId: complimentary ? null : verifiedAccess?.plan || 'free',
    kind: resolved.manualValid
      ? 'manual'
      : complimentary
        ? 'complimentary'
        : verifiedAccess?.plan && verifiedAccess.plan !== 'free'
          ? 'verified_paid'
          : 'implemented_free',
  }
  const attempts = (
    await client.query(
      'SELECT id,plan_id,status,amount_cents,checkout_url,environment,error_code,created_at,updated_at,expires_at FROM billing_attempts WHERE business_id=$1 ORDER BY created_at DESC LIMIT 20',
      [member.id],
    )
  ).rows
  const invoices = (
    await client.query(
      'SELECT id,status,amount_cents,paid_cents,refunded_cents,currency,service_from,service_through,environment FROM billing_invoices WHERE business_id=$1 ORDER BY service_from DESC NULLS LAST LIMIT 24',
      [member.id],
    )
  ).rows
  const environment = activeBillingEnvironment()
  const mapped = environment
    ? await asWorker(client, async () =>
        (
          await client.query(
            'SELECT plan_id FROM billing_plan_mappings WHERE environment=$1',
            [environment],
          )
        ).rows.map((r) => r.plan_id as string),
      )
    : []
  const owner = billing?.billing_owner_identity || null
  const live =
    billing?.subscription_id &&
    ['payment_processing', 'paid_active', 'past_due', 'cancelled'].includes(
      billing.status,
    )
  const open = attempts.find((a) =>
    ['checkout_pending', 'payment_processing', 'unknown'].includes(a.status),
  )
  const checkoutBlocked =
    source === 'legacy_complimentary' || source === 'complimentary'
      ? 'This oven has complimentary access. No subscription is needed.'
      : !environment
        ? 'Paid plans are not available yet. No card or payment is needed for Free.'
        : owner && owner !== actor.id
          ? 'Another Owner manages billing for this oven.'
          : live
            ? 'This oven already has a subscription. Plan changes are not available yet.'
            : null
  return {
    workspace: { id: member.id, name: member.business_name },
    signupSelection,
    currentAccess,
    accessSource: source,
    billing: billing
      ? {
          plan_id: billing.plan_id,
          source: billing.source,
          status: billing.status,
          environment: billing.environment,
          paid_from: billing.paid_from,
          paid_through: billing.paid_through,
          next_billing_date: billing.next_billing_date,
          canceled_date: billing.canceled_date,
          provider_status: billing.provider_status,
          last_reconciled_at: billing.last_reconciled_at,
          snapshot: billing.snapshot,
          hasSubscription: !!billing.subscription_id,
        }
      : null,
    billingOwner: owner ? (owner === actor.id ? 'you' : 'another_owner') : null,
    attempts: attempts.map((a) => ({
      ...a,
      // Only the current, still-open link is returned to its billing owner.
      checkout_url: a === open && owner === actor.id ? a.checkout_url : null,
    })),
    invoices,
    invoiceHistoryAvailable: invoices.length > 0,
    environment,
    checkoutEnabled: !checkoutBlocked,
    checkoutBlocked,
    purchasablePlans: environment
      ? launchPricing.plans
          .filter((p) => planBillable(p.id) && mapped.includes(p.id))
          .map((p) => p.id)
      : [],
    cancelAvailable:
      !!live &&
      !billing.source.startsWith('stripe_') &&
      billing.status !== 'cancelled' &&
      owner === actor.id,
    consentVersion: subscriptionConsent.version,
    policies: billingPolicyProposal,
    sandboxPolicy: environment === 'sandbox' ? sandboxBillingPolicy : null,
  }
}

/* ---------------- Checkout ---------------- */
const checkoutInput = z
  .object({
    action: z.literal('checkout'),
    planId: z.string(),
    consent: z
      .object({ accepted: z.literal(true), version: z.string().max(80) })
      .strict(),
  })
  .strict()
export async function startCheckout(
  client: RegistrationClient,
  actor: RegistrationActor,
  input: unknown,
  origin: string,
  transport: typeof fetch = fetch,
) {
  const data = checkoutInput.parse(input)
  if (!planBillable(data.planId))
    throw new RegistrationError(
      400,
      'PLAN_NOT_PURCHASABLE',
      'Choose a paid plan. Free needs no checkout.',
    )
  const planId: BillablePlanId = data.planId
  if (data.consent.version !== subscriptionConsent.version)
    throw new RegistrationError(
      409,
      'CONSENT_CHANGED',
      'The subscription terms changed. Review them and confirm again.',
    )
  const member = await ownerMembership(client, actor)
  // Serialize every checkout for this oven across instances and team members.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'billing:' + member.id,
  ])
  const environment = activeBillingEnvironment()
  if (!environment)
    throw new RegistrationError(
      503,
      'CHECKOUT_UNAVAILABLE',
      'Paid checkout is not available on this deployment. No charge was started.',
    )
  const billing = (
    await client.query(
      'SELECT * FROM workspace_billing WHERE business_id=$1 FOR UPDATE',
      [member.id],
    )
  ).rows[0]
  const source = accessSource(
    billing,
    await businessSettings(client, member.id),
  )
  if (source === 'legacy_complimentary' || source === 'complimentary')
    throw new RegistrationError(
      409,
      'COMPLIMENTARY_ACCESS',
      'This oven has complimentary access. No subscription or charge is needed.',
    )
  if (
    billing?.billing_owner_identity &&
    billing.billing_owner_identity !== actor.id
  )
    throw new RegistrationError(
      403,
      'BILLING_OWNER_REQUIRED',
      'Another Owner manages billing for this oven. No second subscription was started.',
    )
  if (
    billing?.subscription_id &&
    ['payment_processing', 'paid_active', 'past_due', 'cancelled'].includes(
      billing.status,
    )
  )
    throw new RegistrationError(
      409,
      'SUBSCRIPTION_EXISTS',
      'This oven already has a subscription. No duplicate was started.',
    )
  const mapping = await asWorker(
    client,
    async () =>
      (
        await client.query(
          'SELECT * FROM billing_plan_mappings WHERE environment=$1 AND plan_id=$2',
          [environment, planId],
        )
      ).rows[0],
  )
  if (!mapping || Number(mapping.amount_cents) !== planMonthlyCents(planId))
    throw new RegistrationError(
      503,
      'PLAN_NOT_CONFIGURED',
      'This plan is not configured with Square yet. No charge was started.',
    )
  const liveVariation = (
    await squareBillingRequest(
      environment,
      `/v2/catalog/object/${encodeURIComponent(mapping.variation_id)}`,
      {},
      transport,
    )
  )?.object
  if (
    variationProblem(liveVariation, planId) ||
    liveVariation?.subscription_plan_variation_data?.subscription_plan_id !==
      mapping.catalog_plan_id
  )
    throw new RegistrationError(
      503,
      'PLAN_MAPPING_CHANGED',
      'The Square plan differs from the approved monthly USD price. No checkout was started.',
    )
  const unresolved = (
    await client.query(
      "SELECT id FROM billing_attempts WHERE business_id=$1 AND status='needs_review' LIMIT 1",
      [member.id],
    )
  ).rows[0]
  if (unresolved)
    throw new RegistrationError(
      409,
      'BILLING_REVIEW_REQUIRED',
      'An earlier payment needs review. Contact cottagepantry@icloud.com with the checkout reference; do not pay again.',
    )
  const open = (
    await client.query(
      "SELECT * FROM billing_attempts WHERE business_id=$1 AND status IN ('checkout_pending','payment_processing','unknown') FOR UPDATE",
      [member.id],
    )
  ).rows[0]
  if (open) {
    if (
      open.plan_id === planId &&
      open.checkout_url &&
      open.identity_id === actor.id &&
      Date.now() < Date.parse(open.expires_at)
    )
      return { reused: true, attemptId: open.id, url: open.checkout_url }
    throw new RegistrationError(
      409,
      'CHECKOUT_OPEN',
      'A checkout for this oven is already open or being confirmed. Refresh status before starting another.',
    )
  }
  if (!billing) {
    // Records the explicit billing owner; the oven stays app-managed Free until paid.
    await client.query(
      "INSERT INTO workspace_billing(business_id,plan_id,source,status,billing_owner_identity) VALUES($1,'free','free_app','free_active',$2)",
      [member.id, actor.id],
    )
  } else if (!billing.billing_owner_identity)
    await client.query(
      'UPDATE workspace_billing SET billing_owner_identity=$2,updated_at=NOW() WHERE business_id=$1',
      [member.id, actor.id],
    )
  const id = randomUUID()
  const text = subscriptionConsent.text(
    planName(planId),
    planMonthlyCents(planId) / 100,
  )
  await client.query(
    `INSERT INTO billing_attempts(id,business_id,identity_id,plan_id,idempotency_key,environment,amount_cents,plan_variation_id,consent_version,consent_hash,consented_at,expires_at)
     VALUES($1,$2,$3,$4,$1,$5,$6,$7,$8,$9,NOW(),$10)`,
    [
      id,
      member.id,
      actor.id,
      planId,
      environment,
      planMonthlyCents(planId),
      mapping.variation_id,
      subscriptionConsent.version,
      consentHash(text),
      new Date(Date.now() + CHECKOUT_EXPIRY_MS),
    ],
  )
  const link = await createHostedSubscriptionCheckout(
    environment,
    {
      attemptId: id,
      planId,
      variationId: mapping.variation_id,
      redirectUrl: `${origin}/oven/billing?checkout=${id}`,
    },
    transport,
  )
  await client.query(
    'UPDATE billing_attempts SET provider_order_id=$2,provider_link_id=$3,checkout_url=$4,updated_at=NOW() WHERE id=$1',
    [id, link.orderId, link.linkId, link.url],
  )
  // Audit rows are internal; a failed query here must not be swallowed because it
  // would abort the transaction after the provider link already exists.
  await asWorker(client, () =>
    client.query(
      "INSERT INTO registration_audit(actor_identity,business_id,action) VALUES($1,$2,'billing_checkout_started')",
      [actor.id, member.id],
    ),
  )
  return { reused: false, attemptId: id, url: link.url }
}

/* ---------------- Reconciliation ---------------- */
type Transport = typeof fetch
async function retrieve(
  environment: BillingEnvironment,
  path: string,
  transport: Transport,
) {
  return squareBillingRequest(environment, path, {}, transport)
}
/** Recomputes one oven's billing from canonical Square reads. Idempotent and
 * order-independent: event payloads are never trusted for state. */
export async function reconcileBusiness(
  client: RegistrationClient,
  businessId: string,
  transport: Transport = fetch,
  now = Date.now(),
) {
  return asWorker(client, async () => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'billing:' + businessId,
    ])
    const billing = (
      await client.query(
        'SELECT * FROM workspace_billing WHERE business_id=$1 FOR UPDATE',
        [businessId],
      )
    ).rows[0]
    if (
      !billing ||
      billing.source === 'complimentary' ||
      billing.source.startsWith('stripe_')
    )
      return { skipped: true }
    const attempts = (
      await client.query(
        "SELECT * FROM billing_attempts WHERE business_id=$1 AND status IN ('checkout_pending','payment_processing','unknown','needs_review') FOR UPDATE",
        [businessId],
      )
    ).rows
    for (const attempt of attempts) {
      const environment = attempt.environment as BillingEnvironment
      const config = billingConfiguration(environment)
      if (!attempt.provider_order_id) {
        if (now - Date.parse(attempt.created_at) > 15 * 60000)
          await client.query(
            "UPDATE billing_attempts SET status='abandoned',error_code='LINK_NOT_CREATED',updated_at=NOW() WHERE id=$1",
            [attempt.id],
          )
        continue
      }
      const order = (
        await retrieve(
          environment,
          `/v2/orders/${encodeURIComponent(attempt.provider_order_id)}`,
          transport,
        )
      )?.order
      const paymentIds: string[] = (order?.tenders || [])
        .map((t: any) => t.payment_id || t.id)
        .filter(Boolean)
      const payments = []
      for (const pid of paymentIds.slice(0, 5))
        payments.push(
          (
            await retrieve(
              environment,
              `/v2/payments/${encodeURIComponent(pid)}`,
              transport,
            )
          )?.payment,
        )
      const customer = payments.find(
        (p) => p?.status === 'COMPLETED' && p.customer_id,
      )?.customer_id
      let subscriptions: any[] = []
      if (customer)
        subscriptions =
          (
            await squareBillingRequest(
              environment,
              '/v2/subscriptions/search',
              {
                method: 'POST',
                body: JSON.stringify({
                  query: {
                    filter: {
                      customer_ids: [customer],
                      location_ids: [config.locationId],
                    },
                  },
                }),
              },
              transport,
            )
          )?.subscriptions || []
      const claimed = new Set<string>(
        (
          await client.query(
            'SELECT subscription_id FROM billing_subscriptions WHERE subscription_id = ANY($1)',
            [subscriptions.map((s) => s.id)],
          )
        ).rows.map((r) => r.subscription_id),
      )
      const result = correlateCheckout(
        {
          createdAt: new Date(attempt.created_at).toISOString(),
          planVariationId: attempt.plan_variation_id,
          locationId: config.locationId,
          orderId: attempt.provider_order_id,
        },
        order,
        payments.filter(Boolean),
        subscriptions,
        claimed,
        now,
      )
      if (result.state === 'pending') {
        if (!payments.length && now > Date.parse(attempt.expires_at)) {
          // Do not release the duplicate guard until Square invalidates the old link.
          await squareBillingRequest(
            environment,
            `/v2/online-checkout/payment-links/${encodeURIComponent(attempt.provider_link_id)}`,
            { method: 'DELETE' },
            transport,
          )
          await client.query(
            "UPDATE billing_attempts SET status='needs_review',error_code='EXPIRED_CHECKOUT_REVIEW',updated_at=NOW() WHERE id=$1",
            [attempt.id],
          )
        } else if (payments.length && attempt.status !== 'payment_processing')
          await client.query(
            "UPDATE billing_attempts SET status='payment_processing',updated_at=NOW() WHERE id=$1",
            [attempt.id],
          )
        continue
      }
      if (result.state !== 'linked') {
        if (result.state === 'failed')
          await squareBillingRequest(
            environment,
            `/v2/online-checkout/payment-links/${encodeURIComponent(attempt.provider_link_id)}`,
            { method: 'DELETE' },
            transport,
          )
        await client.query(
          'UPDATE billing_attempts SET status=$2,error_code=$3,updated_at=NOW() WHERE id=$1',
          [
            attempt.id,
            result.state,
            result.state === 'failed'
              ? 'INITIAL_PAYMENT_FAILED'
              : 'CORRELATION_REVIEW',
          ],
        )
        continue
      }
      const subscription = subscriptions.find(
        (s) => s.id === result.subscriptionId,
      )
      const inserted = await client.query(
        `INSERT INTO billing_subscriptions(subscription_id,environment,business_id,attempt_id,customer_id,plan_id,plan_variation_id,status,version)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING subscription_id`,
        [
          result.subscriptionId,
          environment,
          businessId,
          attempt.id,
          result.customerId,
          attempt.plan_id,
          attempt.plan_variation_id,
          subscription?.status || 'PENDING',
          Number(subscription?.version || 0),
        ],
      )
      if (!inserted.rows.length) {
        // A second live subscription for this oven (or one claimed elsewhere) is never merged.
        await client.query(
          "UPDATE billing_attempts SET status='needs_review',error_code='DUPLICATE_SUBSCRIPTION',updated_at=NOW() WHERE id=$1",
          [attempt.id],
        )
        continue
      }
      await client.query(
        "UPDATE billing_attempts SET status='completed',subscription_id=$2,customer_id=$3,updated_at=NOW() WHERE id=$1",
        [attempt.id, result.subscriptionId, result.customerId],
      )
      await client.query(
        `UPDATE workspace_billing SET subscription_id=$2,customer_id=$3,plan_variation_id=$4,plan_id=$5,environment=$6,
           source=$7,status='payment_processing',updated_at=NOW() WHERE business_id=$1`,
        [
          businessId,
          result.subscriptionId,
          result.customerId,
          attempt.plan_variation_id,
          attempt.plan_id,
          environment,
          environment === 'sandbox' ? 'square_sandbox' : 'square_production',
        ],
      )
      billing.subscription_id = result.subscriptionId
      billing.environment = environment
      billing.plan_id = attempt.plan_id
      billing.provider_version = null
    }
    if (!billing.subscription_id) return { linked: false }
    return refreshSubscription(client, businessId, billing, transport, now)
  })
}
async function refreshSubscription(
  client: RegistrationClient,
  businessId: string,
  billing: any,
  transport: Transport,
  now: number,
) {
  const environment = billing.environment as BillingEnvironment
  const link = (
    await client.query(
      'SELECT * FROM billing_subscriptions WHERE subscription_id=$1 AND business_id=$2',
      [billing.subscription_id, businessId],
    )
  ).rows[0]
  if (!link) return { linked: false }
  const subscription = (
    await retrieve(
      environment,
      `/v2/subscriptions/${encodeURIComponent(link.subscription_id)}`,
      transport,
    )
  )?.subscription
  if (!subscription || subscription.id !== link.subscription_id)
    throw new RegistrationError(
      502,
      'SUBSCRIPTION_UNAVAILABLE',
      'Subscription lookup failed.',
    )
  if (
    subscription.customer_id !== link.customer_id ||
    subscription.plan_variation_id !== link.plan_variation_id
  ) {
    await client.query(
      "UPDATE workspace_billing SET status='needs_review',updated_at=NOW() WHERE business_id=$1",
      [businessId],
    )
    return { linked: true, state: 'needs_review' }
  }
  // Ignore a stale read that is older than what is already stored.
  const version = Number(subscription.version || 0)
  if (version < Number(link.version || 0)) return { linked: true, stale: true }
  await client.query(
    'UPDATE billing_subscriptions SET status=$2,version=$3,updated_at=NOW() WHERE subscription_id=$1',
    [link.subscription_id, subscription.status, version],
  )
  const ids: string[] = (subscription.invoice_ids || []).slice(0, 36)
  for (const id of ids) {
    const raw = (
      await retrieve(
        environment,
        `/v2/invoices/${encodeURIComponent(id)}`,
        transport,
      )
    )?.invoice
    const inv = normalizeInvoice(raw)
    if (!inv.id || inv.subscriptionId !== link.subscription_id) continue
    await client.query(
      `INSERT INTO billing_invoices(id,environment,business_id,subscription_id,status,amount_cents,paid_cents,refunded_cents,currency,service_from,service_through,version,retrieved_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,amount_cents=EXCLUDED.amount_cents,paid_cents=EXCLUDED.paid_cents,
         refunded_cents=EXCLUDED.refunded_cents,currency=EXCLUDED.currency,service_from=EXCLUDED.service_from,
         service_through=EXCLUDED.service_through,version=EXCLUDED.version,retrieved_at=NOW()
       WHERE billing_invoices.version <= EXCLUDED.version AND billing_invoices.business_id = EXCLUDED.business_id`,
      [
        inv.id,
        environment,
        businessId,
        link.subscription_id,
        inv.status,
        inv.amountCents,
        inv.paidCents,
        inv.refundedCents,
        inv.currency,
        inv.serviceFrom,
        inv.serviceThrough,
        inv.version,
      ],
    )
  }
  const invoices = (
    await client.query(
      'SELECT * FROM billing_invoices WHERE subscription_id=$1 AND business_id=$2',
      [link.subscription_id, businessId],
    )
  ).rows.map((r) => ({
    id: r.id,
    version: r.version,
    subscriptionId: r.subscription_id,
    status: r.status,
    amountCents: r.amount_cents,
    paidCents: r.paid_cents,
    refundedCents: r.refunded_cents,
    currency: r.currency,
    serviceFrom: r.service_from,
    serviceThrough: r.service_through,
  }))
  const coverage = subscriptionCoverage(
    {
      planId: link.plan_id,
      subscription,
      invoices,
      disputed: billing.snapshot?.disputed === true,
      // Sandbox test configuration only; production grace is pending owner approval.
      graceDays: environment === 'sandbox' ? sandboxBillingPolicy.graceDays : 0,
    },
    now,
  )
  if (environment === 'production' && !PRODUCTION_BILLING_RELEASE_APPROVED)
    return { linked: true, state: 'release_gated', providerVerified: true }
  await client.query(
    `UPDATE workspace_billing SET status=$2,paid_from=$3,paid_through=$4,provider_status=$5,provider_version=$6,
       next_billing_date=$7,canceled_date=$8,last_reconciled_at=NOW(),snapshot=snapshot || $9::jsonb,updated_at=NOW()
     WHERE business_id=$1`,
    [
      businessId,
      coverage.state,
      coverage.paidFrom ? new Date(coverage.paidFrom + 'T00:00:00Z') : null,
      coverage.paidThrough
        ? new Date(coverage.paidThrough + 'T00:00:00Z')
        : null,
      subscription.status,
      version,
      subscription.charged_through_date || null,
      subscription.canceled_date || null,
      JSON.stringify({
        accessPlan: coverage.accessPlan,
        review: coverage.review || null,
        nextBillingDate: subscription.charged_through_date || null,
      }),
    ],
  )
  return { linked: true, state: coverage.state }
}

/** Maps a webhook event to its oven via canonical reads, then reconciles that oven. */
export async function processBillingEvent(
  client: RegistrationClient,
  event: { id: string; kind: string; object_id: string; environment?: string },
  transport: Transport = fetch,
) {
  const environment = (event.environment || 'sandbox') as BillingEnvironment
  return asWorker(client, async () => {
    let subscriptionId: string | undefined
    let payment: any
    let disputed = false
    const kind = event.kind
    const paymentById = async (id: string) =>
      (
        await retrieve(
          environment,
          `/v2/payments/${encodeURIComponent(id)}`,
          transport,
        )
      )?.payment
    if (kind.startsWith('subscription.')) subscriptionId = event.object_id
    else if (kind.startsWith('invoice.'))
      subscriptionId = (
        await retrieve(
          environment,
          `/v2/invoices/${encodeURIComponent(event.object_id)}`,
          transport,
        )
      )?.invoice?.subscription_id
    else if (kind.startsWith('payment.'))
      payment = await paymentById(event.object_id)
    else if (kind.startsWith('refund.') || kind.startsWith('dispute.')) {
      const resource = kind.startsWith('refund.') ? 'refunds' : 'disputes'
      const object = await retrieve(
        environment,
        `/v2/${resource}/${encodeURIComponent(event.object_id)}`,
        transport,
      )
      const paymentId =
        object?.refund?.payment_id ||
        object?.dispute?.disputed_payment?.payment_id
      disputed = resource === 'disputes'
      if (paymentId) payment = await paymentById(paymentId)
    }
    const businessIds = new Set<string>()
    if (subscriptionId)
      for (const r of (
        await client.query(
          'SELECT business_id FROM billing_subscriptions WHERE subscription_id=$1 AND environment=$2',
          [subscriptionId, environment],
        )
      ).rows)
        businessIds.add(r.business_id)
    if (payment?.order_id)
      for (const r of (
        await client.query(
          'SELECT business_id FROM billing_attempts WHERE provider_order_id=$1 AND environment=$2',
          [payment.order_id, environment],
        )
      ).rows)
        businessIds.add(r.business_id)
    // Renewal payments carry the invoice's own order. Reconciling every oven that holds a
    // subscription for this Square customer is safe: each oven's access is recomputed only
    // from its own subscription's invoices, never transferred between ovens.
    if (!businessIds.size && payment?.customer_id)
      for (const r of (
        await client.query(
          'SELECT business_id FROM billing_subscriptions WHERE customer_id=$1 AND environment=$2',
          [payment.customer_id, environment],
        )
      ).rows)
        businessIds.add(r.business_id)
    if (!businessIds.size)
      return {
        status: 'needs_review',
        code: 'CORRELATION_AND_PERIOD_PROOF_REQUIRED',
      }
    for (const businessId of businessIds) {
      // A dispute flags only the oven whose subscription received the disputed payment.
      if (disputed && subscriptionId === undefined && businessIds.size === 1)
        await client.query(
          `UPDATE workspace_billing SET snapshot=snapshot || '{"disputed":true}'::jsonb WHERE business_id=$1`,
          [businessId],
        )
      await reconcileBusiness(client, businessId, transport)
    }
    return { status: 'processed', code: null }
  })
}

/** Scheduled/admin reconciliation: inbox events, then a sweep for missed notifications. */
export async function runBillingReconciliation(
  client: RegistrationClient,
  transport: Transport = fetch,
  limit = 10,
  environment: BillingEnvironment = 'sandbox',
) {
  return asWorker(client, async () => {
    const { rows } = await client.query(
      "SELECT * FROM billing_events WHERE environment=$2 AND merchant_id=$3 AND status IN ('pending','retry') AND attempts<3 ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT $1",
      [limit, environment, billingConfiguration(environment).merchantId],
    )
    let failures = 0,
      processed = 0
    for (const event of rows) {
      await client.query('SAVEPOINT billing_event')
      try {
        const result = await processBillingEvent(client, event, transport)
        await client.query(
          'UPDATE billing_events SET status=$2,attempts=attempts+1,error_code=$3,processed_at=NOW() WHERE id=$1',
          [event.id, result.status, result.code],
        )
        await client.query('RELEASE SAVEPOINT billing_event')
        if (result.status === 'processed') processed++
      } catch (error) {
        failures++
        await client.query('ROLLBACK TO SAVEPOINT billing_event')
        if (
          error instanceof RegistrationError &&
          (error.code === 'SQUARE_AUTHORIZATION_FAILED' ||
            error.code.startsWith('SQUARE_401_'))
        )
          await markSquareReconnect(environment)
        await client.query(
          "UPDATE billing_events SET status=CASE WHEN attempts+1>=3 THEN 'failed' ELSE 'retry' END,attempts=attempts+1,error_code=$2 WHERE id=$1",
          [
            event.id,
            error instanceof RegistrationError
              ? error.code.slice(0, 60)
              : 'SQUARE_LOOKUP_FAILED',
          ],
        )
        await client.query('RELEASE SAVEPOINT billing_event')
      }
    }
    // Missed-event sweep: open checkouts and subscriptions not reconciled recently.
    const stale = (
      await client.query(
        `SELECT DISTINCT business_id FROM (
           SELECT business_id FROM billing_attempts WHERE environment=$2 AND status IN ('checkout_pending','payment_processing','unknown')
           UNION SELECT business_id FROM workspace_billing WHERE environment=$2 AND subscription_id IS NOT NULL
             AND (last_reconciled_at IS NULL OR last_reconciled_at < NOW() - INTERVAL '6 hours')
         ) s LIMIT $1`,
        [limit, environment],
      )
    ).rows
    let swept = 0
    for (const { business_id } of stale) {
      await client.query('SAVEPOINT billing_sweep')
      try {
        await reconcileBusiness(client, business_id, transport)
        swept++
        await client.query('RELEASE SAVEPOINT billing_sweep')
      } catch {
        failures++
        await client.query('ROLLBACK TO SAVEPOINT billing_sweep')
        await client.query('RELEASE SAVEPOINT billing_sweep')
        /* Retried by the next scheduled run. */
      }
    }
    await client.query(
      'INSERT INTO billing_sync_runs(environment,checked,swept,failures) VALUES($1,$2,$3,$4)',
      [environment, processed, swept, failures],
    )
    return { checked: rows.length, processed, swept, failures }
  })
}

/* ---------------- Owner actions ---------------- */
export async function refreshOwnBilling(
  client: RegistrationClient,
  actor: RegistrationActor,
  transport: Transport = fetch,
) {
  const member = await ownerMembership(client, actor)
  try {
    const linked = (
      await client.query(
        'SELECT source FROM workspace_billing WHERE business_id=$1',
        [member.id],
      )
    ).rows[0]
    if (linked?.source?.startsWith('stripe_')) {
      const { stripeRefresh } = await import('./stripe-subscriptions')
      await stripeRefresh(client, actor)
    } else await reconcileBusiness(client, member.id, transport)
  } catch (error) {
    if (!(error instanceof RegistrationError)) throw error
    // Status remains as last verified; nothing is granted on failure.
  }
  return billingOverview(client, actor)
}
const cancelInput = z
  .object({ action: z.literal('cancel'), confirm: z.literal(true) })
  .strict()
/** Cancels at the end of the current billing period (Square's cancel behavior). */
export async function cancelAtPeriodEnd(
  client: RegistrationClient,
  actor: RegistrationActor,
  input: unknown,
  transport: Transport = fetch,
) {
  cancelInput.parse(input)
  const member = await ownerMembership(client, actor)
  const billing = (
    await client.query(
      'SELECT * FROM workspace_billing WHERE business_id=$1 FOR UPDATE',
      [member.id],
    )
  ).rows[0]
  if (billing?.source?.startsWith('stripe_'))
    throw new RegistrationError(
      409,
      'STRIPE_POLICY_REQUIRED',
      'Manage this subscription through the reviewed Stripe billing portal. Cancellation requires separate policy approval.',
    )
  if (!billing?.subscription_id)
    throw new RegistrationError(
      409,
      'NO_SUBSCRIPTION',
      'There is no subscription to cancel.',
    )
  if (billing.billing_owner_identity !== actor.id)
    throw new RegistrationError(
      403,
      'BILLING_OWNER_REQUIRED',
      'Only the Owner who manages billing can cancel this subscription.',
    )
  if (
    billing.environment === 'production' &&
    !PRODUCTION_BILLING_RELEASE_APPROVED
  )
    throw new RegistrationError(
      503,
      'PRODUCTION_BILLING_GATED',
      'Production billing changes are not approved.',
    )
  if (!billing.canceled_date)
    await squareBillingRequest(
      billing.environment,
      `/v2/subscriptions/${encodeURIComponent(billing.subscription_id)}/cancel`,
      { method: 'POST', body: '{}' },
      transport,
    )
  await reconcileBusiness(client, member.id, transport)
  return billingOverview(client, actor)
}

/* ---------------- Platform admin actions ---------------- */
export async function recordConnectionCheck(
  client: RegistrationClient,
  environment: BillingEnvironment,
  transport: Transport = fetch,
) {
  const result = await verifyConnection(environment, transport)
  await asWorker(client, () =>
    client.query(
      'INSERT INTO billing_connection_checks(environment,ok,merchant_id,location_id,location_name,currency,country,missing,error_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        environment,
        result.ok,
        result.merchantId,
        result.locationId,
        result.locationName,
        result.currency,
        result.country,
        JSON.stringify(result.missing),
        result.errorCode,
      ],
    ),
  )
  return { ...result, checkedAt: new Date().toISOString() }
}
export async function syncPlanMappings(
  client: RegistrationClient,
  environment: BillingEnvironment,
  transport: Transport = fetch,
) {
  if (environment !== 'sandbox')
    throw new RegistrationError(
      403,
      'PRODUCTION_APPROVAL_REQUIRED',
      'Production plans are created only after the owner approves the exact configuration.',
    )
  const { mappings, problems } = await syncSandboxPlans(transport)
  await asWorker(client, async () => {
    for (const m of mappings)
      await client.query(
        `INSERT INTO billing_plan_mappings(environment,plan_id,catalog_plan_id,variation_id,amount_cents,currency,cadence,verified_at)
         VALUES('sandbox',$1,$2,$3,$4,'USD','MONTHLY',NOW())
         ON CONFLICT(environment,plan_id) DO UPDATE SET catalog_plan_id=EXCLUDED.catalog_plan_id,variation_id=EXCLUDED.variation_id,
           amount_cents=EXCLUDED.amount_cents,verified_at=NOW()`,
        [m.planId, m.catalogPlanId, m.variationId, m.amountCents],
      )
  })
  return { mappings, problems }
}
/** Safe metadata for the platform administrator. No tokens, keys or buyer details. */
export async function billingAdminStatus(client: RegistrationClient) {
  return asWorker(client, async () => {
    const environments = (['sandbox', 'production'] as const).map((e) => {
      const c = billingConfiguration(e)
      return {
        environment: e,
        missing: c.missing,
        deploymentAllowed: c.contextAllowed,
        checkoutPermitted: c.checkoutPermitted,
        releaseApproved:
          e === 'sandbox' ? true : PRODUCTION_BILLING_RELEASE_APPROVED,
      }
    })
    const checks = (
      await client.query(
        'SELECT DISTINCT ON (environment) environment,checked_at,ok,merchant_id,location_id,location_name,currency,country,missing,error_code FROM billing_connection_checks ORDER BY environment,checked_at DESC',
      )
    ).rows
    const mappings = (
      await client.query(
        'SELECT environment,plan_id,variation_id,amount_cents,cadence,verified_at FROM billing_plan_mappings ORDER BY environment,amount_cents',
      )
    ).rows
    const review = (
      await client.query(
        "SELECT id,business_id,plan_id,status,error_code,updated_at FROM billing_attempts WHERE status IN ('needs_review','failed') ORDER BY updated_at DESC LIMIT 20",
      )
    ).rows
    return { environments, checks, mappings, review }
  })
}

/** Read-only provider verification: does not create or change Production resources. */
export async function verifyPlanMappings(
  client: RegistrationClient,
  environment: BillingEnvironment,
  transport: Transport = fetch,
) {
  return asWorker(client, async () => {
    const rows = (
      await client.query(
        'SELECT * FROM billing_plan_mappings WHERE environment=$1',
        [environment],
      )
    ).rows
    const problems: { planId: string; problem: string }[] = []
    for (const planId of billablePlanIds) {
      const row = rows.find((r) => r.plan_id === planId)
      if (!row) {
        problems.push({
          planId,
          problem:
            'No mapping exists. Exact Production resources require separate owner approval.',
        })
        continue
      }
      const object = (
        await retrieve(
          environment,
          `/v2/catalog/object/${encodeURIComponent(row.variation_id)}`,
          transport,
        )
      )?.object
      const problem =
        variationProblem(object, planId) ||
        (object?.subscription_plan_variation_data?.subscription_plan_id !==
        row.catalog_plan_id
          ? 'The mapped parent plan differs.'
          : null)
      if (problem) {
        problems.push({ planId, problem })
        await client.query(
          'DELETE FROM billing_plan_mappings WHERE environment=$1 AND plan_id=$2',
          [environment, planId],
        )
      } else
        await client.query(
          'UPDATE billing_plan_mappings SET verified_at=NOW() WHERE environment=$1 AND plan_id=$2',
          [environment, planId],
        )
    }
    return { problems }
  })
}
