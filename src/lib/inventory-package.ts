import {
  baseUnit,
  convert,
  number,
  roundMoney,
  units,
  type Item,
} from './domain'
import { itemUnitOptions } from './add-item'
import { fabricConvert, fabricUnitOptions, isFabric } from './fabric'
import { resalePurchaseUnits, resaleStockPlan } from './resale-stock'

/** Purchase reference setup. Historical received quantities keep their existing meaning. */
const packageUnits = [
  'bag',
  'bottle',
  'box',
  'pack',
  'jar',
  'can',
  'case',
  'package',
  'roll',
  'bundle',
]
export function inventoryUnitOptions(data: Record<string, unknown>) {
  const type = String(data.usedAs || 'ingredient')
  const fabric = type === 'material' && data.materialType === 'fabric'
  const stock = fabric
    ? fabricUnitOptions(String(data.fabricTracking || 'length'))
    : itemUnitOptions(type, String(data.materialType || '')).filter(
        (u) => units[u]?.factor > 0,
      )
  const purchase =
    type === 'resale'
      ? resalePurchaseUnits
      : fabric
        ? data.fabricTracking === 'precut'
          ? ['each', 'pack', 'bundle', 'box', 'case']
          : ['bolt', 'roll', ...stock]
        : [...packageUnits, ...stock]
  return { stock, purchase }
}
const present = (value: unknown) => value != null && String(value).trim() !== ''
export const fabricByYard = (data: Record<string, unknown>) =>
  data.materialType === 'fabric' &&
  data.fabricTracking === 'length' &&
  data.purchaseUnit === 'yd'

/** One purchase yard expressed in the stock unit, independently of on-hand stock. */
export function fabricYardContents(data: Record<string, unknown>) {
  return fabricConvert(1, 'yd', String(data.unit), data as Item)
}

/** Legacy receipt quantities describe the whole purchase. Expose them for review, never rewrite them on load. */
export function fabricPurchaseDraft(item: Item): Item {
  let amount = item.amountPerPackage
  if (amount == null && item.purchaseUnit) {
    try {
      amount = ['bolt', 'roll'].includes(item.purchaseUnit)
        ? item.lengthConfirmed === true
          ? fabricConvert(
              item.usableLength,
              item.usableLengthUnit,
              item.unit,
              item,
            )
          : ''
        : fabricConvert(
            item.purchaseQuantity,
            item.purchaseUnit,
            item.unit,
            item,
          )
    } catch {
      amount = ''
    }
  }
  return {
    ...item,
    amountPerPackage: amount ?? '',
    initialStock: false,
    fabricPurchaseChanged: false,
    fabricPurchaseBasisConflict:
      fabricByYard(item) &&
      present(item.purchaseQuantity) &&
      Number(item.purchaseQuantity) !== 1,
  }
}

/** Changing a fabric price basis requires a newly entered price, never a carried package price. */
export function inventoryPackageChange(
  data: Item,
  key: string,
  value: Item[string],
): Partial<Item> {
  const patch: Partial<Item> = { [key]: value }
  if (!isFabric(data)) return patch
  const next = { ...data, ...patch }
  if (key === 'purchaseUnit' && value !== data.purchaseUnit) {
    if (present(data.packagePrice) || data.purchasePriceReviewRequired) {
      patch.packagePrice = ''
      patch.purchasePriceReviewRequired = true
      patch.purchasePriceReviewNote = `Purchase unit changed from ${data.purchaseUnit || 'package'} to ${value || 'unset'}. Enter and review the cost per ${value || 'purchase unit'}; the previous price has not been carried over.`
    }
    patch.amountPerPackage = fabricByYard(next) ? fabricYardContents(next) : ''
    // A count entered in the former package unit cannot keep its old meaning.
    if (
      data.openingCountUnit === data.purchaseUnit &&
      data.purchaseUnit !== data.unit
    ) {
      patch.openingCount = ''
      patch.openingCountUnit = data.unit
    }
  }
  if (key === 'unit' && fabricByYard(next))
    patch.amountPerPackage = fabricYardContents(next)
  if (key === 'packagePrice' && present(value))
    Object.assign(patch, {
      purchasePriceReviewRequired: false,
      purchasePriceReviewed: true,
    })
  return patch
}
function positive(value: unknown, label: string) {
  if (!present(value)) throw new Error(`Enter ${label}.`)
  const result = number(value, label)
  if (result <= 0) throw new Error(`${label} must be greater than zero.`)
  return result
}

