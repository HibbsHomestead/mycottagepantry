import {
  applicableTaxes,
  businessPriceTaxMode,
  calculateTax,
  number,
  priceTaxLabel,
  type TaxRate,
  type Workspace,
} from './domain'
import { cardCost } from './product-list'

export const priceTaxModes = [
  'inherit',
  'before',
  'includes',
  'configured',
  'saved-before',
  'saved-includes',
]
export type PriceTaxStrategy = 'entered' | 'total'
export const priceTaxChoiceLabel = (mode: string) =>
  mode === 'includes' || mode === 'saved-includes'
    ? 'Tax included in price'
    : mode === 'before' || mode === 'saved-before'
      ? 'Tax added to price'
      : 'Use tax rate settings'

// An exact cent price does not always exist when tax is added to the price.
export function enteredPriceForTotal(total: number, rates: TaxRate[]) {
  const cents = Math.round(total * 100)
  if (!Number.isSafeInteger(cents))
    throw new Error('Customer total is too large to convert exactly.')
  let low = 0,
    high = cents
  while (low <= high) {
    const mid = low + Math.floor((high - low) / 2)
    const found = Math.round(calculateTax(mid / 100, rates).customerTotal * 100)
    if (found === cents) return mid / 100
    if (found < cents) low = mid + 1
    else high = mid - 1
  }
  throw new Error(
    'No entered price in whole cents keeps this exact customer total. Choose Preserve entered prices to continue.',
  )
}

export function planPriceTaxChange(
  workspace: Workspace,
  date: string,
  strategy: PriceTaxStrategy,
  includeOverrides: boolean,
) {
  const business = workspace.settings[0]
  const defaultMode = businessPriceTaxMode(business)
  const counts = { Food: 0, Handmade: 0, Resale: 0, Baskets: 0 }
  let overrides = 0,
    overridesReplaced = 0
  const rows = [...workspace.products]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((product) => {
      if (product.priceTaxMode === 'inherit') return []
      const override = ['before', 'includes'].includes(product.priceTaxMode)
      if (override) overrides++
      if (override && !includeOverrides) return []
      if (override) overridesReplaced++
      const type =
        product.workflow === 'handmade'
          ? 'Handmade'
          : product.workflow === 'resale'
            ? 'Resale'
            : product.workflow === 'kit'
              ? 'Baskets'
              : 'Food'
      counts[type]++
      const existingMode = product.priceTaxMode || 'configured'
      const base = {
        id: product.id,
        name: product.name,
        type,
        override,
        existingMode,
      }
      const patch: Record<string, string | number> = {
        priceTaxMode: 'inherit',
      }
      try {
        const oldRates = applicableTaxes(product, business, date)
        const newRates = applicableTaxes(
          { ...product, ...patch },
          business,
          date,
        )
        const { cost } = cardCost(product, workspace)
        const sample = (price: number, rates: TaxRate[]) => {
          const t = calculateTax(price, rates)
          return {
            price,
            tax: t.tax,
            total: t.customerTotal,
            margin:
              cost === undefined || !Number.isFinite(cost)
                ? null
                : t.revenueExact > 0
                  ? ((t.revenueExact - cost) / t.revenueExact) * 100
                  : 0,
          }
        }
        const prices = (['price', 'wholesale'] as const).flatMap((field) => {
          const value = product[field]
          if (value == null || String(value).trim() === '') return []
          const before = sample(
            number(
              value,
              field === 'price' ? 'Selling price' : 'Wholesale price',
            ),
            oldRates,
          )
          const price =
            strategy === 'total'
              ? enteredPriceForTotal(before.total, newRates)
              : before.price
          if (strategy === 'total' && price !== before.price)
            patch[field] = price
          return [{ field, before, after: sample(price, newRates) }]
        })
        return [
          {
            ...base,
            patch,
            prices,
            beforeLabel: priceTaxLabel(oldRates),
            afterLabel: priceTaxLabel(newRates),
            error: '',
          },
        ]
      } catch (error) {
        return [
          {
            ...base,
            patch,
            prices: [],
            beforeLabel: '',
            afterLabel: '',
            error: (error as Error).message,
          },
        ]
      }
    })
  return {
    defaultMode,
    date,
    strategy,
    includeOverrides,
    counts,
    overrides,
    overridesReplaced,
    rows,
    failures: rows.filter((r) => r.error).length,
  }
}

export type PriceTaxPlan = ReturnType<typeof planPriceTaxChange>
