import type { AdminClient } from './platform-admin-core'
import {
  providerBilledAccess,
  isProviderBilled,
  type BillingPolicyRow,
} from './billing-entitlements'
import type { AccessResult } from './billing-state'
import {
  launchPricing,
  planAssignable,
  type PlanId,
} from '../../src/lib/launch-plans'
export type ManualGrant = {
  id: string
  plan_id: PlanId
  operation: string
  grant_source: string
  owner_identity: string
  actor_identity: string
  reason: string
  created_at: string | Date
  expires_at: string | Date | null
}
export function assignableTierIssue(id: string) {
  const plan = launchPricing.plans.find((p) => p.id === id)
  if (!plan) return 'Unknown tier.'
  if (plan.users === null)
    return 'Team allowance needs explicit configuration; activation is blocked.'
  if (!planAssignable(plan.id))
    return 'Tier is not approved for internal assignment.'
  return null
}
export function effectiveAccess(
  billing: BillingPolicyRow | null | undefined,
  grant: ManualGrant | null | undefined,
  owner: string,
  now = Date.now(),
) {
  // Identity and active workspace membership are verified before this resolver.
  // There is no global business-suspension field. Fail closed on explicit blocked billing/account state.
  const suspended =
    billing &&
    ['suspended', 'security_suspended', 'disabled'].includes(billing.status)
  const valid =
    grant?.operation === 'grant' &&
    grant.owner_identity === owner &&
    Date.parse(String(grant.created_at)) <= now &&
    (!grant.expires_at || Date.parse(String(grant.expires_at)) > now) &&
    !assignableTierIssue(grant.plan_id)
  let access: AccessResult | null = null
  let source = 'unassigned'
  if (suspended) {
    access = {
      plan: null,
      write: false,
      state: 'expired',
      entitlementPolicy: 'kitchen-two-v1',
    }
    source = 'security_suspension'
  } else if (valid) {
    access = {
      plan: grant.plan_id,
      write: true,
      state: 'complimentary',
      entitlementPolicy: 'kitchen-two-v1',
    }
    source = grant.grant_source
  } else if (isProviderBilled(billing)) {
    access = providerBilledAccess(billing!, now)
    source = billing!.source
  } else if (
    billing?.plan_id &&
    ['free_active', 'complimentary', 'paid_active'].includes(billing.status)
  ) {
    access = {
      plan: billing.plan_id,
      write: true,
      state: billing.status as AccessResult['state'],
      entitlementPolicy: billing.entitlement_policy || 'legacy',
    }
    source = billing.source
  }
  // Preserve the established legacy access model for ovens with no billing row.
  return {
    access,
    source,
    plan: access?.plan || null,
    assigned: valid ? grant!.plan_id : null,
    legacy: !billing && !valid,
    suspended: !!suspended,
    manualValid: !!valid,
  }
}
export async function latestManualGrant(
  c: Pick<AdminClient, 'query'>,
  businessId: string,
): Promise<ManualGrant | null> {
  return (
    ((
      await c.query(
        'SELECT id,plan_id,operation,grant_source,owner_identity,actor_identity,reason,created_at,expires_at FROM complimentary_grants WHERE business_id=$1 AND grant_source IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1',
        [businessId],
      )
    ).rows[0] as unknown as ManualGrant) || null
  )
}
