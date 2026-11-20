import { useState } from 'react'
import { Download, Plus, PackagePlus } from 'lucide-react'
import { money, type Item, type Workspace } from '@/lib/domain'
import { sortProducts, type ProductSort } from '@/lib/product-list'
import { sectionCategories } from '@/lib/section-categories'
import { ProductCards } from './product-cards'
import { SectionCategoryTools } from './section-categories'
import { CatalogAction, CatalogViewToggle } from './catalog-controls'

export function ModuleProductList({
  workspace,
  workflow,
  open,
  onSettings,
  manage,
}: {
  workspace: Workspace
  workflow: 'handmade' | 'resale'
  open: (kind: string, item?: Item) => void
  onSettings: (patch: Partial<Item>) => void
  manage: boolean
}) {
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [sortField, setSortField] = useState('name')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const [stock, setStock] = useState('all')
  const scope = workflow === 'resale' ? 'resale-products' : 'handmade-products'
  const products = workspace.products.filter((p) => p.workflow === workflow)
  const filtered = products.filter(
    (p) =>
      (!search ||
        `${p.name} ${p.sku || ''} ${p.barcode || ''}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (category === 'all' ||
        (category === 'uncategorized'
          ? !p.productCategoryId
          : p.productCategoryId === category)) &&
      (stock === 'all' ||
        (stock === 'low'
          ? Number(p.quantity) <= Number(p.threshold || 0)
          : !!p.archived)),
  )
  const categories = sectionCategories(workspace, scope)
  const numeric = (value: unknown) =>
    value == null || value === '' || !Number.isFinite(Number(value))
      ? undefined
      : Number(value)
  const rows = ['name', 'price', 'cost', 'profit', 'margin'].includes(sortField)
    ? sortProducts(
        filtered,
        workspace,
        `${sortField}-${direction}` as ProductSort,
      )
    : [...filtered].sort((a, b) => {
        const value = (p: Item): number | string | undefined =>
          sortField === 'category'
            ? categories.find((c) => c.id === p.productCategoryId)?.name
            : sortField === 'quantity'
              ? numeric(p.quantity)
              : p.stockCostKnown &&
                  numeric(p.quantity) !== undefined &&
                  numeric(p.cost) !== undefined
                ? Number(p.quantity) * Number(p.cost)
                : undefined
        const av = value(a),
          bv = value(b)
        if (av === undefined)
          return bv === undefined ? a.name.localeCompare(b.name) : 1
        if (bv === undefined) return -1
        // Quantity groups remain in stable unit order; different units are never compared numerically.
        if (sortField === 'quantity') {
          const unitOrder = String(
            a.sellUnit || a.unit || 'item',
          ).localeCompare(String(b.sellUnit || b.unit || 'item'))
          if (unitOrder) return unitOrder
        }
        return (
          (typeof av === 'string'
            ? av.localeCompare(String(bv))
            : av - Number(bv)) * (direction === 'asc' ? 1 : -1) ||
          a.name.localeCompare(b.name)
        )
      })
  function exportRows() {
    const quote = (v: unknown) =>
      '"' + String(v ?? '').replaceAll('"', '""') + '"'
    const csv = [
      [
        'ID',
        'Name',
        'Category',
        'Quantity',
        'Recorded unit cost',
        'Selling price',
      ],
      ...rows.map((p) => [
        p.id,
        p.name,
        categories.find((c) => c.id === p.productCategoryId)?.name ||
          p.productCategoryId,
        p.quantity,
        p.stockCostKnown ? p.cost : '',
        p.price,
      ]),
    ]
      .map((r) => r.map(quote).join(','))
      .join('\r\n')
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `${workflow}-items.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <>
      <div className="catalog-toolbar">
        <CatalogViewToggle
          view={view}
          onView={setView}
          label={`${workflow} display`}
        />
        {manage && (
          <CatalogAction
            label={`Create ${workflow} item`}
            onClick={() =>
              open(
                workflow === 'resale'
                  ? 'trade-product-resale'
                  : 'trade-product',
              )
            }
          >
            <Plus size={18} />
          </CatalogAction>
        )}
        {manage && workflow === 'resale' && (
          <CatalogAction
            label="Receive resale stock"
            onClick={() => {
              window.location.hash = '#Resale/Receiving'
            }}
          >
            <PackagePlus size={18} />
          </CatalogAction>
        )}
        <label>
          Search
          <input
            aria-label={`Search ${workflow} items`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <SectionCategoryTools
          compact
          workspace={workspace}
          scope={scope}
          canManage={manage}
          onSettings={onSettings}
          value={category}
          onFilter={setCategory}
        />
        <label>
          Stock
          <select
            aria-label="Stock filter"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
          >
            <option value="all">All items</option>
            <option value="low">At / below reorder</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <div className="module-sort-controls">
          <label>
            Sort field
            <select
              aria-label="Sort field"
              value={sortField}
              onChange={(e) => setSortField(e.target.value)}
            >
              {[
                ['name', 'Name'],
                ['category', 'Category'],
                ['quantity', 'Quantity (within unit)'],
                ['cost', 'Estimated unit / acquisition cost'],
                ['value', 'Recorded inventory value'],
                ['price', 'Selling price'],
                ['profit', 'Profit excluding tax'],
                ['margin', 'Margin'],
              ].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Direction
            <select
              aria-label="Sort direction"
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'asc' | 'desc')}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
        </div>
        <CatalogAction label="Export items" onClick={exportRows}>
          <Download size={18} />
        </CatalogAction>
        <span role="status">
          {rows.length} of {products.length} items
        </span>
      </div>
      <ProductCards
        products={rows}
        workspace={workspace}
        view={view}
        open={open}
      />
    </>
  )
}

/** Recorded balances only: estimates must never stand in for actual stock value. */
export function ModuleStockSummary({
  workspace,
  workflow,
}: {
  workspace: Workspace
  workflow: 'handmade' | 'resale'
}) {
  const products = workspace.products.filter((p) => p.workflow === workflow)
  const unknown = products.filter(
    (p) =>
      p.quantity == null ||
      p.quantity === '' ||
      !Number.isFinite(Number(p.quantity)) ||
      (Number(p.quantity) !== 0 &&
        (!p.stockCostKnown ||
          p.cost == null ||
          p.cost === '' ||
          !Number.isFinite(Number(p.cost)))),
  )
  const value = products.reduce(
    (sum, p) =>
      sum +
      (p.stockCostKnown && Number(p.quantity || 0) !== 0
        ? Number(p.quantity) * Number(p.cost)
        : 0),
    0,
  )
  const materials = workspace.ingredients.filter((i) => i.usedAs === 'material')
  const materialUnknown = materials.some(
    (i) =>
      i.quantity == null ||
      i.quantity === '' ||
      !Number.isFinite(Number(i.quantity)) ||
      (Number(i.quantity) !== 0 &&
        (i.needsCostSetup ||
          i.cost == null ||
          i.cost === '' ||
          !Number.isFinite(Number(i.cost)))),
  )
  return (
    <section className="handmade-summary" aria-label={`${workflow} summary`}>
      <div>
        <strong>{products.length}</strong>
        <span>
          {workflow === 'handmade' ? 'Handmade products' : 'Resale items'} ·
          full workspace
        </span>
      </div>
      <div>
        <strong>{unknown.length ? 'Review needed' : money(value)}</strong>
        <span>
          {workflow === 'handmade'
            ? 'Finished stock value'
            : 'Recorded inventory value'}
          {unknown.length ? ` · ${unknown.length} unvalued items` : ''}
        </span>
      </div>
      {workflow === 'handmade' && (
        <div>
          <strong>
            {materialUnknown
              ? 'Review needed'
              : money(
                  materials.reduce(
                    (sum, i) =>
                      sum +
                      (Number(i.quantity || 0) === 0
                        ? 0
                        : Number(i.quantity) * Number(i.cost)),
                    0,
                  ),
                )}
          </strong>
          <span>Materials stock value · excludes shared packaging</span>
        </div>
      )}
      <div>
        <strong>
          {
            (workflow === 'handmade' ? materials : products).filter(
              (i) =>
                i.quantity != null &&
                Number(i.quantity) <= Number(i.threshold || 0),
            ).length
          }
        </strong>
        <span>
          {workflow === 'handmade' ? 'Materials' : 'Items'} at / below reorder
        </span>
      </div>
    </section>
  )
}
