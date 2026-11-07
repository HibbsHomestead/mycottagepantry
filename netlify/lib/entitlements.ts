import {
  featureStatusForPlan,
  planIncludes,
  planAssignable,
  type FeatureId,
  type PlanId,
} from '../../src/lib/launch-plans'

/** Server-owned policy only. Never construct this context from a request body or plan label.
 * Prepared for reviewed subscription storage/webhooks; not assigned to existing workspaces. */
export type SubscriptionAccess = {
  plan: PlanId | null
  status: 'trial' | 'active' | 'grace' | 'read_only' | 'unassigned'
  trialEndsAt?: string
}
export function entitlementDecision(
  subscription: SubscriptionAccess,
  feature: FeatureId,
  operation: 'read' | 'write' | 'export',
  now = Date.now(),
) {
  // Historical reads and exports survive cancellation/downgrade; membership is always required separately.
  if (
    operation === 'read' ||
    (feature === 'dataExport' && operation === 'export')
  )
    return true
  if (
    !subscription.plan ||
    // Unpublished drafts grant nothing until approved storage/billing exists.
    !planAssignable(subscription.plan) ||
    subscription.status === 'unassigned' ||
    subscription.status === 'read_only'
  )
    return false
  if (
    subscription.status === 'trial' &&
    (!subscription.trialEndsAt ||
      Date.parse(subscription.trialEndsAt) <= now ||
      !Number.isFinite(Date.parse(subscription.trialEndsAt)))
  )
    return false
  return (
    featureStatusForPlan(subscription.plan, feature) === 'implemented' &&
    planIncludes(subscription.plan, feature)
  )
}
export function requireEntitlement(
  subscription: SubscriptionAccess,
  feature: FeatureId,
  operation: 'read' | 'write' | 'export',
) {
  if (!entitlementDecision(subscription, feature, operation))
    throw new Error('This action is unavailable for this oven subscription.')
}
