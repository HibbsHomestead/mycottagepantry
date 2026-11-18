import type { Item } from '@/lib/domain'
import { configuredTaxRates } from '@/lib/tax-configuration'
import { TaxRateEditor } from './financial-editors'

/** One existing rate collection; opening this editor never normalizes saved values. */
export function BusinessTaxFields({
  business,
  onChange,
}: {
  business: Item
  onChange: (key: string, value: any) => void
}) {
  const rates = configuredTaxRates(business)
  const single = rates.length === 1 ? rates[0] : undefined
  const simple =
    !rates.length ||
    (!!single &&
      !single.compound &&
      single.active !== false &&
      (!single.appliesTo || single.appliesTo === 'all_products') &&
      !single.start &&
      !single.end &&
      !single.category)
  const update = (key: string, value: unknown) =>
    onChange(
      'taxRates',
      single
        ? [{ ...single, [key]: value }]
        : [
            {
              id: 'business-default-' + crypto.randomUUID(),
              name: 'Business default',
              jurisdiction: business.jurisdiction || '',
              ratePercent: '',
              behavior: 'exclusive',
              active: true,
              [key]: value,
            },
          ],
    )
  const nominal = rates
    .filter((r) => r.active !== false)
    .reduce((sum, r) => sum + Number(r.ratePercent), 0)
  return (
    <section
      className="business-tax-fields"
      aria-label="Sales tax configuration"
    >
      <h3>Sales tax</h3>
      {simple ? (
        <>
          <div className="form-grid">
            <label>
              Default sales-tax rate (%)
              <span className="percentage-input">
                <input
                  aria-label="Default sales-tax rate (%)"
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  required={!!single}
                  value={single?.ratePercent ?? ''}
                  placeholder="Not configured"
                  onChange={(e) =>
                    update(
                      'ratePercent',
                      e.target.value === '' ? '' : Number(e.target.value),
                    )
                  }
                />
                <span aria-hidden="true">%</span>
              </span>
            </label>
            <label>
              Pricing tax behavior
              <select
                value={single?.behavior || 'exclusive'}
                onChange={(e) => update('behavior', e.target.value)}
              >
                <option value="exclusive">Add tax to price (exclusive)</option>
                <option value="inclusive">
                  Tax included in price (inclusive)
                </option>
              </select>
            </label>
          </div>
          <p className="form-hint">
            Enter 8.25 for 8.25%.{' '}
            {single
              ? 'A saved 0% rate is explicitly configured.'
              : 'No rate is configured. Enter 0 explicitly for a zero-percent rate; blank is not tax exempt.'}{' '}
            Product/category assignments determine applicability.
          </p>
          {single && (
            <div className="form-grid">
              <label>
                Rate name
                <input
                  required
                  value={single.name}
                  onChange={(e) => update('name', e.target.value)}
                />
              </label>
              <label>
                Tax jurisdiction
                <input
                  required
                  value={single.jurisdiction}
                  onChange={(e) => update('jurisdiction', e.target.value)}
                />
              </label>
            </div>
          )}
          <details className="business-advanced">
            <summary>Advanced tax settings & component rates</summary>
            {single && (
              <p className="form-hint">
                This edits the same saved rate. Use component rates for separate
                jurisdictions or calculation rules; do not also enter their sum
                as another rate.
              </p>
            )}
            <TaxRateEditor
                business={business}
              rates={rates}
              onChange={(value) => onChange('taxRates', value)}
              showPrimaryFields={false}
            />
          </details>
        </>
      ) : (
        <>
          <p className="tax-combined-summary">
            Listed active component rates:{' '}
            <strong>{Number(nominal.toPrecision(12))}%</strong> nominal total.
          </p>
          <p className="form-hint">
            This total is before compounding. Rates may have different
            jurisdictions, scopes, dates or pricing behavior; it is not a rate
            applied to every product. Edit components below; no separate
            combined rate is stored.
          </p>
          <details className="business-advanced">
            <summary>
              Component rates & advanced tax settings ({rates.length})
            </summary>
            <TaxRateEditor
                business={business}
              rates={rates}
              onChange={(value) => onChange('taxRates', value)}
            />
          </details>
        </>
      )}
      <p className="form-hint">
        Food / non-food tax mappings and category treatment remain in Products →
        Categories. Recorded transaction taxes stay unchanged.
      </p>
    </section>
  )
}
