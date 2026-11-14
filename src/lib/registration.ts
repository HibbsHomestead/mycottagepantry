import { z } from 'zod'
import { launchPricing, planVisible, type PlanId } from './launch-plans'

export const registrationReadiness = (policyReady: boolean) => ({
  publicSignup: true,
  policyAcceptance: policyReady,
  activation: true,
  liveCheckout: false,
  betaAdmission: false,
  blockers: [],
})
export function selectedPlan(value: unknown): PlanId {
  // Public selection stays separate from approved internal assignment.
  return launchPricing.plans.some(
    (p) => p.id === value && p.assignable && planVisible(p.id),
  )
    ? (value as PlanId)
    : 'free'
}
export function planDetails(value: unknown) {
  return (
    launchPricing.plans.find((p) => p.id === value) || launchPricing.plans[0]
  )
}
export const businessProfile = z
  .object({
    name: z.string().trim().min(2).max(120),
    country: z.string().regex(/^[A-Z]{2}$/),
    timezone: z
      .string()
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value })
          return true
        } catch {
          return false
        }
      }, 'Choose a valid timezone.'),
    currency: z.literal('USD'),
    measurements: z.enum(['us', 'metric']),
    phone: z.string().trim().max(40).default(''),
    website: z
      .union([z.literal(''), z.url().refine((s) => /^https?:\/\//.test(s))])
      .default(''),
    description: z.string().trim().max(600).default(''),
    focus: z
      .enum(['', 'baked', 'cottage-food', 'handmade', 'mixed'])
      .default(''),
  })
  .strict()
export const signupSteps = [
  'Account',
  'Verify email',
  'Your business',
  'Free oven',
]
export const checklistSteps = [
  ['ingredient', 'Add your first ingredient'],
  ['package', 'Enter package quantity and price'],
  ['recipe', 'Create a recipe'],
  ['product', 'Link or create a product'],
  ['costing', 'Review costing'],
  ['inventory', 'Try a supported inventory or batch workflow'],
] as const
/** Retained for historical verified sandbox coverage; no provider traffic. */
export const sandboxBillingPolicy = {
  revision: 'sandbox-2026-11-v1',
  planChange: 'next_renewal',
  proration: false,
  automaticRefund: false,
  graceDays: 7,
  cancellation: 'end_of_paid_period',
  preserveRecords: true,
  seatDowngrade: 'owner_review',
} as const
