/** Owner-approved monthly USD prices (2026-11). All paid tiers support approved
 * Stripe test checkout, subject to provider setup. Live activation remains separate;
 * existing Square release gates and legacy access policies are preserved. Public
 * availability is server-controlled and never enabled by comparison approval. */
export const launchPricing = {
  status: 'approved_pricing',
  currency: 'USD',
  interval: 'month',
  unit: 'business oven',
  checkoutEnabled: false,
  signupEnabled: true,
  restrictionsEnabled: false,
  trialEnabled: false,
  plans: [
    {
      id: 'free',
      assignable: true,
      publication: 'draft',
      name: 'Free',
      monthlyUsd: 0,
      users: 1,
      caption: 'A proposed place to start',
      description: 'A small working toolkit. No credit card required.',
      highlights: [
        '5 active recipes and 5 active products',
        'Ingredient & packaging cost records; complete costing',
        'Recipe/product links and pricing tools',
        '10 active stock-tracked items; cost-only records do not count',
        'Individual batches with stock coverage review required',
        'Standard label layouts, essential customization & data export',
      ],
      caveat:
        'Free is a proposal, not an available signup. Safe stock coverage, active-record limits and standard-label scope need implementation and testing. Sales, expenses and business reports are outside this draft Free scope.',
    },
    {
      id: 'mixing-bowl',
      assignable: true,
      publication: 'draft',
      name: 'Mixing Bowl',
      monthlyUsd: 10,
      users: 1,
      caption: 'The complete solo-business toolkit',
      description:
        'For day-to-day operations. Core functionality belongs here.',
      highlights: [
        'Recipes, products, complete costing & reviewed recipe import',
        'Inventory receiving, adjustments, history & low-stock status',
        'Individual batch planning & completion',
        'Label design & printing, logos, fonts & saved designs',
        'Sales, expenses & basic profitability summaries',
        'Implemented tax reports, CSV & data export',
      ],
      caveat:
        'No small recipe, product or inventory count limits are proposed for paid plans. Operating safeguards and public-account launch checks still need review.',
    },
    {
      id: 'bakers-bench',
      assignable: true,
      publication: 'draft',
      name: 'Baker’s Bench',
      monthlyUsd: 20,
      users: 1,
      caption: 'Advanced planning · proposal',
      description:
        'Everything in Mixing Bowl, with proposed tools for planning ahead.',
      highlights: [
        'Proposed: multi-batch planning',
        'Proposed: consolidated ingredient & packaging requirements',
        'Proposed: expanded reports & period comparisons',
      ],
      caveat:
        'The advanced additions are not launch-ready. The current batch overview needs refinement; period comparisons are not implemented. There is not enough verified upgrade value to recommend this plan for launch yet.',
    },
    {
      id: 'cottage-kitchen',
      assignable: true,
      publication: 'draft',
      name: 'Cottage Kitchen',
      monthlyUsd: 30,
      users: 2,
      caption: 'Run your business together — includes two users.',
      description:
        'The program’s intended features except resale and consignment, for two total business users including the owner.',
      highlights: [
        'Costing, inventory, labels, sales, expenses and existing reports',
        'Handmade designs, material costing and production',
        'Fabric yardage and separate remnants',
        'Individual logins and shared-business access for two total users, including the owner',
        'Coming soon: invitations, member administration and advanced planning',
        'Excludes the resale and consignment modules',
      ],
      caveat:
        'Invitations and membership administration are not implemented. Permissions need further review and testing. Cottage Kitchen is not ready for purchase.',
    },
    {
      id: 'cottage-mercantile',
      /** Comparison approval does not enable public paid signup or checkout. */
      assignable: false,
      publication: 'unpublished_draft',
      name: 'Cottage Mercantile',
      monthlyUsd: 40,
      users: 6,
      caption:
        'The complete Cottage Pantry program — including resale, consignment, and business team access.',
      description:
        'The full intended program for food, handmade, resale and consignment businesses. Includes five users plus the owner (six total).',
      highlights: [
        'Resale merchandise, pack/case receiving, starting inventory & separate purchase/selling prices',
        'Fabric yardage with separate width, fractional lengths & remnant pieces without double counting',
        'Handmade designs, material/labor/packaging costing, production usage, waste & finished-goods additions',
        'Receipt matching across ingredients, materials, packaging and resale stock',
        'Proposed: yarn length/weight stock, dye lots, storage locations & purchase orders',
        'Consignment stock, sales, refunds and consignor payouts; six total business users including the owner',
      ],
      caveat:
        'Approved for Stripe test-mode checkout at $40/month with six total users. Live purchase remains disabled pending launch review. Variants, returns, purchasing, yarn, lots, locations, usage history and profitability views are partial; activity reports and sales integration are not implemented.',
    },
  ],
} as const
export type PlanId = (typeof launchPricing.plans)[number]['id']
export type FeatureStatus =
  'implemented' | 'needs_refinement' | 'planned' | 'launch_review'
