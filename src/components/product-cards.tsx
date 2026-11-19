import { ActionTip } from './action-tip'
import { workflowOf } from '@/lib/product-workflows'
import { inventoryQuantity } from '@/lib/inventory-quantity'
import { handmadeEstimate } from '../lib/handmade'
import { stockUnitLabel } from '@/lib/resale-stock'
import { productCategoryName } from '@/lib/product-categories'
import { stockStatus } from '@/lib/ingredients'
import { MoreHorizontal } from 'lucide-react'
import {
  money,
  packagingLines,
  productCosting,
  profitability,
  type Item,
  type Workspace,
} from '@/lib/domain'
import { singularYield } from '@/lib/product-recipe-links'
import { PantryPhoto } from './pantry-photo'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu'
import './product-cards.css'
import { KitProductList } from './kit-included-products'

// Presentation guard: missing source prices must not look like a zero-cost product.
// All amounts still come from the existing costing and profitability functions.
function cardCost(product: Item, workspace: Workspace) {
  if (['resale', 'kit'].includes(product.workflow)) {
    try {
      return { cost: productCosting(product, workspace).perPackage }
    } catch (error) {
      return {
        reason:
          product.workflow === 'kit'
            ? (error as Error).message
            : 'Receive resale stock to establish its cost.',
      }
    }
  }
  if (product.workflow === 'handmade') {
    try {
      return { cost: handmadeEstimate(product, workspace).unit }
    } catch (error) {
      return { reason: (error as Error).message }
    }
  }
  const recipe = workspace.recipes.find((r) => r.id === product.recipeId)
  if (!recipe?.lines?.length || product.needsCostSetup)
    return { reason: 'Connect a recipe with ingredient cost details.' }
  const sources = [...recipe.lines, ...packagingLines(product)]
  if (
    sources.some((line) => {
      const item = workspace.ingredients.find((i) => i.id === line.ingredientId)
      const price = item?.currentCost ?? item?.cost
      return (
        !item ||
        item.needsCostSetup ||
        price == null ||
        String(price).trim() === '' ||
        !Number.isFinite(Number(price)) ||
        Number(price) < 0
      )
    })
  )
    return { reason: 'Review ingredient and packaging cost details.' }
  try {
    const cost = productCosting(product, workspace).perPackage
    return Number.isFinite(cost)
      ? { cost }
      : { reason: 'Review recipe quantities and cost details.' }
  } catch (error) {
    return {
      reason:
        error instanceof Error ? error.message : 'Review recipe cost details.',
    }
  }
}

