import {
  applicableTaxes,
  money,
  productCosting,
  profitability,
  type Item,
  type Workspace,
} from '@/lib/domain'
import { CostCard, costMoney } from './cost-cards'

/** Product Details presentation only. The editor retains its existing summary. */
function productCostCardData({
  product,
  cost,
  workspace,
}: {
  product: Item
  cost: number
  workspace: Workspace
}) {
  try {
    const c = productCosting(product, workspace)
    const business = workspace.settings[0]
    const p = profitability(product, cost, business)
    const wholesale = profitability(
      product,
      cost,
      business,
      Number(product.wholesale || 0),
    )
    const target = Number(product.targetMargin ?? 65)
    const taxes = applicableTaxes(product, business)
    const inclusive = taxes.some((r) => r.behavior === 'inclusive')
    const exclusive = taxes.some((r) => r.behavior === 'exclusive')
    const breakdown =
      product.workflow === 'resale'
        ? [
            {
              label: 'Purchased stock',
              value: c.overhead,
              tone: 'lavender' as const,
            },
          ]
        : [
            {
              label:
                product.workflow === 'handmade' ? 'Materials' : 'Ingredients',
              value: c.ingredient,
              tone: 'lavender' as const,
            },
            {
              label: 'Packaging',
              value: c.packagingCost,
              tone: 'blue' as const,
            },
            { label: 'Labor', value: c.labor, tone: 'peach' as const },
            { label: 'Overhead', value: c.overhead, tone: 'neutral' as const },
            ...(c.waste
              ? [{ label: 'Waste', value: c.waste, tone: 'rose' as const }]
              : []),
          ]
    return { c, p, wholesale, target, taxes, inclusive, exclusive, breakdown }
  } catch (error) {
    return { error: (error as Error).message }
  }
}

