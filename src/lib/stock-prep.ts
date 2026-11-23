import {
  convert,
  ingredientUnits,
  number,
  validateDate,
  type Item,
} from './domain'

const EPS = 1e-8
const stockRound = (n: number) => Math.round(n * 1e8) / 1e8
export const UNPORTIONED = 'unportioned'
export const canPrepStock = (i: Item) =>
  !i.archived &&
  !i.compoundRecipeId &&
  i.trackInventory !== false &&
  (!i.usedAs || i.usedAs === 'ingredient')
export const prepLots = (lots: Item[] = [], id: string) =>
  lots.filter(
    (l) =>
      l.kind === 'ingredient_prep' && l.ingredientId === id && !l.reversedAt,
  )
export const activePrepLots = (lots: Item[] = [], id: string) =>
  prepLots(lots, id).filter((l) => l.quantity > 0)

export function prepStockBalance(i: Item, lots: Item[]) {
  const prepared = activePrepLots(lots, i.id)
  const preparedQuantity = prepared.reduce(
    (sum, l) => sum + Number(l.quantity),
    0,
  )
  const preparedValue = prepared.reduce(
    (sum, l) => sum + Number(l.quantity) * Number(l.unitCost),
    0,
  )
  const quantity = number(i.quantity ?? 0, 'Stock quantity')
  const value = quantity * number(i.cost ?? 0, 'Stock unit cost')
  if (quantity + EPS < preparedQuantity || value + EPS < preparedValue)
    throw new Error(
      'Prepared stock no longer matches the ingredient balance. Review inventory before continuing.',
    )
  return {
    quantity,
    value,
    preparedQuantity,
    preparedValue,
    available: stockRound(Math.max(0, quantity - preparedQuantity)),
    availableValue: Math.max(0, value - preparedValue),
  }
}

export const prepOutputUnits = (i: Item) =>
  Object.keys(ingredientUnits(i.conversions)).filter((unit) => {
    try {
      convert(1, unit, i.unit, i.conversions)
      return true
    } catch {
      return false
    }
  })

export function prepSourceUnit(i: Item) {
  if (i.storageUnit && prepOutputUnits(i).includes(i.storageUnit))
    return i.storageUnit as string
  return i.unit as string
}

export const prepMovementLabels: Record<string, string> = {
  prep_source: 'Moved from unportioned stock',
  prep_output: 'Prepared portions created',
  prep_loss: 'Measured prep loss',
  prep_reverse_output: 'Prepared portions reversed',
  prep_reverse_source: 'Returned to unportioned stock',
  prep_reverse_loss: 'Prep loss corrected',
}

