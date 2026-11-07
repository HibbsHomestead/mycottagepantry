import { z } from 'zod'
import { launchPricing, type PlanId } from './launch-plans'

export const registrationReadiness = (policyReady: boolean) => ({
  publicSignup: true,
  policyAcceptance: policyReady,
  activation: policyReady,
  liveCheckout: false,
  betaAdmission: false,
  blockers: [
    ...(!policyReady
      ? [
          'Owner-approved Terms and Privacy content is required before free oven creation.',
        ]
      : []),
  ],
})
export function selectedPlan(value: unknown): PlanId {
  // Unpublished, unassignable drafts (Cottage Mercantile) are never selectable.
  return launchPricing.plans.some((p) => p.id === value && p.assignable)
    ? (value as PlanId)
    : 'free'
}
export function planDetails(value: unknown) {
  return launchPricing.plans.find((p) => p.id === selectedPlan(value))!
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
/** Proposed platform billing policies — NOT approved for production. Sandbox uses
 * `sandboxBillingPolicy` above purely as labeled test configuration. */
export const billingPolicyProposal = {
  status: 'pending_owner_approval',
  items: [
    [
      'Failed payment',
      'A previously paid oven keeps its plan for 7 calendar days after the paid-through date while Square retries or emails an invoice link. After that it uses Free limits; nothing is deleted. A first payment that fails never grants paid access.',
    ],
    [
      'Cancellation',
      'Cancellation takes effect at the end of the current paid period (Square cancels at the billing-period boundary). Paid access continues until then; no partial refunds.',
    ],
    [
      'Upgrade',
      'Proposed: takes effect at the next renewal at the new monthly price, with no proration and no immediate charge. Not implemented until approved.',
    ],
    [
      'Downgrade',
      'Proposed: takes effect at the next renewal. Not implemented until approved.',
    ],
    [
      'Refunds',
      'No automatic refunds. The platform owner may issue a manual refund in Square; a refunded or disputed period stops counting as paid and is flagged for review.',
    ],
    [
      'Over plan limits after a downgrade',
      'All records, history and exports stay available. Existing records stay editable; only creating new records beyond the lower plan’s limits, or new records for workflows outside that plan, is blocked.',
    ],
    [
      'Sales tax on the subscription',
      'Not collected yet. Software-subscription taxability depends on the customer’s state; the owner must confirm treatment with a tax advisor before production. Bakery merchandise tax settings are never used for platform billing.',
    ],
  ],
} as const
/** Shown and hashed at checkout; changing the wording requires a new version. */
export const subscriptionConsent = {
  version: 'subscription-consent-2026-11-v1',
  text: (planName: string, monthlyUsd: number) =>
    `I authorize Hibbs Homestead Market to charge my payment method $${monthlyUsd.toFixed(2)} USD every month for the ${planName} plan for my Cottage Pantry oven, starting today and renewing monthly until I cancel. Cancellation takes effect at the end of the current paid month. Payment is processed by Square.`,
} as const
