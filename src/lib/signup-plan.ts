import { launchPricing, type PlanId } from './launch-plans'

/** A registration preference, never a grant or proof of payment. */
export function signupPlan(value: unknown): PlanId {
  if (!launchPricing.plans.some((plan) => plan.id === value))
    throw new Error('Choose a listed plan. No different plan was selected.')
  return value as PlanId
}

export function signupPlanHref(plan: PlanId, path = '/signup') {
  return `${path}?plan=${encodeURIComponent(signupPlan(plan))}`
}

export type SignupSelection = {
  planId: PlanId
  name: string
  monthlyUsd: number
  currency: 'USD'
  interval: 'month'
}

/** A saved preference contains no purchase-availability or entitlement assertion.
 * Live availability comes only from the verified billing availability endpoint;
 * checkout independently validates the current recurring Price mapping. */
export function signupPlanDetails(value: unknown): SignupSelection {
  const planId = signupPlan(value)
  const plan = launchPricing.plans.find((row) => row.id === planId)!
  return {
    planId,
    name: plan.name,
    monthlyUsd: plan.monthlyUsd,
    currency: launchPricing.currency,
    interval: launchPricing.interval,
  }
}
