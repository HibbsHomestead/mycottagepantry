import { money, type Item, type Workspace } from '@/lib/domain'
import { purchaseEstimate, resaleCostEvidence } from '@/lib/resale-cost'
import { costMoney } from './cost-cards'

export function ResalePurchaseSetup({
  product,
  change,
}: {
  product: Item
  change: (key: string, value: Item[string]) => void
}) {
  const defaults = product.purchaseDefaults || {}
  const update = (key: string, value: string) =>
    change('purchaseDefaults', { ...defaults, [key]: value })
  const estimate = purchaseEstimate(product)
  return (
    <fieldset className="resale-stock-group">
      <legend>Purchase cost</legend>
      <p className="form-hint">
        Expected purchase price for future entries and estimates. Saving does
        not receive stock, change inventory value, or rewrite receipts.
      </p>
      <div className="form-grid">
        <label className="field">
          <span>Default purchase price per pack/case</span>
          <input
            type="number"
            min="0"
            step="any"
            value={defaults.packPrice ?? ''}
            onChange={(e) => update('packPrice', e.target.value)}
            required={!!product.purchaseDefaults}
          />
        </label>
        <label className="field">
          <span>Purchase pack contains this many sellable items</span>
          <input
            type="number"
            min="1"
            step="1"
            value={defaults.itemsPerPack ?? ''}
            onChange={(e) => update('itemsPerPack', e.target.value)}
            required={!!product.purchaseDefaults}
          />
        </label>
        <label className="field">
          <span>Default purchase unit</span>
          <select
            value={defaults.unit || 'pack'}
            onChange={(e) =>
              change('purchaseDefaults', {
                ...defaults,
                unit: e.target.value,
                ...(e.target.value === 'each' ? { itemsPerPack: 1 } : {}),
              })
            }
          >
            {['each', 'pack', 'case', 'box'].map((unit) => (
              <option key={unit}>{unit}</option>
            ))}
          </select>
        </label>
      </div>
      <p>
        {estimate === undefined ? (
          'Purchase estimate not configured.'
        ) : (
          <>
            Estimated purchase cost per sellable item:{' '}
            <strong>{costMoney(estimate)}</strong>
          </>
        )}
      </p>
      <p className="form-hint">
        A multipack sold unopened is one sellable item. Pack contents in the
        product name never set this conversion. Supplier is set in Details.
      </p>
      {product.purchaseDefaults && (
        <button
          type="button"
          className="text-button"
          onClick={() => change('purchaseDefaults', null)}
        >
          Clear purchase defaults
        </button>
      )}
    </fieldset>
  )
}

export function ResaleCostBreakdown({
  product,
  workspace,
}: {
  product: Item
  workspace: Workspace
}) {
  const { basis, receipts, lastUnitCost, entry } = resaleCostEvidence(
    product,
    workspace,
  )
  const hasLast =
    product.purchaseCost != null &&
    product.purchaseCost !== '' &&
    Number.isFinite(Number(product.purchaseCost)) &&
    Number(product.purchaseCost) >= 0 &&
    Number(product.purchaseQuantity) > 0 &&
    Number(product.itemsPerUnit) > 0
  return (
    <section
      className="resale-cost-breakdown"
      aria-label="Resale purchase cost breakdown"
    >
      <h3>Purchase cost per sellable item</h3>
      <dl className="item-editor-summary-list">
        <div>
          <dt>Cost basis</dt>
          <dd>{basis.label}</dd>
        </div>
        <div>
          <dt>Total cost per sellable item</dt>
          <dd>
            {basis.cost === undefined
              ? 'Purchase cost not recorded'
              : costMoney(basis.cost)}
          </dd>
        </div>
        <div>
          <dt>Merchandise / acquisition cost</dt>
          <dd>
            {basis.cost === undefined
              ? 'Not recorded'
              : `${costMoney(basis.cost)} combined basis`}
          </dd>
        </div>
        <div>
          <dt>Inbound shipping / freight</dt>
          <dd>Not separately recorded</dd>
        </div>
        <div>
          <dt>Purchase-side tax / other charges</dt>
          <dd>Not separately recorded</dd>
        </div>
        <div>
          <dt>Additional selling packaging / preparation</dt>
          <dd>Not configured for resale</dd>
        </div>
      </dl>
      <p className="form-hint">
        Receipts store a combined acquisition total. Charges may already be
        included; no extra allocation is added. Sales tax collected and selling
        fees are separate.
      </p>
      {hasLast && (
        <p>
          Last recorded purchase: {product.purchaseQuantity}{' '}
          {product.purchaseUnit || 'purchase units'} × {product.itemsPerUnit}{' '}
          sellable items ={' '}
          {Number(product.purchaseQuantity) * Number(product.itemsPerUnit)}{' '}
          items. {money(product.purchaseCost)} total ÷ those items ={' '}
          {costMoney(
            Number(product.purchaseCost) /
              (Number(product.purchaseQuantity) * Number(product.itemsPerUnit)),
          )}{' '}
          per item.
        </p>
      )}
      {lastUnitCost !== undefined && (
        <p>
          Last purchase price: {costMoney(lastUnitCost)} per sellable item. This
          can differ from the weighted average of existing stock.
        </p>
      )}
      {entry && (
        <p>
          Starting-stock source:{' '}
          {entry.choice === 'purchase'
            ? 'recorded starting purchase'
            : 'opening inventory'}
          {entry.costEstimated ? ' (estimate)' : ''}; {entry.quantity} sellable
          items,{' '}
          {entry.totalCost !== '' &&
          entry.totalCost != null &&
          Number.isFinite(Number(entry.totalCost))
            ? money(entry.totalCost)
            : 'Total cost not recorded'}{' '}
          total.
        </p>
      )}
      <p className="form-hint">
        {receipts.length
          ? `${receipts.length} purchase receipt(s) in this workspace.`
          : 'No purchase receipt in the available workspace history.'}{' '}
        {product.stockCostKnown &&
        basis.cost !== undefined &&
        !hasLast &&
        !entry &&
        !receipts.length
          ? 'Recorded cost provenance is unavailable; review receipt history before correcting it.'
          : ''}
      </p>
      {purchaseEstimate(product) !== undefined && (
        <p>
          Configured estimate: {costMoney(purchaseEstimate(product)!)} per item.{' '}
          {product.stockCostKnown
            ? 'The estimate does not replace recorded inventory cost.'
            : 'An estimate is not an actual received cost.'}
        </p>
      )}
    </section>
  )
}
