import { convert, ingredientUnits, type Item } from './domain'

/** Optional purchase amount; never a stock target or an ordering restriction. */
export function minimumOrder(input: Item, existing?: Item) {
  const raw =
    input.minimumOrderQuantity === undefined
      ? existing?.minimumOrderQuantity
      : input.minimumOrderQuantity
  if (raw === '' || raw == null)
    return { minimumOrderQuantity: null, minimumOrderUnit: '' }
  const unit = input.purchaseUnit || existing?.purchaseUnit
  if (!unit)
    throw new Error('Choose a purchase unit for the minimum order quantity.')
  const previous =
    input.minimumOrderUnit ||
    existing?.minimumOrderUnit ||
    existing?.purchaseUnit ||
    unit
  let amount = Number(raw)
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error(
      'Minimum order quantity must be a positive number, or left blank.',
    )
  if (previous !== unit) {
    try {
      amount = convert(
        amount,
        previous,
        unit,
        input.conversions || existing?.conversions,
      )
    } catch {
      throw new Error(
        'Review the minimum order quantity in the new purchase unit before saving.',
      )
    }
  }
  if (
    wholePurchaseUnit(unit, input.conversions || existing?.conversions) &&
    !Number.isSafeInteger(amount)
  )
    throw new Error(`Minimum order quantity must be a whole number of ${unit}.`)
  return { minimumOrderQuantity: amount, minimumOrderUnit: unit }
}
export function wholePurchaseUnit(
  unit: string,
  conversions?: Item['conversions'],
) {
  return ingredientUnits(conversions)[unit]?.category === 'count'
}
