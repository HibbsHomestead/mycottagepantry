import {
  baseUnit,
  convert,
  ingredientUnits,
  unitLabel,
  type Item,
  type Workspace,
} from './domain'

export function ingredientHasStockHistory(item: Item, workspace: Workspace) {
  return (
    Number(item.quantity) !== 0 ||
    !!item.openingStockRecorded ||
    !!item.compoundRecipeId ||
    (workspace.ledger || []).some((row) => row.ingredientId === item.id) ||
    (workspace.inventory_counts || []).some(
      (count) =>
        Array.isArray(count.lines) &&
        count.lines.some((line: Item) => line.ingredientId === item.id),
    ) ||
    (workspace.batches || []).some((batch) =>
      Array.isArray(batch.usage)
        ? batch.usage.some((line: Item) => line.ingredientId === item.id)
        : !!batch.usage && Object.hasOwn(batch.usage, item.id),
    )
  )
}

export function stockUnitNeedsNewBasis(existing: Item, draft: Item) {
  try {
    convert(
      1,
      existing.unit,
      draft.storageUnit || existing.storageUnit || existing.unit,
      draft.conversions || existing.conversions,
    )
    return false
  } catch {
    return true
  }
}

/** Draft values only: an unconvertible amount becomes blank, never relabeled. */
export function changeStockShelfUnit(draft: Item, unit: string) {
  const previous = draft.storageUnit || draft.unit
  if (unit === previous) return {}
  const converted = (value: unknown, allowZero: boolean): number | '' => {
    if (value === '' || value == null) return ''
    const amount = Number(value)
    if (allowZero && amount === 0) return 0
    try {
      return convert(amount, previous, unit, draft.conversions)
    } catch {
      return ''
    }
  }
  let stockUnits = converted(draft.purchaseSetup?.stockUnits, false)
  if (stockUnits === '' && draft.purchaseSetup?.packageUnit) {
    try {
      stockUnits = convert(
        1,
        draft.purchaseSetup.packageUnit,
        unit,
        draft.conversions,
      )
    } catch {
      // An imported measure is a proposal, not a verified package relationship.
    }
  }
  return {
    storageUnit: unit,
    threshold: converted(draft.threshold, true),
    reorderQuantity: converted(draft.reorderQuantity, true),
    purchaseSetup: { ...draft.purchaseSetup, stockUnits },
    confirmEmptyStockUnitChange: false,
    stockUnitChangeNotice:
      stockUnits === ''
        ? `The previous package contents in ${unitLabel(previous)} were cleared. Enter the verified ${unitLabel(unit)} in one ${draft.purchaseSetup?.packageUnit || 'purchasing package'}; no weight-to-volume equivalence is assumed.`
        : '',
  }
}

/** Server callers supply history from the tenant's records, never from input. */
export function prepareStockUnitBasis(
  existing: Item,
  input: Item,
  hasHistory = true,
) {
  if (!stockUnitNeedsNewBasis(existing, input))
    return { input, changed: false, unit: existing.unit }
  if (
    hasHistory ||
    Number(existing.quantity) !== 0 ||
    existing.openingStockRecorded ||
    existing.compoundRecipeId
  )
    throw new Error(
      'Stock/history uses the saved inventory unit. Add a measured, verified conversion in Unit Conversions before saving this shelf unit. Stock quantities, valuation and historical records cannot be reinterpreted.',
    )
  if (input.confirmEmptyStockUnitChange !== true)
    throw new Error(
      'Confirm the new stock basis for this item with zero stock and no history before saving.',
    )
  if (input.openingStock?.enabled)
    throw new Error(
      'Save the new stock basis first, then reopen the ingredient to enter opening stock in its saved unit.',
    )
  const shelf = String(input.storageUnit || '')
  const registry = ingredientUnits(input.conversions || existing.conversions)
  if (
    !registry[shelf] ||
    !['weight', 'volume', 'count', 'length'].includes(registry[shelf].category)
  )
    throw new Error('Choose a supported stock shelf unit.')
  const packageUnit = input.purchaseSetup?.packageUnit
  // Drop the former package relationship on an explicitly confirmed empty item.
  // Retaining it beside the new net contents would manufacture a density bridge.
  const conversions = (input.conversions || existing.conversions || []).filter(
    (c: Item) => {
      const other =
        c.from === packageUnit
          ? c.to
          : c.to === packageUnit
            ? c.from
            : undefined
      return !other || registry[other]?.category === registry[shelf].category
    },
  )
  return {
    input: { ...input, conversions },
    changed: true,
    unit: baseUnit(shelf, conversions),
  }
}
