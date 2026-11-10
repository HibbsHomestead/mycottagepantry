import { money, type Item, type Workspace } from '@/lib/domain'
import { kitEstimate } from '@/lib/kit-estimate'
import { CostCard, costMoney } from './cost-cards'

export function KitCostCards({
  product,
  workspace,
  edit,
  configure,
  canEdit = true,
}: {
  product: Item
  workspace: Workspace
  edit: () => void
  configure: (section: string) => void
  canEdit?: boolean
}) {
  const {
    cost: c,
    tax,
    pricing: p,
    price,
    costError,
    pricingError,
    configuration,
    explanation,
  } = kitEstimate(product, workspace)
  const target = Number(product.targetMargin ?? 65)
  const amount = (value: number | undefined) =>
    value === undefined ? 'Unavailable' : costMoney(value)
  const breakdown = [
    {
      label: 'Included products',
      value: c?.ingredient,
      tone: 'lavender' as const,
    },
    {
      label: 'Additional packaging',
      value: c?.packagingCost,
      tone: 'blue' as const,
    },
    { label: 'Assembly labor', value: c?.labor, tone: 'peach' as const },
    {
      label: 'Additional overhead',
      value: c?.overhead,
      tone: 'neutral' as const,
    },
  ]
  return (
    <div className="pricing-summary cost-summary">
      <div
        className="cost-card-grid cost-breakdown-grid"
        aria-label="Cost breakdown per kit"
      >
        {breakdown.map((row) => (
          <CostCard
            key={row.label}
            label={row.label}
            value={amount(row.value)}
            note="per kit"
            tone={row.tone}
          />
        ))}
      </div>
      <div className="detail-stats cost-card-grid">
        <CostCard
          label="Total cost per kit"
          value={amount(c?.perPackage)}
          note="one sellable kit"
        />
        <CostCard
          label="Selling price"
          value={
            Number.isFinite(price) && price >= 0 ? money(price) : 'Not set'
          }
          note={
            tax
              ? tax.snapshot.length
                ? 'Saved price; see tax below'
                : 'No applicable tax'
              : 'Tax treatment unavailable'
          }
          tone="blue"
        />
        <CostCard
          label="Profit per kit"
          value={amount(p?.profit)}
          note="Revenue less kit cost; excludes tax"
          tone="green"
        />
      </div>
      <div className="cost-card-grid">
        <CostCard
          label="Margin"
          value={p ? `${p.margin.toFixed(2)}%` : 'Unavailable'}
          note={`Target margin: ${target}%`}
          tone={p && p.margin < target ? 'peach' : 'green'}
        />
        <CostCard
          label="Suggested selling price"
          value={amount(p?.suggested)}
          note={`For ${target}% target margin`}
        />
        <CostCard
          label="Tax per kit"
          value={amount(tax?.tax)}
          note="Collected for tax; separate from revenue"
          tone="peach"
        />
        <CostCard
          label="Customer price"
          value={amount(tax?.customerTotal)}
          note="Total including tax; per kit"
          tone="blue"
        />
        <CostCard
          label="Revenue excluding tax"
          value={amount(tax?.revenue)}
          note="per kit"
          tone="neutral"
        />
      </div>
      {(costError || pricingError) && (
        <div className="kit-estimate-issue" role="status">
          {costError && <p>Estimate incomplete: {costError}</p>}
          {pricingError && <p>Estimate incomplete: {pricingError}</p>}
          <p>{explanation}</p>
          <p>
            Dependent figures remain unavailable until their requirements are
            met.
          </p>
          <button
            type="button"
            className="btn secondary"
            disabled={!canEdit}
            onClick={
              configuration === 'kit' ? edit : () => configure(configuration)
            }
          >
            {configuration === 'kit'
              ? 'Edit kit'
              : configuration === 'Categories'
                ? 'Review category'
                : 'Review tax settings'}
          </button>
        </div>
      )}
      <details className="calculation-box">
        <summary>How this is calculated</summary>
        <p>
          Each configured quantity is a whole selling package, not an individual
          item inside that package. Included product costs already contain
          component production labor, overhead and packaging; those costs are
          counted once.
        </p>
        {c?.lines.map((line: Item) => (
          <p key={line.productId}>
            {line.name}: {line.quantity} whole selling package(s) ={' '}
            {costMoney(line.cost)} per kit.
          </p>
        ))}
        {c?.packaging.map((line, index) => (
          <p key={index}>
            {line.name}: {line.quantity}{' '}
            {line.unit ||
              workspace.ingredients.find((i) => i.id === line.ingredientId)
                ?.unit}{' '}
            = {costMoney(line.cost)} additional packaging per kit.
          </p>
        ))}
        {c && (
          <>
            <p>
              Additional assembly: {c.laborMinutes} minutes ÷ 60 ×{' '}
              {money(c.laborRate)} per hour = {costMoney(c.labor)} per kit.
            </p>
            <p>
              Additional overhead: {money(c.overhead)}. The existing kit
              calculation adds no separate overhead charge.
            </p>
            <p>
              Total cost per kit = included products ({costMoney(c.ingredient)})
              + additional packaging ({costMoney(c.packagingCost)}) + assembly (
              {costMoney(c.labor)}) = {costMoney(c.perPackage)}.
            </p>
          </>
        )}
        {p && (
          <>
            <p>
              Profit per kit = revenue excluding tax ({money(p.revenue)}) −
              total cost per kit ({money(c!.perPackage)}). Margin = profit ÷
              revenue excluding tax.
            </p>
            <p>
              Suggested selling price uses the saved {target}% target margin and
              configured tax treatment.
            </p>
          </>
        )}
        {tax?.snapshot.map((row) => (
          <p key={row.id}>
            {row.name} · {row.jurisdiction}: {row.ratePercent}%{' '}
            {row.behavior === 'inclusive'
              ? 'included in price'
              : 'added to price'}
            ; tax {money(row.amount)}.
          </p>
        ))}
        {tax && !tax.snapshot.length && (
          <p>
            {product.taxStatus === 'exempt'
              ? 'Tax exempt.'
              : product.taxStatus === 'zero_rated'
                ? 'Zero-rated.'
                : 'No applicable active tax rates.'}
          </p>
        )}
        <p>
          Viewing or editing a kit definition does not assemble products,
          reserve stock or create stock movements.
        </p>
      </details>
    </div>
  )
}