export function ProductCostCards({
  product,
  cost,
  workspace,
}: {
  product: Item
  cost: number
  workspace: Workspace
}) {
  const data = productCostCardData({ product, cost, workspace })
  if ('error' in data)
    return (
      <div className="pricing-summary">
        <p role="alert" className="warning-text">
          Pricing unavailable: {data.error}
        </p>
      </div>
    )
  const { c, p, wholesale, target, taxes, inclusive, exclusive, breakdown } =
    data
  return (
    <div className="pricing-summary cost-summary">
      <div className="detail-stats cost-card-grid">
        <CostCard
          label="Cost to make"
          value={money(cost)}
          note={`${c.unitsPerPackage} ${c.unitsPerPackage === 1 ? 'item' : 'items'} per package`}
        />
        <CostCard
          label="Selling price"
          value={money(Number(product.price || 0))}
          note={
            inclusive
              ? exclusive
                ? 'Some tax included; some added'
                : 'Includes tax'
              : taxes.length
                ? 'Before tax'
                : 'No applicable tax'
          }
          tone="blue"
        />
        <CostCard
          label="Gross profit"
          value={money(p.profit)}
          note="Revenue less product cost; excludes tax"
          tone="green"
        />
      </div>
      <section
        className="product-money-breakdown"
        aria-label="Cost breakdown per package"
      >
        <h3>Where your money goes</h3>
        <p className="table-note">For each package sold</p>
        <div className="product-cost-bar" aria-hidden="true">
          {breakdown.map((row) => (
            <span
              key={row.label}
              className={`cost-segment-${row.tone}`}
              style={{ flexGrow: Math.max(0, row.value) }}
            />
          ))}
        </div>
        <dl>
          {breakdown.map((row) => (
            <div key={row.label}>
              <dt>
                <span className={`cost-dot cost-segment-${row.tone}`} />
                {row.label}
              </dt>
              <dd>
                {row.value !== 0 && Math.abs(row.value / c.packages) < 0.005
                  ? costMoney(row.value / c.packages)
                  : money(row.value / c.packages)}
              </dd>
            </div>
          ))}
        </dl>
        <div className="product-cost-total">
          <strong>Total cost per package</strong>
          <strong>{money(cost)}</strong>
        </div>
        <p className="table-note">
          Amounts are rounded; totals use full precision.
        </p>
        {inclusive && (
          <p className="product-tax-note">
            Sales tax included in price: {money(p.tax)}
          </p>
        )}
        <p className="product-profit-note">
          After sales tax and listed product costs, {money(p.profit)} remains
          per package to cover other business expenses and profit.
        </p>
      </section>
      <details className="calculation-box">
        <summary>How this is calculated</summary>
        <div className="cost-card-grid">
          <CostCard
            label="Margin"
            value={`${p.margin.toFixed(2)}%`}
            note={`Target margin: ${target}%`}
            tone={p.margin < target ? 'peach' : 'green'}
          />
          <CostCard
            label="Suggested selling price"
            value={money(p.suggested)}
            note={`For ${target}% target margin${inclusive ? '; includes applicable tax' : ''}`}
          />
          {taxes.length > 0 && (
            <>
              <CostCard
                label="Tax per package"
                value={money(p.tax)}
                note="Collected for tax; separate from revenue"
                tone="peach"
              />
              <CostCard
                label="Customer price"
                value={money(p.customerTotal)}
                note="Total including tax"
                tone="blue"
              />
              <CostCard
                label="Revenue excluding tax"
                value={money(p.revenue)}
                note="per package"
                tone="neutral"
              />
            </>
          )}
          {product.workflow !== 'handmade' &&
            Number(product.targetFoodCost) > 0 && (
              <CostCard
                label="Food-cost target price"
                value={money(
                  (c.ingredient /
                    c.packages /
                    (Number(product.targetFoodCost) / 100)) *
                    p.divisor,
                )}
                note={`For ${product.targetFoodCost}% ingredient cost`}
              />
            )}
        </div>

        <p>
          Each cost above is the batch amount divided by {c.packages} sellable
          packages. Batch cost: {money(c.total)}; yield: {c.actualYield} items;{' '}
          {c.unitsPerPackage} items per package.
        </p>
        {breakdown.map((row) => (
          <p key={row.label}>
            {row.label}: {money(row.value)} per batch ÷ {c.packages} packages ={' '}
            {costMoney(row.value / c.packages)} per package.
          </p>
        ))}
        {c.packaging.map((line, index) => (
          <p key={index}>
            {line.name}: {line.inventoryQuantity} {line.storageUnit} at{' '}
            {costMoney(line.unitCost)} / {line.storageUnit} = {money(line.cost)}{' '}
            per batch.
          </p>
        ))}
        <p>
          Profit per package = revenue excluding tax ({money(p.revenue)}) − cost
          per package ({money(cost)}). Margin = profit ÷ revenue excluding tax.
          Margin and markup use different bases.
        </p>
        <p>
          Suggested selling price uses the saved {target}% target margin and the
          configured tax treatment.
        </p>
        {p.snapshot.map((row) => (
          <p key={row.id}>
            {row.name} · {row.jurisdiction}: {row.ratePercent}%{' '}
            {row.behavior === 'inclusive'
              ? 'included in price'
              : 'added to price'}
            ; tax {money(row.amount)}.
          </p>
        ))}
        {!p.snapshot.length && (
          <p>
            {product.taxStatus === 'exempt'
              ? 'Tax exempt.'
              : product.taxStatus === 'zero_rated'
                ? 'Zero-rated.'
                : 'No applicable active tax rates.'}
          </p>
        )}
        <p>
          Customer price: {money(p.customerTotal)}. Revenue excluding tax:{' '}
          {money(p.revenue)}. Tax: {money(p.tax)}.
        </p>
        <p>
          Wholesale selling price: {money(Number(product.wholesale || 0))};
          revenue excluding tax: {money(wholesale.revenue)}; profit per package:{' '}
          {money(wholesale.profit)}; margin: {wholesale.margin.toFixed(2)}%.
        </p>
        <p>
          Period operating expenses and processing fees also affect net profit.
          Review Finances for net profit.
        </p>
      </details>
    </div>
  )
}

export function ProductMarginCard({
  product,
  cost,
  workspace,
}: {
  product: Item
  cost: number
  workspace: Workspace
}) {
  const data = productCostCardData({ product, cost, workspace })
  if ('error' in data) return null
  const { p, target, c } = data
  return (
    <section className="product-margin-card">
      <h3>{product.name}</h3>
      <p>
        {product.category || 'Product'} · {c.unitsPerPackage}{' '}
        {c.unitsPerPackage === 1 ? 'item' : 'items'} per package
      </p>
      <div>
        <h4>Gross margin</h4>
        <strong>{p.margin.toFixed(2)}%</strong>
        <p>
          {p.margin >= target ? 'Meets' : 'Below'} your {target}% target
        </p>
        <p>
          Suggested price for your target: <b>{money(p.suggested)}</b>
        </p>
      </div>
    </section>
  )
}
