import {
  convert,
  isMissingUnitConversion,
  ingredientUnits,
  parseQuantity,
  type Item,
} from '@/lib/domain'
import {
  hasPurchasePackage,
  precise,
  pantryDisplayUnit,
} from '@/lib/ingredients'
import { CostCard, costMoney } from './cost-cards'

type SavedConversion = {
  from: string
  to: string
  amountFrom: number
  amountTo: number
  verified?: boolean
  unitDefinition?: unknown
}

export function IngredientCostCards({ ingredient: i }: { ingredient: Item }) {
  const display = pantryDisplayUnit(i)
  const storage = i.storageUnit || i.unit
  const recipe = i.recipeUnit || storage
  const currency = i.currency || 'USD'
  const referenceCost = i.currentCost ?? i.cost
  const unitCost = (unit: string) => {
    try {
      const factor = convert(1, unit, i.unit, i.conversions)
      return i.needsCostSetup || !Number.isFinite(referenceCost)
        ? 'Cost needs setup'
        : `${costMoney(factor * referenceCost, currency)} / ${unit}`
    } catch (error) {
      if (!isMissingUnitConversion(error, unit, i.unit)) throw error
      return 'Conversion required'
    }
  }
  let amount = 'Not set',
    packageUnitCost = 'Not set'
  const quantity = parseQuantity(i.purchaseQuantity ?? i.packageQuantity)
  if (Number.isFinite(quantity) && quantity > 0 && i.purchaseUnit) {
    try {
      const contents = convert(quantity, i.purchaseUnit, storage, i.conversions)
      if (contents <= 0) throw new Error('Package contents must be positive.')
      amount = `${precise(contents)} ${storage}`
      if (hasPurchasePackage(i))
        packageUnitCost = `${costMoney(Number(i.packagePrice) / contents, currency)} / ${storage}`
    } catch (error) {
      if (!isMissingUnitConversion(error, i.purchaseUnit, storage)) throw error
      amount = packageUnitCost = 'Conversion required'
    }
  }
  const onHand =
    i.quantity == null
      ? 'Not recorded'
      : `${precise(convert(i.quantity, i.unit, display.unit, i.conversions))} ${display.unit}`
  let recipeNote = 'Add a verified conversion to use this recipe unit.'
  try {
    const equivalent = convert(1, recipe, storage, i.conversions)
    recipeNote =
      recipe === storage
        ? 'Default recipe unit; same as shelf unit'
        : `1 ${recipe} = ${equivalent.toLocaleString('en-US', { maximumSignificantDigits: 4 })} ${storage}`
    const registry = ingredientUnits(i.conversions)
    const saved = (i.conversions || []).filter(
      (c: SavedConversion) =>
        c.verified &&
        ((c.from === recipe && c.to === storage) ||
          (c.from === storage && c.to === recipe) ||
          registry[recipe]?.category !== registry[storage]?.category),
    )
    if (recipe !== storage && saved.length) {
      recipeNote += ` · Saved: ${saved.map((c: SavedConversion) => `${c.amountFrom} ${c.from} = ${c.amountTo} ${c.to}`).join('; ')}`
    }
  } catch (error) {
    if (!isMissingUnitConversion(error, recipe, storage)) throw error
    /* Keep the explicit missing-conversion message. */
  }
  return (
    <div className="pricing-summary cost-summary ingredient-summary">
      <div className="detail-stats cost-card-grid">
        <CostCard
          label="Package price"
          value={
            hasPurchasePackage(i)
              ? costMoney(Number(i.packagePrice), currency)
              : 'Not set'
          }
          note={
            Number.isFinite(quantity) && quantity > 0 && i.purchaseUnit
              ? `for ${precise(quantity)} ${i.purchaseUnit}`
              : 'Purchase package details needed'
          }
        />
        <CostCard
          label={`Cost per ${display.unit}`}
          value={unitCost(display.unit)}
          note="Current inventory cost reference"
          tone="blue"
        />
        <CostCard
          label={`On hand (${display.unit})`}
          value={onHand}
          note="Quantity currently in inventory"
          tone="green"
        />
      </div>
      <div className="cost-card-grid">
        <CostCard
          label="Amount in the package"
          value={amount}
          note="In inventory units"
          tone="peach"
        />
        <CostCard
          label="Package unit cost"
          value={packageUnitCost}
          note="Package price ÷ package amount"
          tone="blue"
        />
        <CostCard
          label={`Recipe cost per ${recipe}`}
          value={unitCost(recipe)}
          note={recipeNote}
        />
      </div>
    </div>
  )
}
