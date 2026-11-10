import {
  productCosting,
  profitability,
  money,
  type Item,
  type Workspace,
} from '@/lib/domain'
import { CostCard, costMoney } from './cost-cards'

export function KitCostCards({
  product,
  workspace,
  edit,
}: {
  product: Item
  workspace: Workspace
  edit: () => void
}) {
  let cost: ReturnType<typeof productCosting> | undefined
  let pricing: ReturnType<typeof profitability> | undefined
  let costIssue = ''
  let pricingIssue = ''
  try {
    cost = productCosting(product, workspace)
  } catch (e) {
    costIssue = (e as Error).message
  }
  try {
    pricing = profitability(
      product,
      cost?.perPackage ?? 0,
      workspace.settings[0],
    )
  } catch (e) {
    pricingIssue = (e as Error).message
  }
  const target = Number(product.targetMargin ?? 65)
  const breakdown = [
    {
      label: 'Included product costs',
      value: cost?.ingredient,
      tone: 'lavender' as const,
    },
    {
      label: 'Additional kit packaging',
      value: cost?.packagingCost,
      tone: 'blue' as const,
    },
    {
      label: 'Additional assembly labor',
      value: cost?.labor,
      tone: 'peach' as const,
    },
    {
      label: 'Additional overhead',
      value: cost?.overhead,
      tone: 'neutral' as const,
    },
  ]
  return (
    <div className="pricing-summary cost-summary">
      {(costIssue || pricingIssue) && (
        <div role="status" className="warning-text">
          Estimate incomplete: {product.name}: {costIssue || pricingIssue}{' '}
          {pricingIssue &&
            'Review this kit’s Category in Contents & details and its category tax treatment in Products → Categories.'}{' '}
          <button className="text-button" onClick={edit}>
            Edit kit configuration
          </button>
        </div>
      )}
      <div
        className="cost-card-grid cost-breakdown-grid"
        aria-label="Cost breakdown per kit"
      >
        {breakdown.map((row) => (
          <CostCard
            key={row.label}
            label={row.label}
            value={row.value == null ? 'Unavailable' : costMoney(row.value)}
            note="per kit"
            tone={row.tone}
          />
        ))}
      </div>
      <div className="detail-stats cost-card-grid">
        <CostCard
          label="Total cost per kit"
          value={cost ? money(cost.perPackage) : 'Unavailable'}
          note="one sellable kit"
        />
        <CostCard
          label="Selling price"
          value={
            product.price == null || product.price === ''
              ? 'Not configured'
              : money(Number(product.price))
          }
          note="per kit"
          tone="blue"
        />
        <CostCard
          label="Profit per kit"
          value={cost && pricing ? money(pricing.profit) : 'Unavailable'}
          note="Revenue less kit cost; excludes tax"
          tone="green"
        />
      </div>
      <div className="cost-card-grid">
        <CostCard
          label="Margin"
          value={
            cost && pricing ? `${pricing.margin.toFixed(2)}%` : 'Unavailable'
          }
          note={`Target margin: ${target}%`}
          tone="green"
        />
        <CostCard
          label="Suggested selling price"
          value={cost && pricing ? money(pricing.suggested) : 'Unavailable'}
          note={`For ${target}% target margin`}
        />
        <CostCard
          label="Tax per kit"
          value={pricing ? money(pricing.tax) : 'Unavailable'}
          note="Collected for tax; separate from revenue"
          tone="peach"
        />
        <CostCard
          label="Customer price"
          value={pricing ? money(pricing.customerTotal) : 'Unavailable'}
          note="Total including tax"
          tone="blue"
        />
        <CostCard
          label="Revenue excluding tax"
          value={pricing ? money(pricing.revenue) : 'Unavailable'}
          note="per kit"
          tone="neutral"
        />
      </div>
      <details className="calculation-box">
        <summary>How this is calculated</summary>
        <p>
          Included products use their configured whole selling package
          quantities and complete current package costs. Component production
          labor, overhead and packaging are already included and are not added
          again.
        </p>
        {cost?.lines.map((line: Item, index: number) => (
          <p key={index}>
            {line.name}: {line.quantity} selling packages ={' '}
            {costMoney(line.cost)} per kit.
          </p>
        ))}
        {cost?.packaging.map((line: Item, index: number) => (
          <p key={index}>
            {line.name}: {line.quantity} {line.unit} = {costMoney(line.cost)}{' '}
            per kit.
          </p>
        ))}
        <p>
          Only kit-specific packaging and assembly are added. No separate kit
          overhead is configured by the existing costing rules.
        </p>
        {cost && (
          <p>
            Assembly: {cost.laborMinutes} minutes ÷ 60 × {money(cost.laborRate)}{' '}
            per hour. Total cost per kit: {money(cost.perPackage)}.
          </p>
        )}
        <p>
          Profit per kit = revenue excluding tax − total cost per kit. Margin =
          profit ÷ revenue excluding tax. Suggested price uses the saved target
          margin and configured tax treatment.
        </p>
        {pricingIssue && (
          <p>
            Tax, customer price, revenue, profit, margin and suggested price
            remain unavailable until pricing configuration is complete.
          </p>
        )}
        {pricing?.snapshot.map((row) => (
          <p key={row.id}>
            {row.name} · {row.jurisdiction}: {row.ratePercent}% {row.behavior};
            tax {money(row.amount)} per kit.
          </p>
        ))}
      </details>
    </div>
  )
}