export type PlanPublication = 'draft' | 'unpublished_draft'
/** Plans that may appear in billing rows, signup drafts and grants (matches database constraints). */
export function planAssignable(plan: PlanId) {
  return launchPricing.plans.some((p) => p.id === plan && p.assignable)
}
/** Paid tiers that may be stored in billing records and offered in Sandbox checkout.
 * Price is server-owned: monthlyUsd here is the single source for checkout amounts. */
export const billablePlanIds = [
  'mixing-bowl',
  'bakers-bench',
  'cottage-kitchen',
  'cottage-mercantile',
] as const
export type BillablePlanId = (typeof billablePlanIds)[number]
export function planBillable(plan: unknown): plan is BillablePlanId {
  return billablePlanIds.includes(plan as BillablePlanId)
}
export function planMonthlyCents(plan: BillablePlanId) {
  return launchPricing.plans.find((p) => p.id === plan)!.monthlyUsd * 100
}
const allPlans: readonly PlanId[] = [
  'free',
  'mixing-bowl',
  'bakers-bench',
  'cottage-kitchen',
  'cottage-mercantile',
]
const paidPlans: readonly PlanId[] = [
  'mixing-bowl',
  'bakers-bench',
  'cottage-kitchen',
  'cottage-mercantile',
]
const advancedPlans: readonly PlanId[] = [
  'bakers-bench',
  'cottage-kitchen',
  'cottage-mercantile',
]
const sharedPlans: readonly PlanId[] = ['cottage-kitchen', 'cottage-mercantile']
const mercantilePlans: readonly PlanId[] = ['cottage-mercantile']
const kitchenAndMercantilePlans: readonly PlanId[] = [
  'cottage-kitchen',
  'cottage-mercantile',
]
/** Server-owned rollout version. Existing billing rows retain the legacy policy. */
export const currentEntitlementPolicy = 'kitchen-two-v1' as const
export type EntitlementPolicy = 'legacy' | typeof currentEntitlementPolicy
export function planUserLimit(plan: PlanId): number | null {
  return launchPricing.plans.find((p) => p.id === plan)!.users
}
export function planUserLabel(plan: PlanId) {
  const limit = planUserLimit(plan)
  return limit === null
    ? 'Team user limit awaiting confirmation'
    : `${limit} total ${limit === 1 ? 'user' : 'users'}, including the owner`
}
export type TestCoverage = 'tested' | 'partly_tested' | 'not_tested'

