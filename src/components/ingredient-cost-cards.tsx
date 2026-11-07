import {
  convert,
  ingredientUnits,
  parseQuantity,
  type Item,
} from '@/lib/domain'
import { hasPurchasePackage, packageCost, precise } from '@/lib/ingredients'
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
    } catch {
      return 'Conversion needed'
    }
  }
  let amount = 'Not set',
    packageUnitCost = 'Not set'
  const quantity = parseQuantity(i.purchaseQuantity ?? i.packageQuantity)
  if (Number.isFinite(quantity) && quantity > 0 && i.purchaseUnit) {
    try {
      amount = `${precise(convert(quantity, i.purchaseUnit, storage, i.conversions))} ${storage}`
      if (hasPurchasePackage(i))
        packageUnitCost = `${costMoney(packageCost(i).unitCost, currency)} / ${storage}`
    } catch {
      amount = packageUnitCost = 'Conversion needed'
    }
  }
  let onHand = 'Not recorded'
  try {
    if (i.quantity != null)
      onHand = `${precise(convert(i.quantity, i.unit, storage, i.conversions))} ${storage}`
  } catch {
    onHand = 'Conversion needed'
  }
  let recipeNote = 'Add a verified conversion to use this recipe unit.'
  try {
    const equivalent = convert(1, recipe, storage, i.conversions)
    recipeNote =
      recipe === storage
        ? 'Default recipe unit; same as inventory unit'
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
  } catch {
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
          label={`Cost per ${storage}`}
          value={unitCost(storage)}
          note="Current inventory cost reference"
          tone="blue"
        />
        <CostCard
          label={`On hand (${storage})`}
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
      <p className="cost-relationship">
        Package price ÷ package amount = package unit cost. Inventory value is
        shown in Inventory.
      </p>
    </div>
  )
}
