import type { Item, TaxRate } from './domain'

/** The existing saved rate configuration, including the pre-rate-editor business default. */
export function configuredTaxRates(business: Item): TaxRate[] {
  return (
    business.taxRates ??
    (Number(business.taxRate) > 0
      ? [
          {
            id: 'legacy-default',
            name: 'Business default',
            jurisdiction: business.jurisdiction || 'Business jurisdiction',
            ratePercent: business.taxRate,
            behavior: 'exclusive',
          },
        ]
      : [])
  )
}
