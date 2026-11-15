import { launchPricing } from '../../src/lib/launch-plans'
import type { AdminMetadata } from '../../src/lib/platform-admin-types'
import {
  stripeCheckoutEnabled,
  stripeTierPurchasable,
  type StripeEnvironment,
} from './stripe-provider'

/** Public explanations contain no account, Price or credential identifiers. */
export function stripePlanAvailability(
  row: AdminMetadata | undefined,
  environment: StripeEnvironment,
  production: boolean,
  newCheckout = true,
) {
  return launchPricing.plans.map((plan) => {
    const mapping = row?.configuration?.mappings?.[plan.id]
    let reason = ''
    if (plan.id === 'free')
      return {
        id: plan.id,
        purchasable: false,
        reason: 'Free account setup. No payment method required.',
      }
    if (!stripeTierPurchasable(plan.id, environment))
      reason = 'Purchase approval is missing for this tier.'
    else if (environment === 'live' && !production)
      reason = 'LIVE purchases are available on the production site.'
    else if (!row?.validated_at || row.configuration?.apiError)
      reason = 'The Stripe connection needs verification.'
    else if (!row.webhook_verified_at)
      reason = 'Signed Stripe webhook delivery needs verification.'
    else if (
      !mapping?.verifiedAt ||
      !/^price_[A-Za-z0-9]+$/.test(mapping.price || '')
    )
      reason = 'A validated recurring Price mapping is missing for this tier.'
    else if (mapping.account !== row.account_id)
      reason =
        'The recurring Price mapping needs verification for the connected account.'
    else if (!mapping.purchase)
      reason = 'Purchase availability has not been approved for this tier.'
    else if (!row.configuration?.policy)
      reason = 'Billing policy approval is missing.'
    else if (newCheckout && !stripeCheckoutEnabled(row, environment))
      reason = `${environment.toUpperCase()} checkout activation is pending.`
    return {
      id: plan.id,
      purchasable: !reason,
      reason: reason || 'Available monthly subscription.',
    }
  })
}
