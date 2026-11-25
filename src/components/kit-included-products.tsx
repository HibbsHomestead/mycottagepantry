import { basketComponentCosts, type Item, type Workspace } from '@/lib/domain'
import { costMoney } from './cost-cards'
import './kit-components.css'

type Props = {
  product: Item
  workspace: Workspace
  openProduct: (product: Item) => void
  showCosts?: boolean
}

export function KitProductList({
  product,
  workspace,
  openProduct,
  showCosts,
}: Props) {
  return (
    <ul className="kit-component-list">
      {basketComponentCosts(product, workspace, {
        allowResaleEstimate: true,
      }).map((line, index) => {
        const { component, issue } = line
        const recorded =
          component?.stockCostKnown === true &&
          component.cost != null &&
          String(component.cost).trim() !== ''
            ? Number(component.cost)
            : NaN
        return (
          <li key={`${line.productId}-${index}`}>
            {component ? (
              <button
                type="button"
                className="text-button"
                onClick={() => openProduct(component)}
              >
                {component.name}{' '}
                <span className="kit-component-count">×{line.quantity}</span>
              </button>
            ) : (
              <strong>
                Unavailable product · {line.productId} ×{line.quantity}
              </strong>
            )}
            {component?.archived && <small>Archived product</small>}
            {showCosts && line.unitCost !== undefined && (
              <small>
                {line.quantity} whole selling{' '}
                {Number(line.quantity) === 1 ? 'package' : 'packages'}
                {component?.sellingUnit && ` (${component.sellingUnit})`}
                {' · '}
                {costMoney(line.unitCost)} per included package
                {' · '}
                {costMoney(line.cost!)} extended · {line.source}
              </small>
            )}
            {showCosts &&
              line.unitCost !== undefined &&
              Number.isFinite(recorded) &&
              recorded >= 0 &&
              Math.abs(recorded - line.unitCost) > 1e-8 && (
                <small>
                  Recorded stock basis: {costMoney(recorded)} per package. Not
                  used in this estimate.
                </small>
              )}
            {line.basis !== 'package' && (
              <small className="warning-text">
                Unsupported quantity basis ({line.basis || 'not configured'}).
                Edit basket to review this component.
              </small>
            )}
            {issue && (
              <small className="warning-text">
                {issue}{' '}
                {component && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => openProduct(component)}
                  >
                    Review {component.name}
                  </button>
                )}
              </small>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function KitIncludedProducts(props: Props) {
  return (
    <section aria-label="Included products" className="kit-included-products">
      <h3>Included products</h3>
      <KitProductList {...props} showCosts />
    </section>
  )
}
