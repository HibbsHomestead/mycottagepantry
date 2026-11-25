import {
  basketAssemblyCosts,
  basketComponentCosts,
  isMixedPack,
  money,
  priceTaxLabel,
  type Workspace,
  type Item,
} from '@/lib/domain'
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
  const subject = isMixedPack(product) ? 'mixed pack' : 'basket'
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
  const knownComponents = c
    ? []
    : basketComponentCosts(product, workspace, {
        allowResaleEstimate: true,
      }).filter((line) => line.cost !== undefined)
  const additional = basketAssemblyCosts(product, workspace)
  const amount = (value: number | undefined) =>
    value === undefined ? 'Unavailable' : costMoney(value)
  const breakdown = [
    {
      label: c ? 'Included products' : 'Known included-product subtotal',
      value:
        c?.ingredient ??
        (knownComponents.length
          ? knownComponents.reduce((sum, line) => sum + line.cost!, 0)
          : undefined),
      tone: 'lavender' as const,
    },
    {
      label: subject === 'mixed pack' ? 'Outer packaging and labels' : 'Additional basket packaging',
      value: additional.packagingCost,
      tone: 'blue' as const,
    },
    {
      label: 'Additional assembly labor',
      value: additional.labor,
      tone: 'peach' as const,
    },
    {
      label: `Additional ${subject} overhead`,
      value: additional.overhead,
      tone: 'neutral' as const,
    },
  ]
  return (
    <div className="pricing-summary cost-summary">
      <div
        className="cost-card-grid cost-breakdown-grid"
        aria-label={`Cost breakdown per ${subject}`}
      >
        {breakdown.map((row) => (
          <CostCard
            key={row.label}
            label={row.label}
            value={amount(row.value)}
            note={`Per ${subject}`}
            tone={row.tone}
          />
        ))}
      </div>
      <div className="detail-stats cost-card-grid">
        <CostCard
          label={`Cost per ${subject}`}
          value={c ? amount(c.perPackage) : 'Incomplete'}
          note={`One sellable ${subject} · current estimate`}
        />
        <CostCard
          label="Selling price"
          value={
            Number.isFinite(price) && price >= 0 ? money(price) : 'Not set'
          }
          note={tax ? priceTaxLabel(tax.snapshot) : 'Tax treatment unavailable'}
          tone="blue"
        />
        <CostCard
          label={`Profit per ${subject}`}
          value={amount(p?.profit)}
          note={`Revenue less ${subject} cost; excludes tax`}
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
          label={`Tax per ${subject}`}
          value={amount(tax?.tax)}
          note="Collected for tax; separate from revenue"
          tone="peach"
        />
        <CostCard
          label="Customer price"
          value={amount(tax?.customerTotal)}
          note={`Total including tax; per ${subject}`}
          tone="blue"
        />
        <CostCard
          label="Revenue excluding tax"
          value={amount(tax?.revenue)}
          note={`Per ${subject}`}
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
              ? `Edit ${subject}`
              : configuration === 'Categories'
                ? 'Review category'
                : 'Review tax settings'}
          </button>
        </div>
      )}
      <details className="calculation-box">
        <summary>How this is calculated</summary>
        <p>
          {subject === 'mixed pack'
            ? 'Unpackaged output includes recipe production labor and overhead but excludes selling packaging. A finished package includes its own packaging. Component costs are counted once.'
            : 'Each configured quantity is a whole selling package, not an individual item inside that package. Included product costs already contain component production labor, overhead and packaging; those costs are counted once.'}
        </p>
        <p>
          Current estimates can change as inputs change. Completed assembly uses
          recorded stock valuation and retains its posted costs.
        </p>
        {additional.packaging.map((line, index) => (
          <p key={index}>
            {line.name}: {line.quantity}{' '}
            {line.unit ||
              workspace.ingredients.find((i) => i.id === line.ingredientId)
                ?.unit}{' '}
            = {costMoney(line.cost)} additional packaging per {subject}.
          </p>
        ))}
        {additional.packagingIssue && (
          <p className="warning-text">{additional.packagingIssue}</p>
        )}
        {additional.laborIssue && (
          <p className="warning-text">{additional.laborIssue}</p>
        )}
        {additional.labor !== undefined && (
          <p>
            Additional assembly: {additional.laborMinutes} minutes ÷ 60 ×{' '}
            {money(additional.laborRate!)} per hour ={' '}
            {costMoney(additional.labor)} per {subject}.
          </p>
        )}
        <p>
          Additional overhead: {money(additional.overhead)}.
          {!additional.overhead && ` No separate ${subject} overhead charge is configured.`}
        </p>
        {c && (
          <>
            <p>
              Total cost per {subject} = included products (
              {costMoney(c.ingredient)}) + additional packaging (
              {costMoney(c.packagingCost)}) + assembly ({costMoney(c.labor)})
              {c.overhead ? ` + packing overhead (${costMoney(c.overhead)})` : ''} ={' '}
              {costMoney(c.perPackage)}.
            </p>
          </>
        )}
        {p && (
          <>
            <p>
              Profit per {subject} = revenue excluding tax ({money(p.revenue)}) −
              total cost per {subject} ({money(c!.perPackage)}). Margin = profit ÷
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
          Viewing or editing a {subject} definition does not assemble products,
          reserve stock or create stock movements.
        </p>
      </details>
    </div>
  )
}
