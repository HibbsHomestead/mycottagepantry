import { useId } from 'react'
import type { Item, Workspace } from '@/lib/domain'
import { precise } from '@/lib/ingredients'
import {
  inventoryPackagePreview,
  inventoryUnitOptions,
} from '@/lib/inventory-package'
import { ResaleSellUnitFields } from './resale-stock-fields'
import { costMoney } from './cost-cards'

/** Package cost and an independent opening count, using each item's stock rules. */
export function InventoryPackageFields({
  value,
  change,
  workspace,
}: {
  value: Item
  change: (key: string, value: Item[string]) => void
  workspace: Workspace
}) {
  const id = useId()
  const options = inventoryUnitOptions(value)
  const { plan: packagePlan, error: packageError } = inventoryPackagePreview({
    ...value,
    initialStock: false,
  })
  const { plan, error } = inventoryPackagePreview(value)
  const currency = workspace.settings[0]?.currency || 'USD'
  const money = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
      amount,
    )
  const countUnit = value.openingCountUnit || value.unit
  const count = Number(value.openingCount)
  const stockQuantity =
    value.openingCount !== '' && Number.isFinite(count) && count > 0
      ? countUnit === value.unit
        ? count
        : countUnit === value.purchaseUnit &&
            packagePlan?.amountPerPackage != null
          ? count * packagePlan.amountPerPackage
          : null
      : null
  const suggested =
    stockQuantity == null || packagePlan?.unitCost == null
      ? null
      : stockQuantity * packagePlan.unitCost
  const input = (key: string, label: string, required = false, min = 0) => (
    <input
      aria-label={label}
      type="number"
      inputMode="decimal"
      step="any"
      min={min}
      required={required}
      value={value[key] ?? ''}
      onChange={(e) => change(key, e.target.value)}
    />
  )
  return (
    <div className="inventory-package-fields">
      {value.usedAs === 'resale' && (
        <ResaleSellUnitFields value={value} change={change} />
      )}
      <fieldset className="inventory-package-group">
        <legend>Package &amp; Cost</legend>
        <div className="form-grid">
          <label className="field">
            <span>Supplier / vendor</span>
            <select
              aria-label="Supplier / vendor"
              value={value.vendorId || ''}
              onChange={(e) => change('vendorId', e.target.value)}
            >
              <option value="">Not set</option>
              {workspace.vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Purchase unit</span>
            <select
              aria-label="Purchase unit"
              aria-describedby={id + '-purchase-help'}
              value={value.purchaseUnit || ''}
              onChange={(e) => change('purchaseUnit', e.target.value)}
            >
              <option value="">Choose purchase unit</option>
              {value.purchaseUnit &&
                !options.purchase.includes(value.purchaseUnit) && (
                  <option value={value.purchaseUnit} disabled>
                    {value.purchaseUnit} — choose a current unit
                  </option>
                )}
              {options.purchase.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
            <small id={id + '-purchase-help'}>
              How you buy it, such as a bag, bottle, box, or pack.
            </small>
          </label>
          <label className="field">
            <span>Cost per package</span>
            <span className="inventory-unit-input">
              {input('packagePrice', 'Cost per package')}
              <span>per {value.purchaseUnit || 'package'}</span>
            </span>
            <small>
              {currency}. Leave blank if unknown; enter zero only for a package
              with no cost.
            </small>
            {value.listedOnlinePrice != null && (
              <small>
                Imported online price: {value.listedOnlinePrice}{' '}
                {value.currency || currency}. Review this estimate before
                saving. Record the actual amount paid when receiving stock.
              </small>
            )}
          </label>
          <label className="field">
            <span>Stock unit</span>
            <select
              aria-label="Stock unit"
              aria-describedby={id + '-stock-help'}
              value={value.unit}
              onChange={(e) => change('unit', e.target.value)}
            >
              {options.stock.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
            <small id={id + '-stock-help'}>
              How you track and use it, such as lb, g, fl oz, or each.
            </small>
          </label>
          <label className="field">
            <span>Amount in each package</span>
            <span className="inventory-unit-input">
              {input('amountPerPackage', 'Amount in each package')}
              <span>{value.unit}</span>
            </span>
          </label>
        </div>
        {packagePlan?.amountPerPackage != null && (
          <div className="inventory-package-summary" aria-live="polite">
            <p>
              1 {value.purchaseUnit} = {precise(packagePlan.amountPerPackage)}{' '}
              {value.unit}
            </p>
            <p>
              Cost per {value.unit}:{' '}
              {packagePlan.unitCost == null
                ? 'Not set'
                : costMoney(packagePlan.unitCost, currency)}
            </p>
          </div>
        )}
        {packageError && <p className="form-hint">{packageError}</p>}
      </fieldset>
      <fieldset className="inventory-package-group">
        <legend>Opening Count</legend>
        <label className="check-label">
          <input
            type="checkbox"
            checked={value.initialStock === true}
            onChange={(e) => change('initialStock', e.target.checked)}
          />
          Add what I already have on hand
        </label>
        <p className="form-hint">
          Stock you already own. For a partly used package, count what remains
          in the stock unit; no remaining quantity is assumed.
        </p>
        {value.initialStock === true && (
          <>
            <div className="inventory-opening-count">
              <label className="field">
                <span>Opening count</span>
                {input('openingCount', 'Opening count', true)}
              </label>
              <label className="field">
                <span>Count unit</span>
                <select
                  aria-label="Count unit"
                  value={countUnit}
                  onChange={(e) => change('openingCountUnit', e.target.value)}
                >
                  {countUnit &&
                    countUnit !== value.unit &&
                    countUnit !== value.purchaseUnit && (
                      <option value={countUnit} disabled>
                        {countUnit} — choose a current unit
                      </option>
                    )}
                  {value.purchaseUnit && value.purchaseUnit !== value.unit && (
                    <option value={value.purchaseUnit}>
                      {value.purchaseUnit[0].toUpperCase() +
                        value.purchaseUnit.slice(1)}{' '}
                      — purchase unit
                    </option>
                  )}
                  <option value={value.unit}>
                    {value.unit} — stock unit
                    {value.purchaseUnit === value.unit
                      ? ' / purchase unit'
                      : ''}
                  </option>
                </select>
              </label>
            </div>
            {stockQuantity != null && (
              <p className="inventory-package-summary" aria-live="polite">
                You’re adding {precise(stockQuantity)} {value.unit} to stock.
              </p>
            )}
            <p className="form-hint">
              Suggested opening stock value:{' '}
              {suggested == null
                ? 'Not available — enter package cost and contents, or use the optional override.'
                : money(suggested)}
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={value.openingValueOverride === true}
                onChange={(e) =>
                  change('openingValueOverride', e.target.checked)
                }
              />
              Override opening stock value (optional)
            </label>
            {value.openingValueOverride === true && (
              <label className="field">
                <span>Opening stock value override</span>
                {input('openingValue', 'Opening stock value override', true)}
                <small>
                  Total value of this opening count only. Package cost stays
                  unchanged.
                </small>
              </label>
            )}
            {plan?.override && (
              <p className="form-hint">
                Opening stock value used: {money(plan.openingValue!)}
              </p>
            )}
            <div className="form-grid">
              <label className="field">
                <span>Inventory as of</span>
                <input
                  aria-label="Inventory as of"
                  type="date"
                  required
                  value={value.receivedDate || ''}
                  onChange={(e) => change('receivedDate', e.target.value)}
                />
              </label>
              <label className="field">
                <span>Lot (optional)</span>
                <input
                  aria-label="Lot (optional)"
                  value={value.lot || ''}
                  onChange={(e) => change('lot', e.target.value)}
                />
              </label>
              <label className="field">
                <span>Expiry (optional)</span>
                <input
                  aria-label="Expiry (optional)"
                  type="date"
                  value={value.expires || ''}
                  onChange={(e) => change('expires', e.target.value)}
                />
              </label>
            </div>
            <p className="form-hint">
              Opening stock posts to owner equity. It does not record a new
              purchase or payment.
            </p>
            {error && <p className="form-hint">{error}</p>}
          </>
        )}
      </fieldset>
      <p className="form-hint">
        Buying new stock? Save this item, then choose Receive Stock to record
        the purchase separately.
      </p>
    </div>
  )
}
