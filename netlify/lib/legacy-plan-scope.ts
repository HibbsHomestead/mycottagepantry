import {
  planIncludes,
  type FeatureId,
  type PlanId,
} from '../../src/lib/launch-plans'

/** Frozen pre-clarification scope: existing customers are never migrated by a copy change. */
const formerlyMercantileOnly: readonly FeatureId[] = [
  'resaleMerchandise',
  'resalePackReceiving',
  'resaleOpeningStock',
  'resaleCostAndPrice',
  'resaleMovements',
  'resalePurchasing',
  'fabricInventory',
  'craftUnits',
  'yarnMeasurements',
  'materialLots',
  'storageLocations',
  'materialRemnants',
  'materialUsageHistory',
  'handmadeDesigns',
  'handmadeCosting',
  'handmadeProduction',
  'finishedGoodsAdditions',
  'handmadeProfitability',
  'craftResaleEntryAssist',
  'crossTypeReceiptMatching',
  'salesIntegration',
  'activityReports',
]
export function legacyPlanIncludes(plan: PlanId, feature: FeatureId) {
  if (
    feature === 'resaleModule' ||
    feature === 'consignment' ||
    feature === 'resaleProfitability'
  )
    return false
  if (plan === 'cottage-kitchen' && formerlyMercantileOnly.includes(feature))
    return false
  return planIncludes(plan, feature)
}