type FeatureDefinition = {
  id: string
  label: string
  status: FeatureStatus
  plans: readonly PlanId[]
  freeScope?: { label: string; status: FeatureStatus }
  /** Recorded for fifth-tier capabilities; absent means not yet audited in this matrix. */
  testing?: TestCoverage
  limits?: string
  dependencies?: string
  gap?: string
}
export const launchFeatures = [
  {
    id: 'resaleModule',
    label: 'Resale stock and sales',
    status: 'implemented',
    plans: mercantilePlans,
    testing: 'tested',
  },
  {
    id: 'consignment',
    label: 'Consignment stock, sales, refunds and payouts',
    status: 'implemented',
    plans: mercantilePlans,
    testing: 'tested',
  },
  {
    id: 'resaleProfitability',
    label: 'Dedicated resale profitability views',
    status: 'needs_refinement',
    plans: mercantilePlans,
    testing: 'partly_tested',
  },
  {
    id: 'costRecords',
    label: 'Ingredient & packaging cost records',
    status: 'implemented',
    plans: allPlans,
  },
  {
    id: 'recipeCosting',
    label: 'Recipes, costing & verified unit conversions',
    status: 'implemented',
    plans: allPlans,
    freeScope: {
      label: '5 active recipes · limit not implemented',
      status: 'needs_refinement',
    },
  },
  {
    id: 'costInputs',
    label: 'Labor, overhead, packaging & waste inputs',
    status: 'implemented',
    plans: allPlans,
  },
  {
    id: 'productPricing',
    label: 'Products, recipe links & pricing scenarios',
    status: 'implemented',
    plans: allPlans,
    freeScope: {
      label: '5 active products · limit not implemented',
      status: 'needs_refinement',
    },
  },
  {
    id: 'recipeImport',
    label: 'Text & recipe-link import with review',
    status: 'implemented',
    plans: paidPlans,
  },
  {
    id: 'inventory',
    label: 'Inventory receiving, adjustments, balances & history',
    status: 'implemented',
    plans: allPlans,
    freeScope: {
      label: '10 active stock-tracked items · coverage review needed',
      status: 'needs_refinement',
    },
  },
  {
    id: 'reorder',
    label: 'Low-stock status & reorder thresholds',
    status: 'implemented',
    plans: allPlans,
  },
  {
    id: 'production',
    label: 'Individual batch planning & completion',
    status: 'implemented',
    plans: allPlans,
    freeScope: {
      label: 'Tracked-stock batches · safe coverage needs refinement',
      status: 'needs_refinement',
    },
  },
  {
    id: 'standardLabels',
    label: 'Standard label layouts & essential customization',
    status: 'implemented',
    plans: allPlans,
    freeScope: {
      label: 'Proposed standard layouts · scope needs review',
      status: 'needs_refinement',
    },
  },
  {
    id: 'labels',
    label: 'Full label design, logos, fonts & saved designs',
    status: 'implemented',
    plans: paidPlans,
  },
  {
    id: 'finance',
    label: 'Sales, expenses & basic profitability summaries',
    status: 'implemented',
    plans: paidPlans,
  },
  {
    id: 'taxReports',
    label: 'Implemented business/tax reports & CSV exports',
    status: 'implemented',
    plans: paidPlans,
  },
  {
    id: 'multiBatchPlanning',
    label: 'Advanced multi-batch planning',
    status: 'needs_refinement',
    plans: advancedPlans,
  },
  {
    id: 'consolidatedRequirements',
    label: 'Consolidated ingredient & packaging requirements',
    status: 'needs_refinement',
    plans: advancedPlans,
  },
  {
    id: 'periodComparisons',
    label: 'Expanded reports & period comparisons',
    status: 'planned',
    plans: advancedPlans,
  },
  {
    id: 'invitations',
    label: 'Member invitations',
    status: 'planned',
    plans: sharedPlans,
  },
  {
    id: 'sharedAccess',
    label: 'Role-based shared access & membership administration',
    status: 'needs_refinement',
    plans: sharedPlans,
  },
  {
    id: 'basicProductWorkflows',
    label:
      'Handmade & resale product records, simple stock adjustments & manual sales',
    status: 'implemented',
    plans: paidPlans,
    testing: 'tested',
    gap: 'Proposed lower-tier basic scope so Mixing Bowl keeps selling handmade/resale items; Free keeps product identity only.',
  },
  {
    id: 'resaleMerchandise',
    label: 'Resale merchandise & variants',
    status: 'needs_refinement',
    plans: mercantilePlans,
    testing: 'tested',
    gap: 'Variants are text fields on one product; no parent/child variant model.',
  },
  {
    id: 'resalePackReceiving',
    label: 'Pack/case-to-sellable-unit receiving',
    status: 'implemented',
    plans: mercantilePlans,
    testing: 'tested',
  },
  {
    id: 'resaleOpeningStock',
    label: 'Starting resale inventory with quantity & cost basis',
    status: 'implemented',
    plans: mercantilePlans,
    testing: 'tested',
  },
  {
    id: 'resaleCostAndPrice',
    label: 'Purchase costs separate from selling prices',
    status: 'implemented',
    plans: mercantilePlans,
    testing: 'tested',
  },
  {
    id: 'resaleMovements',
    label: 'Resale stock movements, returns & adjustments',
    status: 'needs_refinement',
    plans: mercantilePlans,
    testing: 'tested',
    gap: 'Full customer refunds only; no partial refunds or return-to-vendor.',
  },
  {
    id: 'resalePurchasing',
    label: 'Receipt-line matching & purchasing links',
    status: 'needs_refinement',
    plans: mercantilePlans,
    testing: 'tested',
    gap: 'Receipt lines and vendor matching exist; purchase orders are a placeholder tab with no records.',
  },
  {
    id: 'fabricInventory',
    label: 'Fabric yardage, fractional lengths & separate width',
    status: 'implemented',
    plans: kitchenAndMercantilePlans,
    testing: 'tested',
  },
  {
    id: 'craftUnits',
    label: 'Compatible length/weight/count units for materials',
    status: 'implemented',
    plans: kitchenAndMercantilePlans,
    testing: 'tested',
    gap: 'Fabric is length-only (precut by count); other materials use verified generic conversions.',
  },
  {
    id: 'yarnMeasurements',
    label: 'Yarn length & weight as separate measurements',
    status: 'needs_refinement',
    plans: kitchenAndMercantilePlans,
    testing: 'partly_tested',
    gap: 'Captured as package details on import only; no yarn stock handling.',
  },
  {
    id: 'materialLots',
    label: 'Color/pattern & lot/variant tracking',
    status: 'needs_refinement',
    plans: kitchenAndMercantilePlans,
    testing: 'partly_tested',
    gap: 'Fabric color/pattern exist; dye lots are not recorded or consumed for materials.',
  },
  {
    id: 'storageLocations',
    label: 'Storage locations',
    status: 'needs_refinement',
    plans: kitchenAndMercantilePlans,
    testing: 'partly_tested',
    gap: 'Single free-text location; no location records or per-location quantities.',
  },
  {
    id: 'materialRemnants',
    label: 'Separate pieces/remnants without double counting',
    status: 'implemented',
    plans: kitchenAndMercantilePlans,
    testing: 'tested',
  },
  {
    id: 'materialUsageHistory',
    label: 'Material reorder & usage history',
    status: 'needs_refinement',
    plans: kitchenAndMercantilePlans,
    testing: 'not_tested',
    gap: 'Per-item ledger history and ingredient low-stock only; no material reorder workflow or usage-by-design report.',
  },
  {
    id: 'handmadeDesigns',
    label: 'Handmade designs & bills of materials',
    status: 'implemented',
    plans: kitchenAndMercantilePlans,
    testing: 'tested',
  },
  {
    id: 'handmadeCosting',
    label: 'Material, labor & packaging costing',
    status: 'implemented',
    plans: kitchenAndMercantilePlans,
    testing: 'tested',
  },
  {
    id: 'handmadeProduction',
    label: 'Handmade production usage & waste',
    status: 'implemented',
    plans: kitchenAndMercantilePlans,
    testing: 'tested',
  },
  {
    id: 'finishedGoodsAdditions',
    label: 'Finished-goods additions from production',
    status: 'implemented',
    plans: kitchenAndMercantilePlans,
    testing: 'tested',
  },
  {
    id: 'handmadeProfitability',
    label: 'Handmade pricing and profitability views',
    status: 'needs_refinement',
    plans: kitchenAndMercantilePlans,
    testing: 'partly_tested',
    gap: 'Target margins exist; profitability report does not separate workflows and batch variance uses food recipe cost.',
  },
  {
    id: 'craftResaleEntryAssist',
    label: 'Barcode & URL-assisted entry for materials and resale',
    status: 'implemented',
    plans: kitchenAndMercantilePlans,
    testing: 'tested',
    limits: 'Proposed: per-oven import rate limits before publication',
    dependencies:
      'In-browser barcode scanning (no lookup service); server-side page fetching for URLs',
    gap: 'Barcode matches existing records only; no external barcode database.',
  },
  {
    id: 'crossTypeReceiptMatching',
    label:
      'Receipt matching across ingredient, material, packaging & resale stock',
    status: 'implemented',
    plans: kitchenAndMercantilePlans,
    testing: 'tested',
    limits:
      'Proposed: monthly automatic receipt-reading allowance; manual entry unlimited by count',
    dependencies:
      'Private Netlify Blobs storage; AI receipt reading (environment-gated, per-receipt model cost)',
  },
  {
    id: 'salesIntegration',
    label: 'Square sales integration',
    status: 'planned',
    plans: kitchenAndMercantilePlans,
    testing: 'not_tested',
    dependencies:
      'Square account, OAuth app review and webhooks; no live connection',
    gap: 'Sales provider is a placeholder; Square sandbox is used for billing tests only.',
  },
  {
    id: 'activityReports',
    label: 'Reports separating business activities',
    status: 'planned',
    plans: kitchenAndMercantilePlans,
    testing: 'not_tested',
    gap: 'Reports never filter by workflow; inventory valuation covers ingredients only.',
  },
  {
    id: 'support',
    label: 'Private in-app support tickets',
    status: 'implemented',
    plans: allPlans,
  },
  {
    id: 'dataExport',
    label: 'Data export',
    status: 'implemented',
    plans: allPlans,
  },
  {
    id: 'security',
    label: 'Security, privacy controls & essential warnings',
    status: 'launch_review',
    plans: allPlans,
  },
  {
    id: 'accountEmail',
    label: 'Essential account emails',
    status: 'launch_review',
    plans: allPlans,
  },
] as const satisfies readonly FeatureDefinition[]
export type FeatureId = (typeof launchFeatures)[number]['id']

