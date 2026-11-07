/* eslint-disable @typescript-eslint/no-explicit-any -- untyped Square provider JSON */
import { createHash } from 'node:crypto'
import {
  currentSquareConnection,
  squareAccessToken,
  markSquareReconnect,
  squareWebhookUrl,
} from './square-credentials'
import {
  launchPricing,
  billablePlanIds,
  planMonthlyCents,
  type BillablePlanId,
} from '../../src/lib/launch-plans'
import {
  RegistrationError,
  privateRegistrationEnabled,
} from './registration-core'

/**
 * Cottage Pantry PLATFORM subscription billing (Hibbs Homestead Market is the seller).
 * Entirely separate from any customer's Square sales-sync connection, bakery ledgers
 * and merchandise tax settings. Server-only: no value here may reach a browser.
 */
export type BillingEnvironment = 'sandbox' | 'production'

/** Production release gate. Changing this requires the owner-approved checklist in
 * docs/square-subscription-billing.md; environment variables alone never enable it. */
export const PRODUCTION_BILLING_RELEASE_APPROVED = false as boolean

const prefixes: Record<BillingEnvironment, string> = {
  sandbox: 'SQUARE_SANDBOX_',
  production: 'SQUARE_PRODUCTION_',
}
const origins: Record<BillingEnvironment, string> = {
  sandbox: 'https://connect.squareupsandbox.com',
  production: 'https://connect.squareup.com',
}
export function billingEnvNames(environment: BillingEnvironment) {
  const p = prefixes[environment]
  return {
    enabled:
      environment === 'sandbox'
        ? 'SQUARE_SANDBOX_ENABLED'
        : 'SQUARE_PRODUCTION_BILLING_ENABLED',
    accessToken: p + 'ACCESS_TOKEN',
    apiVersion: p + 'API_VERSION',
    locationId: p + 'LOCATION_ID',
    merchantId: p + 'MERCHANT_ID',
    webhookSignatureKey: p + 'WEBHOOK_SIGNATURE_KEY',
    webhookUrl: p + 'WEBHOOK_URL',
  }
}
const env = (name: string) => globalThis.Netlify?.env?.get(name) || ''

/** Names (never values) of missing settings, plus whether checkout may run. */
export function billingConfiguration(environment: BillingEnvironment) {
  const names = billingEnvNames(environment)
  const connection = currentSquareConnection(environment)
  const missing = Object.entries(names)
    .filter(
      ([key, name]) =>
        key !== 'enabled' &&
        !(
          connection &&
          ['accessToken', 'locationId', 'merchantId'].includes(key)
        ) &&
        !(key === 'webhookUrl' ? squareWebhookUrl(environment) : env(name)),
    )
    .map(([, name]) => name)
  if (
    connection &&
    (connection.status !== 'connected' || !connection.location_id)
  )
    missing.push('SQUARE_RECONNECT_OR_LOCATION_REQUIRED')
  const flag = env(names.enabled) === 'true'
  const contextAllowed =
    environment === 'sandbox'
      ? privateRegistrationEnabled()
      : env('CONTEXT') === 'production' && PRODUCTION_BILLING_RELEASE_APPROVED
  if (!flag) missing.unshift(names.enabled + '=true')
  return {
    environment,
    missing,
    contextAllowed,
    /** True only when every setting exists AND the deployment is allowed. Not "connected". */
    checkoutPermitted: flag && contextAllowed && missing.length === 0,
    readable:
      (connection
        ? connection.status === 'connected'
        : !!env(names.accessToken)) &&
      !!env(names.apiVersion) &&
      (environment === 'production' || privateRegistrationEnabled()),
    locationId: connection?.location_id || env(names.locationId),
    merchantId: connection?.merchant_id || env(names.merchantId),
  }
}
/** Which environment this deployment may bill through. Production is gated off. */
export function activeBillingEnvironment(): BillingEnvironment | null {
  if (billingConfiguration('sandbox').checkoutPermitted) return 'sandbox'
  if (billingConfiguration('production').checkoutPermitted) return 'production'
  return null
}

