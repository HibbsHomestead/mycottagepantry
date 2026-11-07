import { planDetails, sandboxBillingPolicy } from '../../src/lib/registration'
import {
  featureStatusForPlan,
  planIncludes,
  planAssignable,
  planBillable,
  type PlanId,
  type FeatureId,
  type EntitlementPolicy,
} from '../../src/lib/launch-plans'
import { legacyPlanIncludes } from './legacy-plan-scope'
export type BillingState =
  | 'email_unverified'
  | 'setup_incomplete'
  | 'free_active'
  | 'checkout_pending'
  | 'payment_processing'
  | 'paid_active'
  | 'past_due'
  | 'cancelled'
  | 'expired'
  | 'complimentary'
  | 'payment_failed'
  | 'needs_review'
export type PaidEvidence = {
  environment: 'sandbox'
  workspaceId: string
  subscriptionId: string
  planId: PlanId
  invoiceId: string
  invoiceStatus: string
  paymentStatus: string
  currency: string
  chargedCents: number
  requiredCents: number
  periodFrom: string
  periodThrough: string
  verifiedAt: string
  correlationVerified: boolean
  periodVerified: boolean
  refundedCents: number
  disputed: boolean
}
export type AccessResult = {
  state: BillingState
  plan: PlanId | null
  write: boolean
  paidThrough?: string
  review?: string
  entitlementPolicy?: EntitlementPolicy
}
export function resolveBillingAccess(
  input: {
    workspaceId: string
    ownerIdentity: string
    emailVerified: boolean
    setupComplete: boolean
    freeActivated?: boolean
    providerCollectionResolved?: boolean
    pending?: 'checkout_pending' | 'payment_processing'
    cancelled?: boolean
    evidence?: PaidEvidence
    grant?: {
      workspaceId: string
      ownerIdentity: string
      plan: 'cottage-kitchen'
      administratorVerified: boolean
    }
  },
  now = Date.now(),
): AccessResult {
  if (!input.emailVerified)
    return { state: 'email_unverified', plan: null, write: false }
  if (!input.setupComplete)
    return { state: 'setup_incomplete', plan: null, write: false }
  const grant = input.grant
  if (
    grant?.administratorVerified &&
    grant.workspaceId === input.workspaceId &&
    grant.ownerIdentity === input.ownerIdentity
  )
    return { state: 'complimentary', plan: 'cottage-kitchen', write: true }
  const e = input.evidence
  const valid =
    e &&
    e.environment === 'sandbox' &&
    e.workspaceId === input.workspaceId &&
    e.planId !== 'free' &&
    planBillable(e.planId) &&
    e.subscriptionId &&
    e.invoiceId &&
    e.correlationVerified &&
    e.periodVerified &&
    e.invoiceStatus === 'PAID' &&
    e.paymentStatus === 'COMPLETED' &&
    e.currency === 'USD' &&
    Number.isSafeInteger(e.requiredCents) &&
    Number.isSafeInteger(e.chargedCents) &&
    Number.isSafeInteger(e.refundedCents) &&
    e.refundedCents >= 0 &&
    e.requiredCents >= planDetails(e.planId).monthlyUsd * 100 &&
    e.chargedCents - e.refundedCents >= e.requiredCents &&
    !e.disputed &&
    Number.isFinite(Date.parse(e.verifiedAt)) &&
    Date.parse(e.verifiedAt) <= now &&
    Date.parse(e.periodFrom) < Date.parse(e.periodThrough) &&
    Date.parse(e.periodFrom) <= now
  if (valid && now < Date.parse(e.periodThrough))
    return {
      state: input.cancelled ? 'cancelled' : 'paid_active',
      plan: e.planId,
      write: true,
      paidThrough: e.periodThrough,
    }
  if (
    valid &&
    !input.cancelled &&
    now <
      Date.parse(e.periodThrough) + sandboxBillingPolicy.graceDays * 86400000
  )
    return {
      state: 'past_due',
      plan: e.planId,
      write: true,
      paidThrough: e.periodThrough,
    }
  if (input.pending) return { state: input.pending, plan: null, write: false }
  if (input.freeActivated && (!e || input.providerCollectionResolved))
    return { state: 'free_active', plan: 'free', write: true }
  return {
    state: 'expired',
    plan: null,
    write: false,
    review:
      e?.disputed || e?.refundedCents
        ? 'Payment coverage requires review; records are preserved.'
        : undefined,
  }
}
export function billingFeatureAllowed(
  access: AccessResult,
  feature: FeatureId,
  operation: 'read' | 'write' | 'export',
) {
  if (
    operation === 'read' ||
    (feature === 'dataExport' && operation === 'export')
  )
    return true
  return (
    !!access.write &&
    !!access.plan &&
    (planAssignable(access.plan) || planBillable(access.plan)) &&
    planIncludes(access.plan, feature) &&
    featureStatusForPlan(access.plan, feature) === 'implemented'
  )
}
/** Write gate for EXISTING working endpoints: the plan must include the workflow.
 * Maturity labels govern marketing, not whether a paying oven may keep using a
 * workflow it already has. Reads, exports and continuations never reach this check. */
export function planWriteAllowed(access: AccessResult, feature: FeatureId) {
  return (
    !!access.write &&
    !!access.plan &&
    (planAssignable(access.plan) || planBillable(access.plan)) &&
    (access.entitlementPolicy === 'kitchen-two-v1'
      ? planIncludes(access.plan, feature)
      : legacyPlanIncludes(access.plan, feature))
  )
}
