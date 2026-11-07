import {
  baseUnit,
  convert,
  number,
  roundMoney,
  units,
  type Item,
} from './domain'
import { itemUnitOptions } from './add-item'
import { fabricConvert, fabricUnitOptions } from './fabric'
import { resalePurchaseUnits, resaleStockPlan } from './resale-stock'

/** New item setup only. Historical received quantities keep their existing meaning. */
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
function positive(value: unknown, label: string) {
  if (!present(value)) throw new Error(`Enter ${label}.`)
  const result = number(value, label)
  if (result <= 0) throw new Error(`${label} must be greater than zero.`)
  return result
}

/** Shared preview and server validation; no stock, accounting or persistence side effects. */
export function inventoryPackagePlan(data: Record<string, unknown>) {
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
    amountPerPackage = positive(
      data.amountPerPackage,
      'the amount in each package',
    )
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
