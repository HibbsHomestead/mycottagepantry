import { useState } from 'react'
import type { Item, Workspace } from '@/lib/domain'
import {
  browseProducts,
  defaultProductCriteria,
  productCategoryKey,
  type ProductCriteria,
} from '@/lib/product-browse'
import { productCategoryName } from '@/lib/product-categories'
import {
  productWorkflows,
  tracksFinishedStock,
  workflowOf,
} from '@/lib/product-workflows'
import { ProductCards } from './product-cards'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import './product-browse.css'

export function ProductBrowse({
  products,
  workspace,
  open,
  criteria,
  onCriteria,
}: {
  products: Item[]
  workspace: Workspace
  open: (kind: string, item: Item) => void
  criteria: ProductCriteria
  onCriteria: (c: ProductCriteria) => void
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const c = criteria
  const set = (key: keyof ProductCriteria, value: string) =>
    onCriteria({ ...c, [key]: value })
  const business = workspace.settings[0]
  const rows = browseProducts(products, business, c)
  const categories = new Map(
    products.map((p) => [
      productCategoryKey(p),
      productCategoryKey(p) === 'uncategorized'
        ? 'Uncategorized'
        : productCategoryName(p, business),
    ]),
  )
  for (const category of business.productCategories || []) {
    if (!categories.has(category.id))
      categories.set(
        category.id,
        category.name + (category.active === false ? ' (inactive)' : ''),
      )
  }
  categories.set('uncategorized', 'Uncategorized')
  const types = [...new Set(products.map(workflowOf))]
  const statuses = [
    ...new Set(
      products.map((p) => (p.archived ? 'Archived' : p.status)).filter(Boolean),
    ),
  ] as string[]
  const labels: Partial<Record<keyof ProductCriteria, string>> = {
    search: 'Search',
    category: 'Category',
    type: 'Type',
    status: 'Status',
    min: 'Minimum price',
    max: 'Maximum price',
    image: 'Image',
    stock: 'Tracked stock',
  }
  const active = (Object.keys(labels) as (keyof ProductCriteria)[]).filter(
    (k) => c[k],
  )
  const clear = () =>
    onCriteria({
      ...defaultProductCriteria,
      sort: c.sort,
      direction: c.direction,
    })
  return (
    <section className="product-browse" aria-label="Browse products">
      <div className="product-browse-toolbar">
        <label className="product-browse-search">
          Search products
          <input
            placeholder="Search products…"
            value={c.search}
            onChange={(e) => set('search', e.target.value)}
          />
        </label>
        <label>
          Category
          <select
            value={c.category}
            onChange={(e) => set('category', e.target.value)}
          >
            <option value="">All categories</option>
            {[...categories]
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
          </select>
        </label>
        <button className="btn secondary" onClick={() => setFiltersOpen(true)}>
          Filters
          {active.filter((k) => !['search', 'category'].includes(k)).length
            ? ` (${active.filter((k) => !['search', 'category'].includes(k)).length})`
            : ''}
        </button>
        <label>
          Sort by
          <select value={c.sort} onChange={(e) => set('sort', e.target.value)}>
            <option value="">Default order</option>
            <option value="name">Name</option>
            <option value="category">Category</option>
            <option value="price">Selling price</option>
            {['createdAt', 'updatedAt']
              .filter((key) =>
                products.some((p) => Number.isFinite(Date.parse(p[key]))),
              )
              .map((key) => (
                <option key={key} value={key}>
                  {key === 'createdAt' ? 'Date created' : 'Last updated'}
                </option>
              ))}
          </select>
        </label>
        <label>
          Direction
          <select
            value={c.direction}
            disabled={!c.sort}
            onChange={(e) => set('direction', e.target.value)}
          >
            <option value="asc">
              {c.sort === 'price'
                ? 'Low–high'
                : c.sort.endsWith('At')
                  ? 'Oldest first'
                  : 'A–Z'}
            </option>
            <option value="desc">
              {c.sort === 'price'
                ? 'High–low'
                : c.sort.endsWith('At')
                  ? 'Newest first'
                  : 'Z–A'}
            </option>
          </select>
        </label>
      </div>
      <div className="product-browse-summary" aria-live="polite">
        <strong>
          {rows.length} matching {rows.length === 1 ? 'product' : 'products'}
        </strong>
        {active.map((key) => (
          <button
            className="btn secondary"
            key={key}
            aria-label={`Remove ${labels[key]} filter`}
            onClick={() => set(key, '')}
          >
            {labels[key]}:{' '}
            {key === 'category'
              ? categories.get(c[key])
              : key === 'image'
                ? c[key] === 'has'
                  ? 'Has image'
                  : 'Missing image'
                : key === 'stock'
                  ? c[key] === 'available'
                    ? 'Available'
                    : 'Out of stock (tracked only)'
                  : key === 'type'
                    ? productWorkflows.find((w) => w.value === c[key])?.label ||
                      c[key]
                    : c[key]}{' '}
            ×
          </button>
        ))}
        {active.length > 0 && (
          <button className="btn secondary" onClick={clear}>
            Clear filters
          </button>
        )}
      </div>
      {c.sort === 'price' && (
        <p className="muted">
          USD selling price per product’s displayed selling unit; unit sizes may differ. Missing prices
          appear last.
        </p>
      )}
      {rows.length ? (
        <ProductCards products={rows} workspace={workspace} open={open} />
      ) : (
        <div className="panel">
          <h3>No matching products</h3>
          <p>Try a different search or clear the filters.</p>
          <button className="btn secondary" onClick={clear}>
            Clear filters
          </button>
        </div>
      )}
      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Product filters</DialogTitle>
            <DialogDescription>
              Combine filters to find products. Records and availability stay
              unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="product-browse-fields">
            <label>
              Product type
              <select
                value={c.type}
                onChange={(e) => set('type', e.target.value)}
              >
                <option value="">All types</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {productWorkflows.find((w) => w.value === t)?.label ||
                      (t === 'kit' ? 'Kit' : 'Unclassified')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Product status
              <select
                value={c.status}
                onChange={(e) => set('status', e.target.value)}
              >
                <option value="">All statuses</option>
                {statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Minimum selling price
              <input
                type="number"
                min="0"
                step="any"
                value={c.min}
                onChange={(e) => set('min', e.target.value)}
              />
            </label>
            <label>
              Maximum selling price
              <input
                type="number"
                min="0"
                step="any"
                value={c.max}
                onChange={(e) => set('max', e.target.value)}
              />
            </label>
            <label>
              Product image
              <select
                value={c.image}
                onChange={(e) => set('image', e.target.value)}
              >
                <option value="">Any image</option>
                <option value="has">Has image</option>
                <option value="missing">Missing image</option>
              </select>
            </label>
            {products.some(
              (p) =>
                tracksFinishedStock(p) &&
                p.trackInventory !== false &&
                p.quantity != null,
            ) && (
              <label>
                Tracked sellable stock
                <select
                  value={c.stock}
                  onChange={(e) => set('stock', e.target.value)}
                >
                  <option value="">All products</option>
                  <option value="available">Available</option>
                  <option value="empty">Out of stock (tracked only)</option>
                </select>
              </label>
            )}
            <button className="btn" onClick={() => setFiltersOpen(false)}>
              Show {rows.length} products
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