/** null means no small commercial count proposed, not a promise of unlimited resources. */
export const proposedRecordLimits: Record<
  PlanId,
  {
    activeRecipes: number | null
    activeProducts: number | null
    activeStockTrackedItems: number | null
  }
> = {
  free: { activeRecipes: 5, activeProducts: 5, activeStockTrackedItems: 10 },
  'mixing-bowl': {
    activeRecipes: null,
    activeProducts: null,
    activeStockTrackedItems: null,
  },
  'bakers-bench': {
    activeRecipes: null,
    activeProducts: null,
    activeStockTrackedItems: null,
  },
  'cottage-kitchen': {
    activeRecipes: null,
    activeProducts: null,
    activeStockTrackedItems: null,
  },
  'cottage-mercantile': {
    activeRecipes: null,
    activeProducts: null,
    activeStockTrackedItems: null,
  },
}
export function planIncludes(plan: PlanId, feature: FeatureId) {
  const definition: FeatureDefinition = launchFeatures.find(
    (f) => f.id === feature,
  )!
  return definition.plans.includes(plan)
}
export function featureStatusForPlan(
  plan: PlanId,
  feature: FeatureId,
): FeatureStatus {
  const definition: FeatureDefinition = launchFeatures.find(
    (f) => f.id === feature,
  )!
  return plan === 'free' && definition.freeScope
    ? definition.freeScope.status
    : definition.status
}
export function featureScopeLabel(plan: PlanId, feature: FeatureId) {
  const definition: FeatureDefinition = launchFeatures.find(
    (f) => f.id === feature,
  )!
  if (!definition.plans.includes(plan)) return '—'
  if (plan === 'cottage-kitchen') {
    if (feature === 'basicProductWorkflows')
      return 'Handmade only · resale excluded'
    if (feature === 'craftResaleEntryAssist')
      return 'Materials only · reviewed entry'
    if (feature === 'crossTypeReceiptMatching')
      return 'Ingredients, materials & packaging · resale excluded'
    if (feature === 'activityReports')
      return 'Coming soon · bakery & handmade only'
  }
  if (plan === 'free' && definition.freeScope) return definition.freeScope.label
  switch (definition.status) {
    case 'implemented':
      return 'In proposed scope'
    case 'needs_refinement':
      return 'Needs refinement'
    case 'planned':
      return 'Not implemented'
    case 'launch_review':
      return 'Required · launch review'
  }
}
