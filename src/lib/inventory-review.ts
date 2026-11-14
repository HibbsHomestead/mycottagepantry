import {
  convert,
  ingredientUnits,
  packagingLines,
  parseQuantity,
  type Item,
  type Workspace,
} from './domain'
import { isFabric } from './fabric'
import { fabricPurchaseDraft, inventoryPackagePlan } from './inventory-package'
import { hasPurchasePackage, packageCost } from './ingredients'
import { purchaseSetupView } from './purchase-setup'

export type InventoryReviewReason =
  'import' | 'purchase' | 'cost' | 'conversion'
export const inventoryReviewLabels: Record<InventoryReviewReason, string> = {
  import: 'Review imported data',
  purchase: 'Add purchase details',
  cost: 'Add cost information',
  conversion: 'Verify unit conversion',
}

/** The legacy import category predates a separate confirmation flag. Allergen
 * `reviewed` is deliberately independent of imported-data confirmation. */
export function needsImportedDataReview(item: Item) {
  return (
    item.importNeedsReview === true ||
    (item.category === 'Imported — needs review' && !item.importReviewedAt)
  )
}

const validCost = (value: unknown) =>
  value !== '' &&
  value != null &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0

/** Derived from saved setup and actual references, never from stock or photos.
 * No inferred package contents, prices, or density and no persistent side effects. */
export function inventoryReviewReasons(
  item: Item,
  workspace?: Workspace,
): InventoryReviewReason[] {
  const reasons = new Set<InventoryReviewReason>()
  if (needsImportedDataReview(item)) reasons.add('import')
  if (item.needsCostSetup || !validCost(item.currentCost ?? item.cost))
    reasons.add('cost')

  const registry = ingredientUnits(item.conversions)
  const checkConversion = (from: string, to = item.unit) => {
    try {
      convert(1, from, to, item.conversions)
    } catch {
      reasons.add('conversion')
    }
  }
  checkConversion(item.storageUnit || item.unit)
  if (item.recipeUnit) checkConversion(item.recipeUnit)
  for (const recipe of workspace?.recipes || [])
    for (const line of recipe.lines || [])
      if (line.ingredientId === item.id && Number(line.quantity) > 0)
        checkConversion(line.unit)
  for (const product of workspace?.products || [])
    for (const line of packagingLines(product))
      if (line.ingredientId === item.id && Number(line.quantity) > 0)
        checkConversion(line.unit || 'each')

  // Produced preps and transferred remnants have no required purchase package.
  if (!item.compoundRecipeId && !item.parentMaterialId) {
    if (isFabric(item)) {
      const draft = fabricPurchaseDraft(item)
      if (
        !draft.purchaseUnit ||
        !(parseQuantity(draft.amountPerPackage) > 0) ||
        draft.fabricPurchaseBasisConflict
      )
        reasons.add('purchase')
      if (!validCost(item.packagePrice)) reasons.add('cost')
      try {
        inventoryPackagePlan(draft)
      } catch {
        reasons.add('purchase')
      }
    } else {
      const quantity = parseQuantity(
        item.purchaseQuantity ?? item.packageQuantity,
      )
      if (
        !(quantity > 0) ||
        !Number.isFinite(quantity) ||
        !registry[item.purchaseUnit]
      )
        reasons.add('purchase')
      if (!validCost(item.packagePrice)) reasons.add('cost')
      if (registry[item.purchaseUnit]) checkConversion(item.purchaseUnit)
      if (hasPurchasePackage(item)) {
        try {
          packageCost(item)
          if (purchaseSetupView(item).review) reasons.add('purchase')
        } catch {
          reasons.add('conversion')
        }
      }
    }
  }
  return (['import', 'purchase', 'cost', 'conversion'] as const).filter(
    (reason) => reasons.has(reason),
  )
}
