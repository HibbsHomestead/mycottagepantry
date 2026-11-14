import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { z } from 'zod'
import { AdminError, audit, type AdminClient } from './platform-admin-core'
import type { AdminMetadata } from '../../src/lib/platform-admin-types'
import {
  launchPricing,
  planMonthlyCents,
  planBillable,
} from '../../src/lib/launch-plans'
import { limitedBody } from './support-core'
import {
  serverEnvironment as env,
  deploymentRuntime,
  stripeEncryptionStatus,
  stripeCredentialRoot,
} from './runtime-environment'

export type StripeEnvironment = 'test' | 'live'
export const stripeApiVersion = '2025-04-30.basil'
/** All paid tiers are owner-approved for testing; live rollout remains separate. */
export function stripeTierPurchasable(plan: unknown, e: StripeEnvironment) {
  const tier = launchPricing.plans.find((p) => p.id === plan)
  return (
    !!tier &&
    planBillable(plan) &&
    tier.users !== null &&
    (e === 'test' || tier.stripeLiveApproved)
  )
}
export function stripePortalMatchesPolicy(
  configuration: AdminMetadata,
  e: StripeEnvironment,
) {
  return (
    configuration.active === true &&
    configuration.livemode === (e === 'live') &&
    configuration.features?.payment_method_update?.enabled === true &&
    configuration.features?.invoice_history?.enabled === true &&
    configuration.features?.subscription_update?.enabled === false &&
    configuration.features?.subscription_cancel?.enabled === false
  )
}
export const stripeEventsRequired = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
]
export function stripeEndpoint(e: StripeEnvironment) {
  const { context, previewOrigin } = deploymentRuntime()
  if (context === 'deploy-preview') {
    return e === 'test' && previewOrigin
      ? previewOrigin + '/api/stripe/test/webhook'
      : ''
  }
  return context === 'production'
    ? `https://mycottagepantry.com/api/stripe/${e}/webhook`
    : ''
}
export function stripeEncryptionReady() {
  return stripeEncryptionStatus().ready
}
function root(hostedCredential = false) {
  if (!stripeEncryptionReady())
    throw new AdminError(
      503,
      'ENCRYPTION_SETUP_REQUIRED',
      'Protected Stripe encryption storage needs hosting setup. No credentials were saved.',
    )
  const value = env(
    hostedCredential
      ? 'STRIPE_LIVE_SECRET_KEY'
      : 'STRIPE_BILLING_ENCRYPTION_KEY',
  )
  return stripeCredentialRoot(value)
    ? Buffer.from(
        hkdfSync('sha256', value, '', 'cottage-stripe:storage-root:v1', 32),
      )
    : Buffer.from(value, 'hex')
}
export function sealStripe(value: unknown, binding: string) {
  const hostedCredential = stripeEncryptionStatus().source === 'live_credential'
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', root(hostedCredential), iv)
  cipher.setAAD(Buffer.from('cottage-stripe:v1:' + binding))
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])
  return [
    hostedCredential ? 'v2live' : 'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    data.toString('base64url'),
  ].join('.')
}
export function openStripe(value: string, binding: string) {
  const [v, iv, tag, data] = value.split('.')
  if (v !== 'v1' && v !== 'v2live')
    throw new Error('Unsupported credential format')
  const cipher = createDecipheriv(
    'aes-256-gcm',
    root(v === 'v2live'),
    Buffer.from(iv, 'base64url'),
  )
  cipher.setAAD(Buffer.from('cottage-stripe:v1:' + binding))
  cipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(data, 'base64url')),
      cipher.final(),
    ]).toString('utf8'),
  ) as { key: string; signing: string }
}
export function keyMatches(key: string, environment: StripeEnvironment) {
  return new RegExp(`^(sk|rk)_${environment}_`).test(key)
}
/** Fixed Stripe origin, internal paths only, no redirects or raw provider errors. */
export async function stripeRequest(
  key: string,
  path: string,
  body?: URLSearchParams,
  idempotency?: string,
): Promise<AdminMetadata> {
  if (
    !/^\/[a-z_]+(?:\/[A-Za-z0-9_]+)*(?:\?[a-z_]+(?:\[\])?=[A-Za-z0-9_]+(?:&[a-z_]+(?:\[\])?=[A-Za-z0-9_]+)*)?$/.test(
      path,
    )
  )
    throw new Error('Invalid internal Stripe path')
  let response: Response
  try {
    response = await fetch('https://api.stripe.com/v1' + path, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: 'Bearer ' + key,
        'Stripe-Version': stripeApiVersion,
        ...(body
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
        ...(idempotency ? { 'Idempotency-Key': idempotency } : {}),
      },
      body,
    })
  } catch {
    throw new AdminError(
      502,
      'STRIPE_UNAVAILABLE',
      'Stripe is temporarily unavailable. Existing access is preserved.',
    )
  }
  if (!response.ok)
    throw new AdminError(
      502,
      'STRIPE_REQUEST_REJECTED',
      'Stripe rejected this request. Check the account, key permissions and object configuration.',
    )
  return response.json()
}
export async function stripeSettings(
  c: Pick<AdminClient, 'query'>,
  e: StripeEnvironment,
  lock = false,
) {
  const read = async (locked = lock) =>
    (
      await c.query(
        'SELECT * FROM stripe_provider_settings WHERE environment=$1' +
          (locked ? ' FOR UPDATE' : ''),
        [e],
      )
    ).rows[0]
  let row = await read()
  if (
    row?.ciphertext ||
    row?.configuration?.hostingImportDisabled ||
    !stripeEncryptionReady()
  )
    return row
  const configured = env(`STRIPE_${e.toUpperCase()}_SECRET_KEY`)
  const legacy = env('STRIPE_BILLING_ENCRYPTION_KEY')
  const key =
    configured ||
    (stripeCredentialRoot(legacy) && keyMatches(legacy, e) ? legacy : '')
  if (!key || !keyMatches(key, e)) return row
  // Serialize imports and preserve existing account bindings and explicit disconnections.
  await c.query(
    'INSERT INTO stripe_provider_settings(environment) VALUES($1) ON CONFLICT DO NOTHING',
    [e],
  )
  row = await read(true)
  if (row.ciphertext || row.configuration?.hostingImportDisabled) return row
  const account = await stripeRequest(key, '/account')
  if (row.account_id && row.account_id !== account.id)
    throw new AdminError(
      409,
      'ACCOUNT_CHANGED',
      'The hosting credential belongs to another Stripe account. Existing account links were preserved.',
    )
  for (const path of [
    '/prices?limit=1',
    '/subscriptions?limit=1',
    '/checkout/sessions?limit=1',
    '/invoices?limit=1',
    '/billing_portal/configurations?limit=1',
  ])
    await stripeRequest(key, path)
  const signing = env(`STRIPE_${e.toUpperCase()}_WEBHOOK_SECRET`)
  if (signing && !/^whsec_[A-Za-z0-9]+$/.test(signing))
    throw new AdminError(
      503,
      'SIGNING_FORMAT',
      'The configured webhook signing secret has an invalid format.',
    )
  await c.query(
    'UPDATE stripe_provider_settings SET ciphertext=$2,fingerprint=$3,account_id=$4,account_name=$5,validated_at=NOW(),checkout_enabled=false,updated_at=NOW() WHERE environment=$1',
    [
      e,
      sealStripe({ key, signing }, e),
      'sha256:' + createHash('sha256').update(key).digest('hex').slice(0, 12),
      account.id,
      account.business_profile?.name ||
        account.settings?.dashboard?.display_name ||
        account.id,
    ],
  )
  row = await read()
  // Hosting configuration authorizes a one-time bootstrap on the trusted deployed
  // environment. The row lock serializes concurrent requests; clients cannot
  // choose credentials, destinations, prices, or activation through this path.
  if (stripeEndpoint(e)) {
    // Resource setup must not roll back a successfully verified connection.
    await c.query('SAVEPOINT stripe_hosting_setup')
    try {
      const { setupStripeBilling } = await import('./stripe-setup')
      await setupStripeBilling(c, row, e)
      await c.query('RELEASE SAVEPOINT stripe_hosting_setup')
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT stripe_hosting_setup')
      await c.query('RELEASE SAVEPOINT stripe_hosting_setup')
      await c.query(
        `UPDATE stripe_provider_settings SET configuration=configuration || '{"setupError":"BILLING_SETUP_INCOMPLETE"}'::jsonb WHERE environment=$1`,
        [e],
      )
    }
    row = await read()
  }
  return row
}

