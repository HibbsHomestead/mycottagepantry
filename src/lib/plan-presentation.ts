import {
  launchFeatures,
  launchPricing,
  planIncludes,
  planVisible,
  featureStatusForPlan,
  type FeatureId,
  type PlanId,
} from './launch-plans'

export const publicPlans = launchPricing.plans.filter((p) => planVisible(p.id))
export const subscriptionChangePolicy = {
  version: 'immediate-prorated-renewal-v1',
  upgrade: 'Immediately, after Stripe confirms payment of any prorated amount.',
  downgrade: 'At the next renewal. Current paid access stays until then.',
} as const

export const planAudience: Record<PlanId, string> = {
  free: 'Start organizing your costs and business records.',
  'mixing-bowl': 'Everyday tools for a solo food business.',
  'bakers-bench': 'Build on the essentials as your food business grows.',
  'cottage-kitchen': 'For businesses making food and handmade goods.',
  'cottage-mercantile':
    'For businesses making and selling food, handmade goods, and resale items.',
}
export const teamAvailabilityNotice =
  'Invitations and member administration are Coming soon. Included users can use existing individual logins and shared-business memberships; you cannot invite or manage additional members in the app yet.'

const cardFeatures: Record<PlanId, readonly FeatureId[]> = {
  free: [
    'recipeCosting',
    'costInputs',
    'costRecords',
    'productPricing',
    'dataExport',
  ],
  'mixing-bowl': [
    'recipeImport',
    'inventory',
    'production',
    'labels',
    'finance',
  ],
  'bakers-bench': [
    'recipeImport',
    'labels',
    'finance',
    'inventory',
    'production',
  ],
  'cottage-kitchen': [
    'recipeCosting',
    'handmadeDesigns',
    'handmadeProduction',
    'materialRemnants',
    'labels',
  ],
  'cottage-mercantile': [
    'handmadeProduction',
    'resaleModule',
    'resalePackReceiving',
    'consignment',
    'labels',
  ],
}
export function planCardFeatures(plan: PlanId) {
  return cardFeatures[plan]
    .filter((id) => planIncludes(plan, id))
    .map((id) => ({
      id,
      label: launchFeatures.find((f) => f.id === id)!.label,
      ...featurePresentation(plan, id),
    }))
    .filter((feature) => feature.status === 'implemented')
    .slice(0, 5)
}

export function featurePresentation(plan: PlanId, id: FeatureId) {
  const feature = launchFeatures.find((f) => f.id === id)!
  if (!planIncludes(plan, id))
    return { status: 'excluded', text: 'Not included', note: '' }
  const status = featureStatusForPlan(plan, id)
  let note = 'gap' in feature ? feature.gap : ''
  // Proposed Free catalog caps are not subscription terms or active limits.
  if (
    plan === 'free' &&
    ['recipeCosting', 'productPricing', 'inventory'].includes(id)
  )
    note = 'Proposed record limits are not active.'
  if (id === 'basicProductWorkflows' && plan === 'cottage-kitchen')
    note = 'Handmade only; resale excluded.'
  if (
    id === 'basicProductWorkflows' &&
    !['cottage-kitchen', 'cottage-mercantile'].includes(plan)
  )
    return {
      status: 'launch_review',
      text: 'Under review',
      note: 'Basic handmade/resale scope remains under review; full resale and consignment require Cottage Mercantile.',
    }
  if (id === 'craftResaleEntryAssist')
    note =
      plan === 'cottage-kitchen'
        ? 'Materials only. Review before saving; barcodes match existing records.'
        : 'Review before saving; barcodes match existing records.'
  if (id === 'crossTypeReceiptMatching')
    note =
      plan === 'cottage-kitchen'
        ? 'Manual matching for ingredients, packaging and materials; resale excluded.'
        : 'Manual matching. Automatic receipt reading is not included.'
  return {
    status,
    text:
      status === 'implemented'
        ? 'Included'
        : status === 'needs_refinement'
          ? 'Partial'
          : status === 'planned'
            ? 'Coming soon'
            : 'Under review',
    note,
  }
}

export const featureGroups: { name: string; features: readonly FeatureId[] }[] =
  [
    {
      name: 'Food, costing & production',
      features: [
        'costRecords',
        'recipeCosting',
        'costInputs',
        'productPricing',
        'recipeImport',
        'inventory',
        'reorder',
        'production',
        'standardLabels',
        'labels',
      ],
    },
    {
      name: 'Sales, finance & planning',
      features: [
        'finance',
        'taxReports',
        'multiBatchPlanning',
        'consolidatedRequirements',
        'periodComparisons',
      ],
    },
    {
      name: 'Resale & consignment',
      features: launchFeatures
        .filter((f) => f.id.startsWith('resale') || f.id === 'consignment')
        .map((f) => f.id),
    },
    {
      name: 'Handmade & materials',
      features: launchFeatures
        .filter((f) =>
          /^(fabric|craft|yarn|material|storage|handmade|finished|crossType|basicProduct)/.test(
            f.id,
          ),
        )
        .map((f) => f.id),
    },
  ]
// Every configured capability appears once, including new capabilities added later.
const grouped = new Set(featureGroups.flatMap((g) => g.features))
featureGroups.push({
  name: 'Business, account & data',
  features: launchFeatures.filter((f) => !grouped.has(f.id)).map((f) => f.id),
})

export function planFeatureChanges(from: PlanId, to: PlanId) {
  return {
    added: launchFeatures
      .filter((f) => !planIncludes(from, f.id) && planIncludes(to, f.id))
      .map((f) => ({
        id: f.id,
        label: f.label,
        ...featurePresentation(to, f.id),
      })),
    removed: launchFeatures
      .filter((f) => planIncludes(from, f.id) && !planIncludes(to, f.id))
      .map((f) => ({ id: f.id, label: f.label })),
  }
}