const readOnlyVerificationPath =
  /^\/v2\/(merchants\/me|locations(?:\/[A-Za-z0-9_-]+)?|subscriptions\/[A-Za-z0-9_-]+|invoices\/[A-Za-z0-9_-]+|payments\/[A-Za-z0-9_-]+|orders\/[A-Za-z0-9_-]+|refunds\/[A-Za-z0-9_-]+|disputes\/[A-Za-z0-9_-]+|catalog\/object\/[A-Za-z0-9_-]+)$/
export async function squareBillingRequest(
  environment: BillingEnvironment,
  path: string,
  init: RequestInit = {},
  transport: typeof fetch = fetch,
) {
  const names = billingEnvNames(environment)
  const config = billingConfiguration(environment)
  const method = (init.method || 'GET').toUpperCase()
  // Production permits canonical reads (including subscription search) before release; provider mutations remain gated.
  const allowed =
    environment === 'sandbox'
      ? config.readable && env(names.enabled) === 'true'
      : config.readable &&
        (config.checkoutPermitted ||
          (method === 'GET' && readOnlyVerificationPath.test(path)) ||
          (method === 'POST' && path === '/v2/subscriptions/search'))
  if (!allowed)
    throw new RegistrationError(
      503,
      environment === 'sandbox'
        ? 'SANDBOX_NOT_CONFIGURED'
        : 'PRODUCTION_BILLING_GATED',
      environment === 'sandbox'
        ? 'Square Sandbox is not configured. No provider request was made.'
        : 'Production billing is not approved. No provider request was made.',
    )
  if (!/^\/v2\/[a-z0-9/_?=&.%:-]+$/i.test(path))
    throw new Error('Invalid Square resource path.')
  const token = await squareAccessToken(environment, transport)
  const response = await transport(origins[environment] + path, {
    redirect: 'error',
    ...init,
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token}`,
      'Square-Version': env(names.apiVersion),
      'Content-Type': 'application/json',
    },
  })
  if (!response.ok) {
    if (response.status === 401) await markSquareReconnect(environment)
    let providerCode = 'UNKNOWN'
    try {
      const body = await response.json()
      providerCode = String(body?.errors?.[0]?.code || 'UNKNOWN').slice(0, 60)
    } catch {
      /* Provider bodies are never echoed. */
    }
    throw new RegistrationError(
      502,
      `SQUARE_${response.status}_${providerCode}`.replace(/[^A-Z0-9_]/gi, ''),
      'Square could not complete this request. Refresh status before retrying.',
    )
  }
  return response.json()
}

export type ConnectionCheck = {
  environment: BillingEnvironment
  ok: boolean
  merchantId: string | null
  locationId: string | null
  locationName: string | null
  currency: string | null
  country: string | null
  missing: string[]
  errorCode: string | null
}
/** Verifies the configured seller and location with live reads. Env presence is never "connected". */
export async function verifyConnection(
  environment: BillingEnvironment,
  transport: typeof fetch = fetch,
): Promise<ConnectionCheck> {
  const config = billingConfiguration(environment)
  const result: ConnectionCheck = {
    environment,
    ok: false,
    merchantId: null,
    locationId: config.locationId || null,
    locationName: null,
    currency: null,
    country: null,
    missing: config.missing,
    errorCode: null,
  }
  if (!config.readable || !config.locationId) {
    result.errorCode = 'CONFIGURATION_MISSING'
    return result
  }
  try {
    const merchant = (
      await squareBillingRequest(environment, '/v2/merchants/me', {}, transport)
    )?.merchant
    result.merchantId = merchant?.id || null
    const location = (
      await squareBillingRequest(
        environment,
        `/v2/locations/${encodeURIComponent(config.locationId)}`,
        {},
        transport,
      )
    )?.location
    result.locationName = location?.name || null
    result.currency = location?.currency || null
    result.country = location?.country || null
    const problems = [
      config.merchantId && merchant?.id !== config.merchantId
        ? 'MERCHANT_MISMATCH'
        : '',
      location?.merchant_id && location.merchant_id !== merchant?.id
        ? 'LOCATION_MERCHANT_MISMATCH'
        : '',
      location?.status !== 'ACTIVE' ? 'LOCATION_INACTIVE' : '',
      !(location?.capabilities || []).includes('CREDIT_CARD_PROCESSING')
        ? 'CARD_PROCESSING_UNAVAILABLE'
        : '',
      location?.currency !== launchPricing.currency ? 'CURRENCY_NOT_USD' : '',
    ].filter(Boolean)
    result.errorCode = problems[0] || null
    result.ok = problems.length === 0 && config.missing.length === 0
    if (!result.errorCode && config.missing.length)
      result.errorCode = 'CONFIGURATION_INCOMPLETE'
  } catch (error) {
    result.errorCode =
      error instanceof RegistrationError ? error.code : 'VERIFICATION_FAILED'
  }
  return result
}

/* ---------- Catalog plan variations ---------- */
const planName = (plan: BillablePlanId) =>
  launchPricing.plans.find((p) => p.id === plan)!.name
export const catalogPlanName = (plan: BillablePlanId) =>
  `Cottage Pantry ${planName(plan)}`
export const catalogVariationName = (plan: BillablePlanId) =>
  `${planName(plan)} · Monthly`
/** Returns a problem description, or null when the variation exactly matches server config. */
export function variationProblem(object: any, plan: BillablePlanId) {
  const data = object?.subscription_plan_variation_data
  if (object?.type !== 'SUBSCRIPTION_PLAN_VARIATION' || !data)
    return 'Not a subscription plan variation.'
  if (object.is_deleted) return 'Variation is deleted.'
  const phases = data.phases || []
  if (phases.length !== 1)
    return 'Variation must have exactly one indefinite phase (no trial).'
  const phase = phases[0]
  if (phase.cadence !== 'MONTHLY') return 'Cadence must be MONTHLY.'
  if (phase.periods != null) return 'Phase must renew indefinitely.'
  const money = phase.pricing?.price_money || phase.recurring_price_money
  if (phase.pricing?.type && phase.pricing.type !== 'STATIC')
    return 'Pricing must be STATIC.'
  if (!money || money.currency !== 'USD') return 'Currency must be USD.'
  if (Number(money.amount) !== planMonthlyCents(plan))
    return `Amount must be ${planMonthlyCents(plan)} cents.`
  return null
}
export type PlanMapping = {
  planId: BillablePlanId
  catalogPlanId: string
  variationId: string
  amountCents: number
}
/** Sandbox only: reuse exact existing objects or create them idempotently. Never edits
 * or deletes an existing Square object; a mismatch is reported for owner review. */
export async function syncSandboxPlans(transport: typeof fetch = fetch) {
  const objects: any[] = []
  let cursor: string | undefined
  for (let page = 0; page < 10; page++) {
    const result = await squareBillingRequest(
      'sandbox',
      '/v2/catalog/search',
      {
        method: 'POST',
        body: JSON.stringify({
          object_types: ['SUBSCRIPTION_PLAN', 'SUBSCRIPTION_PLAN_VARIATION'],
          include_deleted_objects: false,
          ...(cursor ? { cursor } : {}),
        }),
      },
      transport,
    )
    objects.push(...(result?.objects || []))
    cursor = result?.cursor
    if (!cursor) break
  }
  if (cursor)
    throw new RegistrationError(
      503,
      'CATALOG_SEARCH_INCOMPLETE',
      'The Square catalog search is incomplete. No plans were created; review the catalog before retrying.',
    )
  const mappings: PlanMapping[] = []
  const problems: { planId: BillablePlanId; problem: string }[] = []
  for (const planId of billablePlanIds) {
    const namedPlans = objects.filter(
      (o) =>
        o.type === 'SUBSCRIPTION_PLAN' &&
        o.subscription_plan_data?.name === catalogPlanName(planId),
    )
    if (namedPlans.length > 1) {
      problems.push({
        planId,
        problem:
          'Multiple matching plans require review; no objects were created.',
      })
      continue
    }
    let plan = objects.find(
      (o) =>
        o.type === 'SUBSCRIPTION_PLAN' &&
        o.subscription_plan_data?.name === catalogPlanName(planId),
    )
    let variation = objects.find(
      (o) =>
        o.type === 'SUBSCRIPTION_PLAN_VARIATION' &&
        o.subscription_plan_variation_data?.name ===
          catalogVariationName(planId) &&
        o.subscription_plan_variation_data?.subscription_plan_id === plan?.id,
    )
    const namedVariations = objects.filter(
      (o) =>
        o.type === 'SUBSCRIPTION_PLAN_VARIATION' &&
        o.subscription_plan_variation_data?.name ===
          catalogVariationName(planId) &&
        o.subscription_plan_variation_data?.subscription_plan_id === plan?.id,
    )
    if (namedVariations.length > 1) {
      problems.push({
        planId,
        problem:
          'Multiple matching variations require review; no objects were created.',
      })
      continue
    }
    if (!plan) {
      plan = (
        await squareBillingRequest(
          'sandbox',
          '/v2/catalog/object',
          {
            method: 'POST',
            body: JSON.stringify({
              idempotency_key: `cottage-pantry-sandbox-plan-${planId}-v1`,
              object: {
                type: 'SUBSCRIPTION_PLAN',
                id: '#plan',
                subscription_plan_data: { name: catalogPlanName(planId) },
              },
            }),
          },
          transport,
        )
      )?.catalog_object
    }
    if (!variation && plan?.id) {
      variation = (
        await squareBillingRequest(
          'sandbox',
          '/v2/catalog/object',
          {
            method: 'POST',
            body: JSON.stringify({
              idempotency_key: `cottage-pantry-sandbox-variation-${planId}-${planMonthlyCents(planId)}-v1`,
              object: {
                type: 'SUBSCRIPTION_PLAN_VARIATION',
                id: '#variation',
                subscription_plan_variation_data: {
                  name: catalogVariationName(planId),
                  subscription_plan_id: plan.id,
                  phases: [
                    {
                      cadence: 'MONTHLY',
                      ordinal: 0,
                      pricing: {
                        type: 'STATIC',
                        price_money: {
                          amount: planMonthlyCents(planId),
                          currency: 'USD',
                        },
                      },
                    },
                  ],
                },
              },
            }),
          },
          transport,
        )
      )?.catalog_object
    }
    const problem = plan?.id
      ? variationProblem(variation, planId)
      : 'Plan could not be created.'
    if (problem) problems.push({ planId, problem })
    else
      mappings.push({
        planId,
        catalogPlanId: plan.id,
        variationId: variation.id,
        amountCents: planMonthlyCents(planId),
      })
  }
  return { mappings, problems }
}

/* ---------- Hosted checkout ---------- */
export async function createHostedSubscriptionCheckout(
  environment: BillingEnvironment,
  input: {
    attemptId: string
    planId: BillablePlanId
    variationId: string
    redirectUrl: string
  },
  transport: typeof fetch = fetch,
) {
  const config = billingConfiguration(environment)
  if (!config.checkoutPermitted)
    throw new RegistrationError(
      503,
      'CHECKOUT_UNAVAILABLE',
      'Paid checkout is not available on this deployment. No charge was started.',
    )
  const result = await squareBillingRequest(
    environment,
    '/v2/online-checkout/payment-links',
    {
      method: 'POST',
      body: JSON.stringify({
        // Same attempt → same link on retry/timeouts; never a second checkout.
        idempotency_key: input.attemptId,
        quick_pay: {
          name: `Cottage Pantry ${planName(input.planId)} (monthly)`,
          price_money: {
            amount: planMonthlyCents(input.planId),
            currency: 'USD',
          },
          location_id: config.locationId,
        },
        checkout_options: {
          subscription_plan_id: input.variationId,
          redirect_url: input.redirectUrl,
        },
        payment_note: `cp-attempt:${input.attemptId}`,
      }),
    },
    transport,
  )
  const link = result?.payment_link
  if (!link?.id || !link?.url || !link?.order_id)
    throw new RegistrationError(
      502,
      'CHECKOUT_INCOMPLETE',
      'Square did not return a complete checkout. No access was granted.',
    )
  if (
    !/^https:\/\/([a-z0-9-]+\.)*(square\.link|squareup\.com|squareupsandbox\.com)\//i.test(
      link.url,
    )
  )
    throw new RegistrationError(
      502,
      'CHECKOUT_URL_REJECTED',
      'Square returned an unexpected checkout address.',
    )
  return { linkId: link.id, url: link.url, orderId: link.order_id }
}

/* ---------- Correlation (pure) ---------- */
export type Correlation =
  | { state: 'pending'; reason: string }
  | { state: 'failed'; reason: string }
  | { state: 'needs_review'; reason: string }
  | { state: 'linked'; subscriptionId: string; customerId: string }
/**
 * attempt.order_id → order tenders/payments → exactly one customer → exactly one
 * unclaimed subscription with the attempt's variation and location created after
 * the attempt. Email, phone and names are never used.
 */
export function correlateCheckout(
  attempt: {
    createdAt: string
    planVariationId: string
    locationId: string
    orderId: string
  },
  order: any,
  payments: any[],
  subscriptions: any[],
  claimed: Set<string>,
  now = Date.now(),
): Correlation {
  if (!order || order.id !== attempt.orderId)
    return { state: 'pending', reason: 'Checkout order not found yet.' }
  const forOrder = payments.filter((p) => p?.order_id === attempt.orderId)
  const completed = forOrder.filter((p) => p.status === 'COMPLETED')
  if (!completed.length) {
    if (forOrder.some((p) => ['FAILED', 'CANCELED'].includes(p.status)))
      return {
        state: 'failed',
        reason: 'The initial payment did not complete.',
      }
    return { state: 'pending', reason: 'No completed payment yet.' }
  }
  const customers = new Set(completed.map((p) => p.customer_id).filter(Boolean))
  if (customers.size !== 1)
    return {
      state: 'needs_review',
      reason: 'Payment is not tied to exactly one Square customer.',
    }
  const customerId = [...customers][0] as string
  const since = Date.parse(attempt.createdAt) - 5 * 60000
  const candidates = subscriptions.filter(
    (s) =>
      s?.customer_id === customerId &&
      s.plan_variation_id === attempt.planVariationId &&
      s.location_id === attempt.locationId &&
      Date.parse(s.created_at) >= since &&
      !claimed.has(s.id),
  )
  if (candidates.length > 1)
    return {
      state: 'needs_review',
      reason: 'More than one matching subscription; no access was assigned.',
    }
  if (!candidates.length) {
    const paidAt = Math.max(
      ...completed.map((p) => Date.parse(p.updated_at || p.created_at) || 0),
    )
    return now - paidAt > 3600000
      ? {
          state: 'needs_review',
          reason: 'Payment completed but no matching subscription was found.',
        }
      : {
          state: 'pending',
          reason: 'Waiting for Square to create the subscription.',
        }
  }
  return { state: 'linked', subscriptionId: candidates[0].id, customerId }
}

/* ---------- Invoices and paid coverage (pure) ---------- */
export type NormalizedInvoice = {
  id: string
  version: number
  subscriptionId: string
  status: string
  amountCents: number
  paidCents: number
  refundedCents: number
  currency: string
  serviceFrom: string | null
  serviceThrough: string | null
}
const addMonth = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m, 1))
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  next.setUTCDate(Math.min(d, last))
  return next.toISOString().slice(0, 10)
}
/** Service period = the invoice's service date + one calendar month (monthly-only plans).
 * Dates are interpreted as UTC calendar days; the seller timezone is documented as pending. */
export function normalizeInvoice(invoice: any): NormalizedInvoice {
  const requests = invoice?.payment_requests || []
  const sum = (key: string) =>
    requests.reduce(
      (total: number, r: any) => total + Number(r?.[key]?.amount || 0),
      0,
    )
  const currency =
    requests[0]?.computed_amount_money?.currency ||
    requests[0]?.total_completed_amount_money?.currency ||
    ''
  const paid = sum('total_completed_amount_money')
  const serviceFrom = /^\d{4}-\d{2}-\d{2}$/.test(
    invoice?.sale_or_service_date || '',
  )
    ? invoice.sale_or_service_date
    : null
  return {
    id: String(invoice?.id || ''),
    version: Number(invoice?.version || 0),
    subscriptionId: String(invoice?.subscription_id || ''),
    status: String(invoice?.status || 'UNKNOWN'),
    amountCents: sum('computed_amount_money'),
    paidCents: paid,
    // Square invoices do not carry partial refund amounts; fully refunded = paid.
    refundedCents: invoice?.status === 'REFUNDED' ? paid : 0,
    currency,
    serviceFrom,
    serviceThrough: serviceFrom ? addMonth(serviceFrom) : null,
  }
}
export type Coverage = {
  state:
    | 'payment_processing'
    | 'paid_active'
    | 'past_due'
    | 'cancelled'
    | 'payment_failed'
    | 'expired'
    | 'needs_review'
  paidFrom: string | null
  paidThrough: string | null
  /** Plan whose paid features apply now; null means Free-scope fallback. */
  accessPlan: BillablePlanId | null
  review?: string
}
/** ACTIVE never implies paid. Only PAID, fully settled, undisputed USD invoices for this
 * subscription at or above the plan price establish a service period. */
export function subscriptionCoverage(
  input: {
    planId: BillablePlanId
    subscription: { status?: string; canceled_date?: string } | null
    invoices: NormalizedInvoice[]
    disputed?: boolean
    graceDays: number
  },
  now = Date.now(),
): Coverage {
  const required = planMonthlyCents(input.planId)
  const day = (d: string) => Date.parse(d + 'T00:00:00Z')
  const review = input.invoices.some((i) => i.status === 'PARTIALLY_REFUNDED')
    ? 'A partially refunded invoice needs platform review.'
    : input.disputed
      ? 'A disputed payment needs platform review.'
      : undefined
  const covering = input.disputed
    ? []
    : input.invoices
        .filter(
          (i) =>
            i.status === 'PAID' &&
            i.currency === 'USD' &&
            i.amountCents >= required &&
            i.paidCents - i.refundedCents >= required &&
            i.serviceFrom &&
            i.serviceThrough &&
            day(i.serviceFrom) <= now,
        )
        .sort((a, b) => day(b.serviceThrough!) - day(a.serviceThrough!))
  const latest = covering[0]
  const cancelled =
    input.subscription?.status === 'CANCELED' ||
    !!input.subscription?.canceled_date
  if (latest) {
    const from = latest.serviceFrom!,
      through = latest.serviceThrough!
    if (now < day(through))
      return {
        state: cancelled ? 'cancelled' : 'paid_active',
        paidFrom: from,
        paidThrough: through,
        accessPlan: input.planId,
        review,
      }
    if (!cancelled && now < day(through) + input.graceDays * 86400000)
      return {
        state: 'past_due',
        paidFrom: from,
        paidThrough: through,
        accessPlan: input.planId,
        review,
      }
    return {
      state: 'expired',
      paidFrom: from,
      paidThrough: through,
      accessPlan: null,
      review,
    }
  }
  if (review)
    return {
      state: 'needs_review',
      paidFrom: null,
      paidThrough: null,
      accessPlan: null,
      review,
    }
  const failed = input.invoices.some((i) =>
    ['FAILED', 'CANCELED', 'REFUNDED'].includes(i.status),
  )
  if (failed || cancelled)
    return {
      state: failed ? 'payment_failed' : 'expired',
      paidFrom: null,
      paidThrough: null,
      accessPlan: null,
    }
  return {
    state: 'payment_processing',
    paidFrom: null,
    paidThrough: null,
    accessPlan: null,
  }
}
export const consentHash = (text: string) =>
  createHash('sha256').update(text).digest('hex')