export function verifyStripeSignature(
  raw: string,
  header: string,
  signing: string,
  now = Date.now(),
) {
  const parts = header.split(',')
  const t = parts.find((p) => p.startsWith('t='))?.slice(2) || ''
  if (!/^\d+$/.test(t) || Math.abs(now / 1000 - Number(t)) > 300) return false
  const expected = createHmac('sha256', signing)
    .update(t + '.' + raw)
    .digest()
  return parts
    .filter((p) => p.startsWith('v1='))
    .some((p) => {
      const h = p.slice(3)
      return (
        /^[a-f\d]{64}$/i.test(h) &&
        timingSafeEqual(expected, Buffer.from(h, 'hex'))
      )
    })
}
export function stripePriceIssue(
  price: AdminMetadata,
  planId: string,
  e: StripeEnvironment,
) {
  if (!planBillable(planId)) return 'Unknown paid tier'
  if (price.livemode !== (e === 'live')) return 'Wrong environment'
  if (
    !price.active ||
    price.type !== 'recurring' ||
    price.recurring?.interval !== 'month' ||
    price.recurring?.interval_count !== 1 ||
    price.recurring?.usage_type !== 'licensed'
  )
    return 'An active monthly licensed recurring price is required'
  if (
    price.currency !== 'usd' ||
    price.unit_amount !== planMonthlyCents(planId) ||
    price.billing_scheme !== 'per_unit' ||
    price.transform_quantity
  )
    return 'Currency, amount or pricing model does not match the approved tier'
  if (
    typeof price.product !== 'object' ||
    !price.product.active ||
    price.product.metadata?.cottage_pantry_tier !== planId
  )
    return 'Set product metadata cottage_pantry_tier to the exact tier ID'
  return null
}
export async function validatedPrice(
  key: string,
  priceId: string,
  plan: string,
  e: StripeEnvironment,
) {
  if (!/^price_[A-Za-z0-9]+$/.test(priceId))
    throw new AdminError(400, 'PRICE_INVALID', 'A Stripe Price ID is required.')
  const price = await stripeRequest(key, `/prices/${priceId}`)
  if (typeof price.product === 'string')
    price.product = await stripeRequest(key, '/products/' + price.product)
  const issue = stripePriceIssue(price, plan, e)
  if (issue) throw new AdminError(409, 'PRICE_INVALID', issue)
  return price
}
export async function stripeAdminView(c: AdminClient) {
  const encryptionStatus = stripeEncryptionStatus()
  const connectionErrors: Partial<Record<StripeEnvironment, string>> = {}
  // A rejected TEST credential must not hide the LIVE account (or vice versa).
  for (const environment of ['test', 'live'] as const) {
    await c.query('SAVEPOINT stripe_connection_status')
    try {
      await stripeSettings(c, environment)
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT stripe_connection_status')
      connectionErrors[environment] = 'STRIPE_CONNECTION_UNAVAILABLE'
    }
    await c.query('RELEASE SAVEPOINT stripe_connection_status')
  }
  const rows = (
    await c.query(
      'SELECT environment,fingerprint,account_id,account_name,validated_at,webhook_verified_at,checkout_enabled,configuration,updated_at FROM stripe_provider_settings ORDER BY environment',
    )
  ).rows
  const events = (
    await c.query(
      'SELECT id,environment,kind,status,attempts,error_code,received_at,processed_at FROM stripe_events ORDER BY received_at DESC LIMIT 100',
    )
  ).rows
  const evidence = (
    await c.query(
      'SELECT environment,count(*) FILTER(WHERE subscription_id IS NOT NULL)::int AS checkouts,count(*) FILTER(WHERE access_verified_at IS NOT NULL)::int AS access,count(*) FILTER(WHERE portal_launched_at IS NOT NULL AND reconciled_at>portal_launched_at)::int AS portal FROM stripe_checkouts GROUP BY environment',
    )
  ).rows
  return {
    rows,
    connectionErrors,
    events,
    evidence,
    encryptionReady: encryptionStatus.ready,
    encryptionStatus,
    apiVersion: stripeApiVersion,
    eventsRequired: stripeEventsRequired,
    endpoints: { test: stripeEndpoint('test'), live: stripeEndpoint('live') },
    tiers: launchPricing.plans,
  }
}
export async function stripeAdminAction(
  c: AdminClient,
  request: Request,
  session: AdminMetadata,
  reference: string,
) {
  if (!session.mfa_at || !['owner', 'admin'].includes(session.role))
    throw new AdminError(
      403,
      'ADMIN_REQUIRED',
      'Verified platform administrator access is required.',
    )
  await c.query("SELECT set_config('app.billing_worker','true',true)")
  if (request.method === 'GET') return stripeAdminView(c)
  if (request.method !== 'POST')
    throw new AdminError(405, 'POST_REQUIRED', 'Use POST.')
  const input = z
    .object({
      environment: z.enum(['test', 'live']),
      operation: z.enum([
        'setup',
        'save',
        'rotate',
        'test',
        'map',
        'policy',
        'enable',
        'disable',
        'disconnect',
        'retry',
      ]),
      key: z.string().max(300).optional(),
      signing: z.string().max(300).optional(),
      plan: z.string().max(100).optional(),
      price: z.string().max(100).optional(),
      purchase: z.boolean().optional(),
      confirmation: z.string().max(200).optional(),
      subscriberReview: z.string().trim().max(2000).optional(),
      portalConfiguration: z.string().max(100).optional(),
      eventId: z.string().max(100).optional(),
    })
    .strict()
    .parse(JSON.parse((await limitedBody(request, 5000)).toString()))
  if (
    !['test', 'retry'].includes(input.operation) &&
    Date.parse(String(session.mfa_at)) < Date.now() - 10 * 60000
  )
    throw new AdminError(
      403,
      'RECENT_AUTH_REQUIRED',
      'Sign out and verify your existing admin authentication again before changing billing configuration.',
    )
  const e = input.environment
  await c.query(
    'INSERT INTO stripe_provider_settings(environment) VALUES($1) ON CONFLICT DO NOTHING',
    [e],
  )
  const row = await stripeSettings(c, e, true),
    config = row.configuration || {}
  if (input.operation === 'setup') {
    const { setupStripeBilling } = await import('./stripe-setup')
    await setupStripeBilling(c, row, e)
  } else if (input.operation === 'save' || input.operation === 'rotate') {
    if (new URL(request.url).protocol !== 'https:')
      throw new AdminError(
        403,
        'HTTPS_REQUIRED',
        'Credential changes require HTTPS.',
      )
    if (
      input.confirmation !==
      `${input.operation === 'rotate' ? 'ROTATE' : 'SAVE'} ${e.toUpperCase()}`
    )
      throw new AdminError(
        409,
        'CONFIRMATION_REQUIRED',
        'Confirm credential save or rotation.',
      )
    const old = row.ciphertext
      ? openStripe(row.ciphertext, e)
      : { key: '', signing: '' }
    const key = input.key || old.key,
      signing = input.signing || old.signing
    if (
      !keyMatches(key, e) ||
      (signing && !/^whsec_[A-Za-z0-9]+$/.test(signing))
    )
      throw new AdminError(
        400,
        'KEY_ENVIRONMENT',
        'Credentials do not match the selected environment or expected format.',
      )
    // Rotating API credentials clears validation and mappings; signing changes clear delivery evidence.
    await c.query(
      'UPDATE stripe_provider_settings SET ciphertext=$2,fingerprint=$3,validated_at=NULL,webhook_verified_at=NULL,checkout_enabled=false,configuration=$4,updated_at=NOW() WHERE environment=$1',
      [
        e,
        sealStripe({ key, signing }, e),
        'sha256:' + createHash('sha256').update(key).digest('hex').slice(0, 12),
        { ...config, apiError: null, mappings: {} },
      ],
    )
  } else if (input.operation === 'test') {
    if (
      row.last_test_at &&
      Date.parse(String(row.last_test_at)) > Date.now() - 30000
    )
      throw new AdminError(
        429,
        'TEST_RATE_LIMIT',
        'Wait 30 seconds before testing this connection again.',
      )
    await c.query(
      'UPDATE stripe_provider_settings SET last_test_at=NOW() WHERE environment=$1',
      [e],
    )
    try {
      const { key } = openStripe(row.ciphertext || '', e)
      const account = await stripeRequest(key, '/account')
      // Read scopes used by checkout/reconciliation and the hosted portal. Write permissions
      // are only proven by actual test checkout/portal; API validation is not setup completion.
      for (const path of [
        '/prices?limit=1',
        '/subscriptions?limit=1',
        '/checkout/sessions?limit=1',
        '/invoices?limit=1',
        '/billing_portal/configurations?limit=1',
      ])
        await stripeRequest(key, path)
      if (row.account_id && row.account_id !== account.id)
        throw new AdminError(
          409,
          'ACCOUNT_CHANGED',
          'Account changes require a reviewed disconnection first. Existing subscriptions remain linked to the original account.',
        )
      delete config.apiError
      await c.query(
        'UPDATE stripe_provider_settings SET account_id=$2,account_name=$3,validated_at=NOW(),configuration=$4 WHERE environment=$1',
        [
          e,
          account.id,
          account.business_profile?.name ||
            account.settings?.dashboard?.display_name ||
            account.id,
          config,
        ],
      )
    } catch {
      config.apiError = 'CONNECTION_TEST_FAILED'
      await c.query(
        'UPDATE stripe_provider_settings SET configuration=$2,checkout_enabled=false WHERE environment=$1',
        [e, config],
      )
    }
  } else if (input.operation === 'map') {
    if (!row.validated_at || config.apiError || !input.plan || !input.price)
      throw new AdminError(
        409,
        'VALIDATION_REQUIRED',
        'Test the API connection and choose a tier and Price ID first.',
      )
    const plan = launchPricing.plans.find((p) => p.id === input.plan)
    if (
      !plan ||
      plan.monthlyUsd === 0 ||
      (input.purchase && !stripeTierPurchasable(input.plan, e))
    )
      throw new AdminError(
        409,
        'TIER_INCOMPLETE',
        'This tier is not approved for purchase or its user allowance is unresolved.',
      )
    const { key } = openStripe(row.ciphertext, e)
    await validatedPrice(key, input.price, input.plan, e)
    config.mappings = {
      ...config.mappings,
      [input.plan]: {
        price: input.price,
        purchase: !!input.purchase,
        verifiedAt: new Date().toISOString(),
        account: row.account_id,
      },
    }
    await c.query(
      'UPDATE stripe_provider_settings SET configuration=$2,checkout_enabled=false WHERE environment=$1',
      [e, config],
    )
  } else if (input.operation === 'policy') {
    if (input.confirmation !== 'APPROVE POLICIES')
      throw new AdminError(
        409,
        'CONFIRMATION_REQUIRED',
        'Review the supported billing policies before approving them.',
      )
    if (!/^bpc_[A-Za-z0-9]+$/.test(input.portalConfiguration || ''))
      throw new AdminError(
        409,
        'PORTAL_CONFIGURATION',
        'Provide a reviewed Stripe portal configuration.',
      )
    const { key } = openStripe(row.ciphertext, e)
    const portal = await stripeRequest(
      key,
      '/billing_portal/configurations/' + input.portalConfiguration,
    )
    if (!stripePortalMatchesPolicy(portal, e))
      throw new AdminError(
        409,
        'PORTAL_POLICY',
        'Use an active portal with payment-method updates and invoices enabled, and plan changes and cancellation disabled.',
      )
    config.policy = {
      trial: 'none',
      pastDue: 'paid_coverage_only',
      cancellation: 'separate_review',
      changes: 'disabled',
      proration: 'disabled',
      portal: input.portalConfiguration,
      approvedAt: new Date().toISOString(),
    }
    await c.query(
      'UPDATE stripe_provider_settings SET configuration=$2,checkout_enabled=false WHERE environment=$1',
      [e, config],
    )
  } else if (input.operation === 'enable') {
    if (
      input.confirmation !== `ENABLE ${e.toUpperCase()} CHECKOUT` ||
      !row.validated_at ||
      config.apiError ||
      !row.webhook_verified_at ||
      !stripeEndpoint(e) ||
      !config.policy ||
      !Object.values(config.mappings || {}).some(
        (m) => !!(m as AdminMetadata)?.purchase,
      )
    )
      throw new AdminError(
        409,
        'SETUP_INCOMPLETE',
        'API, verified webhook, policies, approved price mappings and explicit confirmation are required.',
      )
    if (e === 'live') {
      const test = (
        await c.query(
          "SELECT count(*) FILTER(WHERE subscription_id IS NOT NULL)>0 AS checkout,count(*) FILTER(WHERE access_verified_at IS NOT NULL)>0 AS access,count(*) FILTER(WHERE portal_launched_at IS NOT NULL AND reconciled_at>portal_launched_at)>0 AS portal FROM stripe_checkouts WHERE environment='test'",
        )
      ).rows[0]
      if (
        deploymentRuntime().context !== 'production' ||
        !input.subscriberReview ||
        input.subscriberReview.length < 20 ||
        !test.checkout ||
        !test.access ||
        !test.portal
      )
        throw new AdminError(
          409,
          'CUTOVER_REVIEW_REQUIRED',
          'Complete test checkout, access and portal evidence; review authoritative live Square subscriber state and record the cutover decision on production before activation.',
        )
      config.subscriberReview = input.subscriberReview
    }
    await c.query(
      'UPDATE stripe_provider_settings SET checkout_enabled=true,configuration=$2 WHERE environment=$1',
      [e, config],
    )
  } else if (input.operation === 'disable') {
    await c.query(
      `UPDATE stripe_provider_settings SET checkout_enabled=false,configuration=configuration || '{"launchDisabled":true}'::jsonb WHERE environment=$1`,
      [e],
    )
  } else if (input.operation === 'disconnect') {
    if (input.confirmation !== `DISCONNECT ${e.toUpperCase()}`)
      throw new AdminError(
        409,
        'CONFIRMATION_REQUIRED',
        'Disconnect disables new checkout and reconciliation; it does not cancel subscriptions or remove paid coverage.',
      )
    const linked = (
      await c.query(
        "SELECT count(*)::int AS count FROM stripe_checkouts WHERE environment=$1 AND status IN ('creating','open','complete')",
        [e],
      )
    ).rows[0].count
    if (linked)
      throw new AdminError(
        409,
        'SUBSCRIPTIONS_DEPEND_ON_CONNECTION',
        'Pending checkouts or subscriptions still depend on this connection. Disable new checkout instead; keep credentials for webhook reconciliation.',
      )
    await c.query(
      'UPDATE stripe_provider_settings SET ciphertext=NULL,fingerprint=NULL,validated_at=NULL,webhook_verified_at=NULL,checkout_enabled=false,configuration=$2 WHERE environment=$1',
      [e, { hostingImportDisabled: true }],
    )
  } else if (input.operation === 'retry') {
    const event = (
      await c.query(
        "SELECT * FROM stripe_events WHERE id=$1 AND environment=$2 AND status='failed' FOR UPDATE",
        [input.eventId, e],
      )
    ).rows[0]
    if (!event)
      throw new AdminError(
        409,
        'EVENT_NOT_RETRYABLE',
        'Only a failed recorded event can be retried.',
      )
    const { processStripeEvent } = await import('./stripe-subscriptions')
    await processStripeEvent(c, event)
  }
  await audit(
    c,
    session.identity_id,
    'stripe:' + input.operation,
    e,
    input.operation === 'test' && config.apiError ? 'failed' : 'success',
    reference,
    null,
    null,
    { environment: e, plan: input.plan || null },
  )
  return stripeAdminView(c)
}