export function ProductCards({
  products,
  workspace,
  open,
  view = 'cards',
}: {
  view?: 'cards' | 'table'
  products: Item[]
  workspace: Workspace
  open: (kind: string, product: Item) => void
}) {
  if (view === 'table')
    return (
      <ProductTable products={products} workspace={workspace} open={open} />
    )
  return (
    <div
      className="pantry-card-grid product-photo-grid"
      aria-label="Product cards"
    >
      {products.map((product) => {
        const recipe = workspace.recipes.find((r) => r.id === product.recipeId)
        const sellingUnit =
          String(
            product.sellingUnit || (product.workflow === 'kit' ? 'kit' : ''),
          ).trim() ||
          (['handmade', 'resale'].includes(product.workflow)
            ? 'item'
            : 'package')
        const { cost, reason } = cardCost(product, workspace)
        const price =
          product.price == null || String(product.price).trim() === ''
            ? NaN
            : Number(product.price)
        let pricing: ReturnType<typeof profitability> | undefined
        if (cost !== undefined && Number.isFinite(price) && price >= 0) {
          try {
            pricing = profitability(product, cost, workspace.settings[0])
          } catch {
            /* The existing pricing editor explains invalid tax/target settings. */
          }
        }
        const belowTarget =
          pricing && pricing.margin < Number(product.targetMargin ?? 65)
        const status = product.archived
          ? 'Archived'
          : product.workflow === 'kit'
            ? `Kit · ${product.status}`
            : product.status
        const stock = ['handmade', 'resale'].includes(product.workflow)
          ? stockStatus(product)
          : undefined
        return (
          <article
            className="panel pantry-card product-card product-card-photo-first"
            key={product.id}
            aria-label={product.name}
          >
            <div className="pantry-card-top">
              <span
                className={`status ${cost === undefined || !pricing || belowTarget ? 'amber' : 'green'}`}
              >
                {cost === undefined
                  ? 'Cost incomplete'
                  : !pricing
                    ? 'Pricing incomplete'
                    : belowTarget
                      ? 'Review margin'
                      : 'Costed'}
              </span>
              {(stock === 'Low stock' || stock === 'Out of stock') && (
                <span
                  className={`status ${stock === 'Out of stock' ? 'pink' : 'amber'}`}
                >
                  {stock}
                </span>
              )}
              <ProductRecordActions product={product} open={open} />
            </div>
            {(product.workflow !== 'kit' || product.imageAssetId) && (
              <button
                className="pantry-card-photo-button"
                aria-label={`View photo and details for ${product.name}`}
                onClick={() => open('product-detail', product)}
              >
                <PantryPhoto
                  item={product}
                  assets={workspace.graphic_assets || []}
                  kind="product"
                  presentation="product-card"
                />
              </button>
            )}
            <div className="pantry-card-main">
              <button
                className="pantry-card-title"
                onClick={() => open('product-detail', product)}
              >
                {product.name}
              </button>
              {(product.category || product.productCategoryId || status) && (
                <p className="muted">
                  {[productCategoryName(product, workspace.settings[0]), status]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              <dl>
                <dt>Selling price</dt>
                <dd>
                  {Number.isFinite(price) && price >= 0
                    ? money(price)
                    : 'Price not set'}{' '}
                  / {sellingUnit}
                </dd>
                {recipe?.yieldUnit && (
                  <>
                    <dt>Contents per {sellingUnit}</dt>
                    <dd>
                      {product.unitsPerPackage ?? 1}{' '}
                      {Number(product.unitsPerPackage ?? 1) === 1
                        ? singularYield(recipe.yieldUnit)
                        : recipe.yieldUnit}
                    </dd>
                  </>
                )}
                <dt>
                  {product.workflow === 'handmade'
                    ? 'Estimated cost'
                    : product.workflow === 'resale'
                      ? 'Average stock cost'
                      : 'Cost'}{' '}
                  per {sellingUnit}
                </dt>
                <dd>{cost === undefined ? 'Incomplete' : money(cost)}</dd>
                <dt>Profit excluding tax</dt>
                <dd>{pricing ? money(pricing.profit) : 'Unavailable'}</dd>
                <dt>Margin</dt>
                <dd>
                  {pricing ? `${pricing.margin.toFixed(1)}%` : 'Unavailable'}
                </dd>
              </dl>
              {reason &&
                (product.workflow === 'handmade' ? (
                  <details className="table-note">
                    <summary>
                      {!product.bom
                        ? 'Legacy BOM needs review.'
                        : 'Cost incomplete · review details'}
                    </summary>
                    <p>{reason}</p>
                  </details>
                ) : (
                  <p className="muted">{reason}</p>
                ))}
              {product.workflow === 'handmade' && !product.bom && !reason && (
                <p className="muted">Legacy BOM needs review.</p>
              )}
              {product.workflow === 'handmade' &&
                !pricing &&
                cost !== undefined && (
                  <p className="muted">
                    {!Number.isFinite(price)
                      ? 'Add a selling price to calculate margin.'
                      : 'Configure category tax treatment to calculate margin.'}
                  </p>
                )}
              {product.workflow === 'kit' && (
                <KitProductList
                  product={product}
                  workspace={workspace}
                  openProduct={(component) => open('product-detail', component)}
                />
              )}

              {recipe && (
                <p className="muted">
                  {product.workflow === 'handmade' ? 'Design' : 'Recipe'}:{' '}
                  {recipe.name}
                </p>
              )}
              {(product.workflow !== 'kit' || product.variant || product.sku) &&
                product.workflow && (
                  <p className="muted">
                    {product.workflow !== 'kit' && product.workflow}{' '}
                    {product.variant && `· ${product.variant}`}{' '}
                    {product.sku && `· ${product.sku}`}
                  </p>
                )}
              {['handmade', 'resale'].includes(product.workflow) && (
                <p>
                  {inventoryQuantity(product.quantity)}{' '}
                  {product.workflow === 'resale'
                    ? stockUnitLabel(product, Number(product.quantity || 0))
                    : 'items'}{' '}
                  on hand ·{' '}
                  {product.stockCostKnown
                    ? money(product.cost) + ' average stock cost'
                    : product.workflow === 'handmade'
                      ? 'Inventory valuation needs review'
                      : 'Awaiting receipt / production'}
                </p>
              )}
            </div>
            <footer>
              <button
                className="btn secondary"
                onClick={() => open('product-detail', product)}
              >
                View details
              </button>
              <button
                className="btn secondary"
                onClick={() => open('product', product)}
              >
                {product.workflow === 'kit' ? 'Edit kit' : 'Edit Product'}
              </button>
            </footer>
          </article>
        )
      })}
      {!products.length && (
        <div className="calm-empty">
          <h3>No products match this view.</h3>
          <p>Try another search or create a product.</p>
        </div>
      )}
    </div>
  )
}

function ProductRecordActions({
  product,
  open,
}: {
  product: Item
  open: (kind: string, product: Item) => void
}) {
  return (
    <DropdownMenu>
      <ActionTip label={`Actions for ${product.name}`}>
        <DropdownMenuTrigger asChild>
          <button
            className="icon-button"
            aria-label={`Actions for ${product.name}`}
          >
            <MoreHorizontal size={20} />
          </button>
        </DropdownMenuTrigger>
      </ActionTip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => open('product-detail', product)}>
          View details
        </DropdownMenuItem>
        {product.workflow !== 'kit' && (
          <DropdownMenuItem onSelect={() => open('label-preview', product)}>
            Preview Label
          </DropdownMenuItem>
        )}
        {product.workflow !== 'kit' && (
          <DropdownMenuItem onSelect={() => open('label-print', product)}>
            Print Label
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => open('product', product)}>
          {product.workflow === 'kit' ? 'Edit kit' : 'Edit Product'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProductTable({
  products,
  workspace,
  open,
}: {
  products: Item[]
  workspace: Workspace
  open: (kind: string, product: Item) => void
}) {
  return (
    <div
      className="catalog-table-region"
      role="region"
      aria-label="Products table"
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            {[
              'Product name',
              'Product type',
              'Category',
              'Price',
              'Cost',
              'Profit excluding tax / margin',
              'Actions',
            ].map((label) => (
              <th scope="col" key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const { cost } = cardCost(product, workspace)
            const price =
              product.price == null || String(product.price).trim() === ''
                ? NaN
                : Number(product.price)
            let pricing: ReturnType<typeof profitability> | undefined
            if (cost !== undefined && Number.isFinite(price) && price >= 0) {
              try {
                pricing = profitability(product, cost, workspace.settings[0])
              } catch {
                /* Same incomplete pricing state as cards. */
              }
            }
            return (
              <tr key={product.id}>
                <td>
                  <button
                    className="text-button"
                    onClick={() => open('product-detail', product)}
                  >
                    {product.name}
                  </button>
                </td>
                <td>{workflowOf(product)}</td>
                <td>
                  {productCategoryName(product, workspace.settings[0]) ||
                    'Uncategorized'}
                </td>
                <td>{Number.isFinite(price) ? money(price) : 'Unavailable'}</td>
                <td>{cost === undefined ? 'Incomplete' : money(cost)}</td>
                <td>
                  {pricing ? (
                    <>
                      {money(pricing.profit)}
                      <small>{pricing.margin.toFixed(1)}%</small>
                    </>
                  ) : (
                    'Unavailable'
                  )}
                </td>
                <td>
                  <ProductRecordActions product={product} open={open} />
                </td>
              </tr>
            )
          })}
          {!products.length && (
            <tr>
              <td colSpan={7}>No products match this view.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
