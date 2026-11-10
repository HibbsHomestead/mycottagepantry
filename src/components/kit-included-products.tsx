import { productCosting, type Item, type Workspace } from '@/lib/domain'
import { singularYield } from '@/lib/product-recipe-links'

export function KitIncludedProducts({
  product,
  workspace,
  openProduct,
}: {
  product: Item
  workspace: Workspace
  openProduct: (product: Item) => void
}) {
  return (
    <section aria-label="Included products" className="kit-included-products">
      <h3>Included products</h3>
      <ul>
        {(product.kitComponents || []).map((line: Item, index: number) => {
          const component = workspace.products.find(
            (p) => p.id === line.productId,
          )
          const recipe = workspace.recipes.find(
            (r) => r.id === component?.recipeId,
          )
          const contentUnit = component?.contentUnit || recipe?.yieldUnit
          let issue = ''
          try {
            if (component) productCosting(component, workspace)
          } catch (error) {
            issue = (error as Error).message
          }
          return (
            <li key={`${line.productId}-${index}`}>
              <span>
                {component ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => openProduct(component)}
                  >
                    {component.name}
                  </button>
                ) : (
                  <strong>Unavailable product · {line.productId}</strong>
                )}
                {component?.archived && <small>Archived product</small>}
                {issue && (
                  <small className="warning-text">
                    {issue} Open product details to review its cost setup.
                  </small>
                )}
              </span>
              <span>
                {line.basis === 'package'
                  ? `${line.quantity} whole selling ${Number(line.quantity) === 1 ? 'package' : 'packages'}`
                  : `${line.quantity} · Unsupported quantity basis (${line.basis || 'not configured'})`}
                {component?.sellingUnit && (
                  <small>Selling unit: {component.sellingUnit}</small>
                )}
                {component?.unitsPerPackage && contentUnit && (
                  <small>
                    {component.unitsPerPackage}{' '}
                    {Number(component.unitsPerPackage) === 1
                      ? singularYield(contentUnit)
                      : contentUnit}{' '}
                    per package
                  </small>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