export function planStockPrep(
  i: Item,
  lots: Item[],
  data: Record<string, unknown>,
  today: string,
) {
  if (!canPrepStock(i))
    throw new Error('Choose an active food ingredient with tracked stock.')
  if (!ingredientUnits(i.conversions)[i.unit])
    throw new Error('Choose a supported inventory unit before preparing stock.')
  if (i.needsCostSetup || i.cost == null)
    throw new Error(
      'Review the recorded stock cost before preparing this ingredient.',
    )
  const balance = prepStockBalance(i, lots)
  const sourceUnit = prepSourceUnit(i)
  const enteredUsed = number(data.used, 'Source quantity', EPS)
  const enteredLoss = number(data.loss || 0, 'Measured loss')
  const used = stockRound(
    convert(enteredUsed, sourceUnit, i.unit, i.conversions),
  )
  const loss = stockRound(
    convert(enteredLoss, sourceUnit, i.unit, i.conversions),
  )
  const usable = stockRound(used - loss)
  if (used > balance.available + EPS / 2)
    throw new Error(
      'Insufficient unportioned stock. Reduce the source quantity or receive stock first.',
    )
  if (usable <= 0)
    throw new Error('The measured loss must be less than the quantity used.')
  const portions = number(data.portions, 'Number of portions', 1)
  if (!Number.isInteger(portions) || portions > 200)
    throw new Error('Enter between 1 and 200 whole portions.')
  const method = String(data.method || '').trim()
  const location = String(data.location || '').trim()
  const lossReason = String(data.lossReason || '').trim()
  const note = String(data.note || '').trim()
  if (!method || method.length > 200)
    throw new Error('Enter a preparation method of up to 200 characters.')
  if (!location || location.length > 200)
    throw new Error(
      'Enter a destination storage location of up to 200 characters.',
    )
  if (note.length > 1000 || lossReason.length > 200)
    throw new Error('Shorten the note or loss reason.')
  if (loss > 0 && !lossReason)
    throw new Error(
      'Explain the measured loss. If stock already represents edible quantity, do not record peel loss again.',
    )
  const date = validateDate(String(data.date || ''))
  if (date > today) throw new Error('Prep date cannot be in the future.')
  const expires = data.expires ? validateDate(String(data.expires)) : ''
  if (expires && expires < date)
    throw new Error('Best-before cannot be before the prep date.')
  const hasMeasurement = data.perPortion !== '' && data.perPortion != null
  const outputUnit = hasMeasurement ? String(data.outputUnit || '') : i.unit
  const perPortion = hasMeasurement
    ? number(data.perPortion, 'Amount per portion', EPS)
    : usable / portions
  const normalized = hasMeasurement
    ? convert(perPortion, outputUnit, i.unit, i.conversions)
    : perPortion
  if (Math.abs(normalized * portions - usable) > EPS)
    throw new Error(
      'The measured portions must equal the source quantity minus any measured loss. Use a verified unit and correct the quantities before saving.',
    )
  // Count stock can only be split into whole individual units when it has a defined each conversion.
  if (ingredientUnits(i.conversions)[i.unit].category === 'count') {
    let each: number | undefined
    try {
      each = convert(normalized, i.unit, 'each', i.conversions)
    } catch {
      /* Do not assume a container size. */
    }
    if (each !== undefined && Math.abs(each - Math.round(each)) > EPS)
      throw new Error(
        'Each portion must contain a whole number of counted items. Use a measured weight for fractional pieces.',
      )
  }
  const balances = Array.from(
    { length: portions },
    (_, index) =>
      stockRound((usable * (index + 1)) / portions) -
      stockRound((usable * index) / portions),
  ).map(stockRound)
  if (balances.some((q) => q <= 0))
    throw new Error(
      'Each portion must have a positive quantity at inventory precision.',
    )
  const carriedCost = used * (balance.availableValue / balance.available)
  return {
    used,
    loss,
    enteredUsed,
    enteredLoss,
    sourceUnit,
    usable,
    portions,
    method,
    location,
    note,
    lossReason,
    date,
    expires,
    unit: i.unit,
    outputUnit,
    perPortion,
    hasMeasurement,
    balances,
    carriedCost,
    unitCost: carriedCost / usable,
    before: balance,
    remaining: stockRound(balance.available - used),
    totalAfter: stockRound(balance.quantity - loss),
  }
}
export type StockPrepPlan = ReturnType<typeof planStockPrep>

export function prepReviewKey(plan: StockPrepPlan) {
  return JSON.stringify(plan)
}

// One explicit source per ingredient per product line, consuming the oldest
// open container within a selected prep lot before opening another.
export function planPrepUsage(
  i: Item,
  lots: Item[],
  quantity: number,
  source: unknown,
) {
  const active = activePrepLots(lots, i.id)
  if (quantity === 0 || (!active.length && !source)) return undefined
  if (!source)
    throw new Error(
      `${i.name}: choose unportioned stock or a prepared lot before finalizing.`,
    )
  const balance = prepStockBalance(i, lots)
  const lot =
    source === UNPORTIONED ? undefined : active.find((l) => l.id === source)
  if (source !== UNPORTIONED && !lot)
    throw new Error(
      `${i.name}: the selected prepared lot is no longer available. Review the source.`,
    )
  const available = lot ? Number(lot.quantity) : balance.available
  if (available <= 0 || quantity > available + EPS / 2)
    throw new Error(
      `${i.name}: the selected stock source does not have enough remaining. Choose another source or review the actual use.`,
    )
  if (stockRound(quantity) === 0)
    throw new Error(
      `${i.name}: enter a usage amount large enough to track in inventory.`,
    )
  const unitCost = lot
    ? Number(lot.unitCost)
    : balance.availableValue / balance.available
  const cost = quantity * unitCost
  const remaining = stockRound(balance.quantity - quantity)
  let toUse = quantity
  const nextLot: Item | undefined = lot && {
    ...lot,
    quantity: stockRound(lot.quantity - quantity),
    usedInProduction: true,
    balances: (lot.balances as number[]).map((q) => {
      const used = Math.min(q, toUse)
      toUse -= used
      return stockRound(q - used)
    }),
  }
  return {
    unitCost,
    cost,
    remaining,
    remainingCost: remaining
      ? Math.max(0, balance.value - cost) / remaining
      : 0,
    lot: nextLot,
  }
}
