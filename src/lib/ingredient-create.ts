import { isPackaging } from './pantry-category'
import { convert, parseQuantity } from './domain'

/** Validate purchase inputs without coercing missing values into a free receipt. */
export function ingredientCreateErrors(input: Record<string, any>) {
  const errors: Record<string, string> = {}
  if (!String(input.name || '').trim())
    errors.name = isPackaging(input)
      ? 'Enter a packaging name.'
      : 'Enter an ingredient name.'
  if (
    input.packCount !== undefined &&
    (!Number.isSafeInteger(Number(input.packCount)) ||
      Number(input.packCount) < 1)
  )
    errors.packCount = 'Pack count must be a positive whole number.'
  if (String(input.packageSize || '').length > 200)
    errors.packageSize =
      'Use at most 200 characters for the source package size.'
  const missing = (v: unknown) => v == null || String(v).trim() === ''
  if (
    missing(input.purchaseQuantity) ||
    !Number.isFinite(parseQuantity(input.purchaseQuantity)) ||
    parseQuantity(input.purchaseQuantity) <= 0
  )
    errors.purchaseQuantity = 'Enter a package quantity greater than zero.'
  if (
    missing(input.packagePrice) ||
    !Number.isFinite(Number(input.packagePrice)) ||
    Number(input.packagePrice) < 0
  )
    errors.packagePrice =
      'Enter the total package price paid. Enter zero only for a free purchase.'
  if (input.listedOnlinePrice != null && input.purchasePriceConfirmed !== true)
    errors.packagePrice =
      'Confirm the actual purchase price; the imported online listing is not a receipt.'
  if (!input.purchaseUnit) errors.purchaseUnit = 'Choose a purchase unit.'
  if (!input.unit) errors.unit = 'Choose a stock unit.'
  if (!errors.purchaseQuantity && !errors.purchaseUnit && !errors.unit) {
    try {
      convert(
        parseQuantity(input.purchaseQuantity),
        input.purchaseUnit,
        input.unit,
        input.conversions,
      )
    } catch {
      errors.purchaseUnit =
        'Purchase and stock units need a verified conversion. Choose compatible units or add an advanced conversion.'
    }
  }
  return errors
}
