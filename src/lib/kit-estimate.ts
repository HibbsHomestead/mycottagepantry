import {
  applicableTaxes,
  isMixedPack,
  calculateTax,
  productCosting,
  profitability,
  type Item,
  type Workspace,
} from './domain'
import { categoryTaxState } from './product-categories'

/** Keep independent cost and tax results when one part of the estimate is incomplete. */
export function kitEstimate(product: Item, workspace: Workspace) {
  const subject = isMixedPack(product) ? 'mixed pack' : 'basket'
  let cost: ReturnType<typeof productCosting> | undefined
  let tax: ReturnType<typeof calculateTax> | undefined
  let pricing: ReturnType<typeof profitability> | undefined
  let costError = ''
  let pricingError = ''
  const price =
    product.price == null || String(product.price).trim() === ''
      ? NaN
      : Number(product.price)
  try {
    cost = productCosting(product, workspace, { allowResaleEstimate: true })
  } catch (error) {
    costError = (error as Error).message
  }
  try {
    const taxes = applicableTaxes(product, workspace.settings[0])
    if (!Number.isFinite(price) || price < 0)
      throw new Error(`Selling price is not configured for this ${subject}.`)
    tax = calculateTax(price, taxes)
    if (cost)
      pricing = profitability(product, cost.perPackage, workspace.settings[0])
  } catch (error) {
    pricingError = (error as Error).message
  }
  const category =
    product.taxSource === 'category'
      ? categoryTaxState(product, workspace.settings[0])
      : undefined
  const configuration = category?.issue
    ? !category.category || category.category.active === false
      ? 'kit'
      : !category.category.classification
        ? 'Categories'
        : 'Taxes'
    : 'kit'
  const explanation = category?.issue
    ? configuration === 'kit'
      ? `${product.name}: choose an active category in Edit ${subject} → Contents & details.`
      : configuration === 'Categories'
        ? `${product.name}: review the classification of category “${category.category!.name}” in Products → Categories.`
        : `${product.name}: configure the tax treatment for category “${category.category!.name}” in Settings → Taxes. Missing configuration does not mean tax exempt.`
    : `${product.name}: review the affected product or packaging costs below, or update the saved price and pricing settings in Edit ${subject}.`
  return {
    cost,
    tax,
    pricing,
    price,
    costError,
    pricingError,
    configuration,
    explanation,
  }
}
