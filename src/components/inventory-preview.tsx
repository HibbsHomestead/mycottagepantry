import { useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  LayoutGrid,
  List,
  Plus,
  Search,
} from 'lucide-react'
import { money, type Item, type Workspace } from '@/lib/domain'
import { isFabric } from '@/lib/fabric'
import {
  inventoryEntries,
  inventoryTypes,
  inventoryTypeLabel,
  inventoryLocation,
  inventoryStatus,
  onHandText,
  packageText,
  entryAction,
  type InventoryEntry,
} from '@/lib/inventory-browse'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { PantryPhoto } from './pantry-photo'
import { editActionLabel } from '@/lib/item-actions'
import { inventoryMovementView } from '@/lib/inventory-adjustment'
import './inventory-preview.css'

/** Opt-in design review: browsing never changes records or saves device-local inventory. */
export function InventoryPreview({
  workspace: w,
  role,
  open,
  close,
  initialKey = null,
}: {
  workspace: Workspace
  role: string
  open: (kind: string, item?: Item) => void
  close: () => void
  initialKey?: string | null
}) {
  const [search, setSearch] = useState(''),
    [type, setType] = useState(''),
    [category, setCategory] = useState(''),
    [location, setLocation] = useState(''),
    [status, setStatus] = useState(''),
    [sort, setSort] = useState('name'),
    [view, setView] = useState<'cards' | 'table'>('cards'),
    [selected, setSelected] = useState(initialKey)
  const body = useRef<HTMLDivElement>(null),
    entries = inventoryEntries(w),
    item = entries.find((e) => e.key === selected)
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = 0
  }, [selected])
  const categories = [
      ...new Set(entries.map((e) => e.item.category).filter(Boolean)),
    ].sort(),
    locations = [
      ...new Set(entries.map((e) => inventoryLocation(e.item)).filter(Boolean)),
    ].sort()
  const canEdit = ['Owner', 'Manager'].includes(role),
    canStock = canEdit || role === 'Production Staff'
  const rows = entries
    .filter((e) => {
      const i = e.item,
        s = inventoryStatus(i)
      return (
        (!type || e.type === type) &&
        (!category || i.category === category) &&
        (!location || inventoryLocation(i) === location) &&
        (!status ||
          (status === 'low'
            ? ['Low stock', 'Out of stock'].includes(s)
            : s === status)) &&
        [
          i.name,
          i.brand,
          i.barcode,
          i.sku,
          i.variant,
          i.category,
          inventoryLocation(i),
        ].some((v) =>
          String(v || '')
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
      )
    })
    .sort((a, b) =>
      sort === 'expiry'
        ? String(a.item.expires || '9999').localeCompare(
            String(b.item.expires || '9999'),
          ) || a.item.name.localeCompare(b.item.name)
        : sort === 'type'
          ? a.type.localeCompare(b.type) ||
            a.item.name.localeCompare(b.item.name)
          : (sort === 'name-desc' ? -1 : 1) *
            a.item.name.localeCompare(b.item.name),
    )
  function act(e: InventoryEntry, action: 'edit' | 'receive' | 'adjust') {
    close()
    open(
      entryAction(e, action),
      action === 'receive'
        ? {
            ...e.item,
            quantity: '',
            price: '',
            unit: e.item.purchaseUnit || e.item.unit,
            operationId: crypto.randomUUID(),
          }
        : action === 'adjust'
          ? { ...e.item, quantity: '', reason: '' }
          : e.item,
    )
  }
  const badge = (i: Item) => (
    <span
      className={`inventory-state ${['Low stock', 'Out of stock', 'Expired', 'Expiring soon'].includes(inventoryStatus(i)) ? 'attention' : ''}`}
    >
      {inventoryStatus(i)}
    </span>
  )
  const movements = item
    ? w.ledger.filter((l) =>
        item.table === 'products'
          ? l.productId === item.item.id
          : l.ingredientId === item.item.id,
      )
    : []
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) close()
      }}
    >
      <DialogContent className="inventory-preview" presentation="detail">
        <header className="inventory-preview-header">
          {item && (
            <button className="btn secondary" onClick={() => setSelected(null)}>
              <ArrowLeft size={16} /> All items
            </button>
          )}
          <span className="inventory-preview-kicker">
            MY OVEN · DESIGN PREVIEW
          </span>
          <DialogTitle>
            {item ? item.item.name : 'Your inventory, at a glance'}
          </DialogTitle>
          <DialogDescription>
            {item
              ? 'Existing Oven record. Stock actions open the established review forms.'
              : 'Preview the photo layout with your existing records. Browsing leaves quantities and costs unchanged.'}
          </DialogDescription>
        </header>
        <div className="inventory-preview-body" ref={body}>
          {item ? (
            <>
              <div className="inventory-detail-lead">
                <PantryPhoto
                  item={item.item}
                  assets={w.graphic_assets}
                  kind={item.table === 'products' ? 'product' : 'pantry'}
                />
                <div>
                  <p className="inventory-preview-kicker">
                    {inventoryTypeLabel(item.type)}
                  </p>
                  <h2>{item.item.name}</h2>
                  <p>
                    {[item.item.brand, item.item.variant]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {badge(item.item)}
                  <p className="inventory-detail-quantity">
                    {onHandText(item.item)}
                  </p>
                  {packageText(item.item) && (
                    <p>Package size: {packageText(item.item)}</p>
                  )}
                  {isFabric(item.item) && (
                    <p>
                      {item.item.fabricWidth} {item.item.widthUnit} wide ·{' '}
                      {item.item.fiber || 'Composition not recorded'}
                    </p>
                  )}
                  <div className="button-row">
                    {canEdit && (
                      <button
                        className="btn secondary"
                        onClick={() => act(item, 'edit')}
                      >
                        {editActionLabel(item.item, item.table)}{' '}
                        <ArrowUpRight size={16} />
                      </button>
                    )}
                    {canStock && !item.item.compoundRecipeId && (
                      <button
                        className="btn"
                        onClick={() => act(item, 'receive')}
                      >
                        <Plus size={16} /> Receive stock
                      </button>
                    )}
                    {canStock && (
                      <button
                        className="btn secondary"
                        onClick={() => act(item, 'adjust')}
                      >
                        Adjust / record waste
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="inventory-detail-sections">
                <details>
                  <summary>Purchasing &amp; Cost</summary>
                  <p>
                    Recorded unit cost:{' '}
                    {item.item.cost == null ||
                    item.item.needsCostSetup ||
                    (item.table === 'products' && !item.item.stockCostKnown)
                      ? 'Not established'
                      : `${money(item.item.cost)} / ${item.item.unit || 'each'}`}
                  </p>
                  <p>
                    {packageText(item.item) || 'Package size not recorded.'}
                  </p>
                  <p>
                    Actual purchase cost is confirmed when receiving. Past
                    movements keep their recorded costs.
                  </p>
                </details>
                <details>
                  <summary>Category &amp; Storage</summary>
                  <p>Type: {inventoryTypeLabel(item.type)}</p>
                  <p>Category: {item.item.category || 'Not assigned'}</p>
                  <p>
                    Storage: {inventoryLocation(item.item) || 'Not assigned'}
                  </p>
                  <p>
                    {item.item.expires
                      ? `Recorded expiry: ${item.item.expires}`
                      : 'Expiry not recorded. No lot expiry is inferred.'}
                  </p>
                </details>
                <details>
                  <summary>Stock History</summary>
                  {movements.length ? (
                    movements.map(inventoryMovementView).map((l) => (
                      <p key={l.id}>
                        {l.date} · {l.type} · {l.quantity}{' '}
                        {l.unit || item.item.unit || 'each'} ·{' '}
                        {l.resultingInventoryQuantity != null &&
                          l.inventoryUnit && (
                            <>
                              Balance: {l.resultingInventoryQuantity}{' '}
                              {l.inventoryUnit} ·{' '}
                            </>
                          )}
                        {l.reason || l.sourceId || 'No additional note'}
                      </p>
                    ))
                  ) : (
                    <p>No stock movements recorded.</p>
                  )}
                </details>
                <details>
                  <summary>Supplier &amp; Product URL</summary>
                  <p>
                    {item.item.vendor ||
                      w.vendors.find((v) => v.id === item.item.supplierId)
                        ?.name ||
                      'Supplier not assigned'}
                  </p>
                  {/^https?:\/\//.test(
                    item.item.productSourceUrl || item.item.productUrl || '',
                  ) ? (
                    <a
                      href={item.item.productSourceUrl || item.item.productUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open product source <ArrowUpRight size={14} />
                    </a>
                  ) : (
                    <p>Product URL not recorded.</p>
                  )}
                  <p>Barcode: {item.item.barcode || 'Not recorded'}</p>
                  <p>SKU: {item.item.sku || 'Not recorded'}</p>
                </details>
                <details>
                  <summary>
                    {item.type === 'ingredient'
                      ? 'Ingredient statement, allergens & conversions'
                      : isFabric(item.item)
                        ? 'Fabric, pieces & remnants'
                        : item.type === 'resale'
                          ? 'Variant & selling price'
                          : 'Item specifications'}
                  </summary>
                  {item.type === 'ingredient' ? (
                    <>
                      <p>
                        {item.item.subingredients ||
                          item.item.statement ||
                          'Ingredient statement not recorded.'}
                      </p>
                      <p>
                        Recorded allergens:{' '}
                        {[
                          ...new Set([
                            ...(item.item.allergens || []),
                            ...(item.item.componentAllergens || []),
                          ]),
                        ].join(', ') || 'Not recorded; review the package.'}
                      </p>
                      <p>
                        {item.item.reviewed
                          ? 'Marked reviewed'
                          : 'Ingredient and allergen review required'}
                      </p>
                      {(item.item.conversions || []).map(
                        (c: Item, n: number) => (
                          <p key={n}>
                            {c.amountFrom} {c.from} = {c.amountTo} {c.to} ·{' '}
                            {c.verified ? 'Verified' : 'Needs review'}
                          </p>
                        ),
                      )}
                    </>
                  ) : isFabric(item.item) ? (
                    <>
                      <p>
                        Width: {item.item.fabricWidth} {item.item.widthUnit}
                      </p>
                      <p>Composition: {item.item.fiber || 'Not recorded'}</p>
                      <p>
                        {[
                          item.item.color,
                          item.item.pattern,
                          item.item.collection,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p>
                        {item.item.pieceMode === 'separate'
                          ? `Separate piece: ${item.item.pieceId || 'Not recorded'}`
                          : 'Aggregate length; continuous cut length is not guaranteed.'}
                      </p>
                    </>
                  ) : (
                    <>
                      <p>Variant: {item.item.variant || 'Not recorded'}</p>
                      <p>
                        {item.item.notes ||
                          item.item.dimensions ||
                          'No additional specifications.'}
                      </p>
                      {item.type === 'resale' && (
                        <p>
                          Selling price:{' '}
                          {item.item.price == null
                            ? 'Not set'
                            : money(item.item.price)}{' '}
                          / each
                        </p>
                      )}
                    </>
                  )}
                </details>
              </div>
            </>
          ) : (
            <>
              <div className="inventory-preview-controls">
                <label className="inventory-preview-search">
                  <Search size={18} />
                  <span className="sr-only">Search inventory preview</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, barcode, variant…"
                  />
                </label>
                <div
                  className="pantry-view-toggle"
                  role="group"
                  aria-label="Preview display"
                >
                  <button
                    aria-pressed={view === 'cards'}
                    onClick={() => setView('cards')}
                  >
                    <LayoutGrid size={16} /> Cards
                  </button>
                  <button
                    aria-pressed={view === 'table'}
                    onClick={() => setView('table')}
                  >
                    <List size={16} /> Table
                  </button>
                </div>
              </div>
              <details className="inventory-preview-filters">
                <summary>
                  Filters &amp; sort <span>{rows.length} items</span>
                </summary>
                <div>
                  <label>
                    Item type
                    <select
                      aria-label="Item type"
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                    >
                      <option value="">All types</option>
                      {inventoryTypes.map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Category
                    <select
                      aria-label="Category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="">All categories</option>
                      {categories.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Storage location
                    <select
                      aria-label="Storage location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    >
                      <option value="">All locations</option>
                      {locations.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Stock status
                    <select
                      aria-label="Stock status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="">All stock</option>
                      <option value="low">Low / out of stock</option>
                      <option>Expiring soon</option>
                      <option>Expired</option>
                    </select>
                  </label>
                  <label>
                    Sort
                    <select
                      aria-label="Sort"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="name">Name A–Z</option>
                      <option value="name-desc">Name Z–A</option>
                      <option value="type">Item type</option>
                      <option value="expiry">Recorded expiry, soonest</option>
                    </select>
                  </label>
                </div>
              </details>
              {view === 'cards' ? (
                <div className="inventory-photo-grid">
                  {rows.map((e) => (
                    <article className="inventory-photo-card" key={e.key}>
                      <button
                        className="inventory-card-open"
                        aria-label={`View ${e.item.name}`}
                        onClick={() => setSelected(e.key)}
                      >
                        <PantryPhoto
                          item={e.item}
                          assets={w.graphic_assets}
                          kind={e.table === 'products' ? 'product' : 'pantry'}
                        />
                        <span className="inventory-card-copy">
                          <small>{inventoryTypeLabel(e.type)}</small>
                          <strong>{e.item.name}</strong>
                          <span className="inventory-card-quantity">
                            {onHandText(e.item)}
                          </span>
                          {packageText(e.item) && (
                            <span className="inventory-card-package">
                              {packageText(e.item)}
                            </span>
                          )}
                          {isFabric(e.item) && (
                            <span>
                              {e.item.fabricWidth} {e.item.widthUnit} wide
                            </span>
                          )}
                          {e.item.variant && <small>{e.item.variant}</small>}
                          {badge(e.item)}
                          {inventoryLocation(e.item) && (
                            <small>{inventoryLocation(e.item)}</small>
                          )}
                        </span>
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="inventory-preview-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>On hand</th>
                        <th>Package size</th>
                        <th>Location</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((e) => (
                        <tr key={e.key}>
                          <td>
                            <button
                              aria-label={`View ${e.item.name}`}
                              onClick={() => setSelected(e.key)}
                            >
                              <PantryPhoto
                                item={e.item}
                                assets={w.graphic_assets}
                              />
                              {e.item.name}
                            </button>
                          </td>
                          <td>{onHandText(e.item)}</td>
                          <td>{packageText(e.item) || 'Not recorded'}</td>
                          <td>{inventoryLocation(e.item) || 'Not assigned'}</td>
                          <td>{badge(e.item)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!rows.length && <p>No items match these filters.</p>}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