/** Shared preview and server validation; no stock, accounting or persistence side effects. */
export function inventoryPackagePlan(data: Record<string, unknown>) {
  if (fabricByYard(data) && data.fabricPurchaseBasisConflict === true)
    throw new Error(
      'Review this fabric purchase basis: the saved purchase quantity and per-yard reference disagree. Confirm the cost per yd; saved values have not been changed.',
    )
  if (data.purchasePriceReviewRequired === true)
    throw new Error(
      'Review and enter the price for the selected purchase unit before saving.',
    )
  const type = String(data.usedAs || 'ingredient')
  const fabric = type === 'material' && data.materialType === 'fabric'
  const options = inventoryUnitOptions(data)
  const stockUnit = String(data.unit || '')
  if (!options.stock.includes(stockUnit))
    throw new Error('Choose a stock unit.')
  const purchaseUnit = String(data.purchaseUnit || '')
  if (data.conversions != null && !Array.isArray(data.conversions))
    throw new Error('Use a list of verified conversions.')
  let conversions = [
    ...(type === 'ingredient' && Array.isArray(data.conversions)
      ? data.conversions
      : []),
  ]
  if (conversions.some((c) => !c || typeof c !== 'object'))
    throw new Error('Use a list of verified conversions.')
  let amountPerPackage: number | null = null
  let packageCost: number | null = null
  const packageEntered =
    !!purchaseUnit ||
    present(data.amountPerPackage) ||
    present(data.packagePrice)
  if (packageEntered) {
    if (!options.purchase.includes(purchaseUnit))
      throw new Error('Choose a purchase unit for the package.')
    if (fabricByYard(data)) {
      const expected = fabricYardContents(data)
      if (
        present(data.amountPerPackage) &&
        Math.abs(
          positive(data.amountPerPackage, 'the purchase quantity basis') -
            expected,
        ) >
          1e-9 * Math.max(1, expected)
      )
        throw new Error(
          'Review this fabric purchase basis: yd means 1 yd. Confirm a cost per yd; saved quantities and prices have not been changed.',
        )
      amountPerPackage = expected
    } else {
      amountPerPackage = positive(
        data.amountPerPackage,
        'the amount in each package',
      )
    }
    if (type === 'resale' && !Number.isSafeInteger(amountPerPackage))
      throw new Error(
        'The amount in each package must be a whole number of sellable items.',
      )
    if (packageUnits.includes(purchaseUnit) || purchaseUnit === 'bolt') {
      conversions = conversions.filter(
        (c) => c.from !== purchaseUnit && c.to !== purchaseUnit,
      )
      if (!fabric && type !== 'resale')
        conversions.push({
          from: purchaseUnit,
          to: stockUnit,
          amountFrom: 1,
          amountTo: amountPerPackage,
          verified: true,
          note: 'Package contents entered during item setup',
        })
    } else {
      // A bag can have entered contents; a gram or pound cannot be redefined as a package.
      const expected = fabric
        ? fabricConvert(1, purchaseUnit, stockUnit, data as Item)
        : convert(1, purchaseUnit, stockUnit, conversions)
      if (
        Math.abs(expected - amountPerPackage) >
        1e-9 * Math.max(expected, amountPerPackage)
      )
        throw new Error(
          'The package amount conflicts with the purchase and stock units. Choose a bag, bottle, box or pack for packaged goods.',
        )
    }
    if (present(data.packagePrice))
      packageCost = number(data.packagePrice, 'Cost per package')
  }
  const canonicalUnit = fabric ? stockUnit : baseUnit(stockUnit, conversions)
  const baseContents =
    amountPerPackage == null
      ? null
      : convert(amountPerPackage, stockUnit, canonicalUnit, conversions)
  const unitCost =
    packageCost == null || amountPerPackage == null
      ? null
      : packageCost / amountPerPackage
  const baseUnitCost =
    packageCost == null || baseContents == null
      ? null
      : packageCost / baseContents
  let openingCount: number | null = null,
    openingCountUnit = '',
    stockQuantity = 0,
    baseQuantity = 0
  let suggestedValue: number | null = null,
    openingValue: number | null = null
  const initialStock = data.initialStock === true
  const override = initialStock && data.openingValueOverride === true
  if (initialStock) {
    if (data.stockAction && data.stockAction !== 'opening')
      throw new Error(
        'Opening count is stock already owned. Record a new purchase separately with Receive Stock.',
      )
    openingCount = positive(data.openingCount, 'an opening count')
    openingCountUnit = String(data.openingCountUnit || stockUnit)
    if (openingCountUnit === stockUnit) stockQuantity = openingCount
    else if (openingCountUnit === purchaseUnit && amountPerPackage != null)
      stockQuantity = openingCount * amountPerPackage
    else
      throw new Error(
        'Choose the purchase unit or stock unit for the opening count. A package count needs the amount in each package.',
      )
    if (!Number.isFinite(stockQuantity))
      throw new Error(
        'Package or stock values are too large. Reduce the quantities or costs.',
      )
    baseQuantity = convert(stockQuantity, stockUnit, canonicalUnit, conversions)
    suggestedValue = unitCost == null ? null : stockQuantity * unitCost
    if (override) {
      if (!present(data.openingValue))
        throw new Error(
          'Enter the optional opening stock value override. Enter zero only for stock with no cost.',
        )
      openingValue = number(data.openingValue, 'Opening stock value override')
    } else {
      if (suggestedValue == null)
        throw new Error(
          'Enter a cost per package or use the optional opening stock value override. Missing cost is not zero.',
        )
      openingValue = suggestedValue
    }
  }
  for (const value of [
    baseContents,
    unitCost,
    baseUnitCost,
    stockQuantity,
    baseQuantity,
    suggestedValue,
    openingValue,
    initialStock && openingValue != null ? openingValue / baseQuantity : null,
  ])
    if (value != null && !Number.isFinite(value))
      throw new Error(
        'Package or stock values are too large. Reduce the quantities or costs.',
      )
  if (
    (baseContents != null && baseContents <= 0) ||
    (initialStock && baseQuantity <= 0)
  )
    throw new Error(
      'Package contents and opening stock must be greater than zero.',
    )
  // Reuse resale's sellable-unit validation, whole-item check and cent rounding.
  const resale =
    type === 'resale'
      ? resaleStockPlan({
          ...data,
          id: String(data.id || 'preview'),
          name: String(data.name || ''),
          stockChoice: initialStock ? 'existing' : 'none',
          countMethod: 'direct',
          startingCount: stockQuantity,
          costBasis: 'total',
          costAmount: openingValue,
        })
      : null
  if (resale && initialStock) {
    openingValue = resale.totalCost
    if (suggestedValue != null) suggestedValue = roundMoney(suggestedValue)
    // Preserve what was actually entered in the saved starting-stock summary.
    resale.entry.costBasis = override
      ? 'total'
      : purchaseUnit === 'each'
        ? 'unit'
        : 'pack'
    resale.entry.costAmount = override ? openingValue : packageCost
    if (!Number.isFinite(openingValue))
      throw new Error(
        'Opening stock value is too large. Reduce the quantity or cost.',
      )
  }
  return {
    stockUnit,
    canonicalUnit,
    purchaseUnit,
    conversions,
    amountPerPackage,
    packageCost,
    unitCost,
    baseUnitCost,
    initialStock,
    openingCount,
    openingCountUnit,
    stockQuantity,
    baseQuantity,
    suggestedValue,
    openingValue,
    override,
    resale,
  }
}

export function inventoryPackagePreview(data: Record<string, unknown>) {
  try {
    return { plan: inventoryPackagePlan(data), error: '' }
  } catch (error) {
    return { plan: null, error: (error as Error).message }
  }
}
