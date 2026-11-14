import { randomUUID } from 'node:crypto'
import { AdminError, type AdminClient } from './platform-admin-core'
import type { AdminMetadata } from '../../src/lib/platform-admin-types'
import {
  launchPricing,
  planMonthlyCents,
  planBillable,
} from '../../src/lib/launch-plans'
import { deploymentRuntime } from './runtime-environment'
import {
  openStripe,
  sealStripe,
  stripeEndpoint,
  stripeRequest,
  validatedPrice,
  stripeEventsRequired,
  stripePortalMatchesPolicy,
  stripeTierPurchasable,
  type StripeEnvironment,
} from './stripe-provider'

/** Resource setup never charges a customer or enables checkout. */
export async function setupStripeBilling(
  c: Pick<AdminClient, 'query'>,
  row: AdminMetadata,
  e: StripeEnvironment,
) {
  if (!row?.ciphertext || !row.validated_at)
    throw new AdminError(
      409,
      'VALIDATION_REQUIRED',
      'Connect and validate the Stripe account first.',
    )
  const endpoint = stripeEndpoint(e)
  if (
    !endpoint ||
    (e === 'live' && deploymentRuntime().context !== 'production')
  )
    throw new AdminError(
      409,
      'DEPLOYMENT_REQUIRED',
      'Set up this environment on its trusted deployed site. LIVE setup requires production.',
    )
  const credentials = openStripe(row.ciphertext, e)
  const { key } = credentials
  const account = await stripeRequest(key, '/account')
  if (account.id !== row.account_id)
    throw new AdminError(
      409,
      'ACCOUNT_CHANGED',
      'The credential no longer matches the saved account.',
    )
  const configuration = { ...row.configuration }
  const mappings: AdminMetadata = { ...configuration.mappings }
  for (const plan of launchPricing.plans.filter((p) => p.monthlyUsd > 0)) {
    if (!planBillable(plan.id)) continue
    const lookup = `cottage_pantry_${e}_${plan.id.replaceAll('-', '_')}_monthly_v1`
    const existing = await stripeRequest(
      key,
      `/prices?lookup_keys[]=${lookup}&limit=2`,
    )
    let price = existing.data?.[0]
    if (!price) {
      const product = await stripeRequest(
        key,
        '/products',
        new URLSearchParams({
          name: `Cottage Pantry · ${plan.name}`,
          'metadata[cottage_pantry_tier]': plan.id,
        }),
        lookup + '_product',
      )
      price = await stripeRequest(
        key,
        '/prices',
        new URLSearchParams({
          product: product.id,
          currency: 'usd',
          unit_amount: String(planMonthlyCents(plan.id)),
          'recurring[interval]': 'month',
          lookup_key: lookup,
        }),
        lookup + '_price',
      )
    }
    await validatedPrice(key, price.id, plan.id, e)
    mappings[plan.id] = {
      price: price.id,
      purchase: stripeTierPurchasable(plan.id, e),
      account: account.id,
      verifiedAt: new Date().toISOString(),
    }
  }
  let portal: AdminMetadata | undefined
  if (configuration.policy?.portal)
    portal = await stripeRequest(
      key,
      '/billing_portal/configurations/' + configuration.policy.portal,
    )
  if (!portal || !stripePortalMatchesPolicy(portal, e)) {
    portal = await stripeRequest(
      key,
      '/billing_portal/configurations',
      new URLSearchParams({
        'features[payment_method_update][enabled]': 'true',
        'features[invoice_history][enabled]': 'true',
        'features[subscription_update][enabled]': 'false',
        'features[subscription_cancel][enabled]': 'false',
        'business_profile[headline]': 'Cottage Pantry billing',
        default_return_url: 'https://mycottagepantry.com/oven/billing',
      }),
      `cottage_pantry_${e}_portal_v1`,
    )
  }
  if (!stripePortalMatchesPolicy(portal, e))
    throw new AdminError(
      409,
      'PORTAL_POLICY',
      'Stripe did not accept the supported portal configuration.',
    )
  // A signing secret is returned only on creation. Never reuse an endpoint whose
  // secret is unknown, and never overwrite an existing administrator-owned endpoint.
  if (!credentials.signing) {
    const body = new URLSearchParams({
      url: endpoint,
      api_version: '2025-04-30.basil',
    })
    for (const event of [...stripeEventsRequired, 'product.updated'])
      body.append('enabled_events[]', event)
    const webhook = await stripeRequest(
      key,
      '/webhook_endpoints',
      body,
      `cottage_pantry_${e}_webhook_${Buffer.from(endpoint).toString('base64url')}_v1`,
    )
    if (!/^whsec_[A-Za-z0-9]+$/.test(webhook.secret || ''))
      throw new AdminError(
        409,
        'WEBHOOK_SECRET_REQUIRED',
        'Stripe did not return the webhook signing secret. Save the endpoint secret in the protected settings.',
      )
    credentials.signing = webhook.secret
    configuration.webhookEndpoint = webhook.id
  }
  configuration.mappings = mappings
  configuration.policy = {
    trial: 'none',
    pastDue: 'paid_coverage_only',
    cancellation: 'separate_review',
    changes: 'disabled',
    proration: 'disabled',
    portal: portal.id,
    approvedAt: new Date().toISOString(),
  }
  delete configuration.apiError
  delete configuration.setupError
  delete configuration.hostedLaunchReady
  configuration.hostedSetupComplete = true
  await c.query(
    'UPDATE stripe_provider_settings SET ciphertext=$2,configuration=$3,updated_at=NOW() WHERE environment=$1',
    [e, sealStripe(credentials, e), configuration],
  )
  // Stripe sends the actual signed event asynchronously. Only the webhook handler
  // can record successful delivery; a local setup action cannot manufacture it.
  if (configuration.webhookEndpoint) {
    const first = Object.values(mappings)[0] as AdminMetadata | undefined
    if (first) {
      const price = await validatedPrice(
        key,
        first.price,
        Object.keys(mappings)[0],
        e,
      )
      await stripeRequest(
        key,
        '/products/' + price.product.id,
        new URLSearchParams({
          'metadata[cottage_pantry_delivery_check]': randomUUID(),
        }),
      )
    }
  }
}
