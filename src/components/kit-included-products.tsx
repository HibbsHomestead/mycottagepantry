import { productCosting, type Item, type Workspace } from '@/lib/domain'
import './kit-components.css'

type Props = {
  product: Item
  workspace: Workspace
  openProduct: (product: Item) => void
}

export function KitProductList({ product, workspace, openProduct }: Props) {
  return (
    <ul className="kit-component-list">
      {(product.kitComponents || []).map((line: Item, index: number) => {
        const component = workspace.products.find(
          (p) => p.id === line.productId,
        )
        let issue = ''
        try {
          if (component) productCosting(component, workspace)
        } catch (error) {
          issue = (error as Error).message
        }
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
            {line.basis !== 'package' && (
              <small className="warning-text">
                Unsupported quantity basis ({line.basis || 'not configured'}).
                Edit kit to review this component.
              </small>
            )}
            {issue && (
              <small className="warning-text">
                {issue} Open product details to review its cost setup.
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
      <KitProductList {...props} />
    </section>
  )
}
