import { barcodeMatches } from '@/lib/barcodes'
import { PantryPhoto } from './pantry-photo'
import { precise, stockStatus } from '@/lib/ingredients'
import { useState, useEffect } from 'react'
import {
  sortIngredients,
  validPantrySort,
  type PantrySort,
} from '@/lib/ingredients'
import {
  Package,
  TriangleAlert,
  Clock3,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  ArrowRight,
} from 'lucide-react'
import { convert, money, type Item } from '@/lib/domain'
import { isFabric, supportsExpiry } from '@/lib/fabric'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu'
import { editActionLabel } from '@/lib/item-actions'
const stockTone = (status: string) =>
  ['Expired', 'Out of stock'].includes(status)
    ? 'pink'
    : ['Low stock', 'Expiring soon'].includes(status)
      ? 'amber'
      : status === 'Not tracked'
        ? 'neutral'
        : 'green'
const tabs = [
  'All items',
  'Ingredients',
  'Packaging',
  'Supplies',
  'Craft materials',
  'Low stock',
  'Expiring soon',
]
export function PantryInventory({
  ingredients,
  filter,
  setFilter,
  search,
  setSearch,
  open,
  savedSort,
  onSort,
  assets = [],
  savedView,
  onView,
  typeFilter,
}: {
  typeFilter?: string
  assets?: Item[]
  savedView?: 'cards' | 'table'
  onView?: (view: 'cards' | 'table') => void
  savedSort?: PantrySort
  onSort?: (sort: PantrySort) => void
  ingredients: Item[]
  filter: string
  setFilter: (filter: string) => void
  search: string
  setSearch: (search: string) => void
  open: (kind: string, item?: Item) => void
}) {
  const [view, setView] = useState<'cards' | 'table'>(
    savedView === 'table' ? 'table' : 'cards',
  )
  useEffect(() => {
    if (savedView) setView(savedView)
  }, [savedView])
  const [sort, setSort] = useState<PantrySort>(validPantrySort(savedSort))
  useEffect(() => {
    if (savedSort) setSort(validPantrySort(savedSort))
  }, [savedSort?.key, savedSort?.direction])
  function chooseSort(next: PantrySort) {
    setSort(next)
    onSort?.(next)
  }
  const columns = [
    ['name', 'Item'],
    ['category', 'Category'],
    ['quantity', 'On hand'],
    ['currentCost', 'Current unit cost'],
    ['value', 'Inventory value'],
    ['status', 'Status'],
    ['threshold', 'Reorder point'],
    ['vendor', 'Preferred vendor'],
  ] as const
  const today = new Date().toISOString().slice(0, 10),
    next = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const low = ingredients.filter(
      (i) => i.trackInventory !== false && i.quantity <= i.threshold,
    ),
    expiring = ingredients.filter(
      (i) =>
        supportsExpiry(i) &&
        i.expires &&
        i.expires >= today &&
        i.expires <= next,
    )
  let exactBarcodeItems = new Set<string>()
  if (search.trim()) {
    try {
      exactBarcodeItems = new Set(
        barcodeMatches(ingredients, search).map((m) => m.item.id),
      )
    } catch {
      /* Ordinary search remains available for any text. */
    }
  }
  const filtered = ingredients
    .filter(
      (i) =>
        [
          i.name,
          i.brand,
          i.category,
          i.vendor,
          i.barcode,
          i.sku,
          i.color,
          i.pattern,
          i.collection,
          i.pieceId,
          i.storageLocation,
          ...(i.purchaseOffers || []).map((o: any) => o.barcode),
        ].some((v) =>
          String(v || '')
            .toLowerCase()
            .includes(search.toLowerCase()),
        ) || exactBarcodeItems.has(i.id),
    )
    .filter((i) =>
      filter === 'Low stock'
        ? low.includes(i)
        : filter === 'Expiring soon'
          ? expiring.includes(i)
          : filter === 'Expired'
            ? supportsExpiry(i) && i.expires && i.expires < today
            : filter === 'Craft materials'
              ? i.usedAs === 'material'
              : filter === 'Ingredients'
                ? i.usedAs === 'ingredient'
                : filter === 'Packaging'
                  ? i.usedAs === 'packaging'
                  : filter === 'Supplies'
                    ? i.usedAs === 'supply'
                    : true,
    )
  const rows = sortIngredients(filtered, sort)
  return (
    <div className="pantry-v2">
      <div className="pantry-summary">
        <span>
          <Package size={21} />
          <span>
            Pantry value
            <strong>
              {money(ingredients.reduce((s, i) => s + i.quantity * i.cost, 0))}
            </strong>
          </span>
        </span>
        <span>
          <TriangleAlert size={21} />
          <span>
            Low stock<strong>{low.length} items</strong>
          </span>
        </span>
        <span>
          <Clock3 size={21} />
          <span>
            Expiring soon<strong>{expiring.length} items</strong>
          </span>
        </span>
      </div>
      <div className="inventory-tabs" aria-label="Pantry views">
        {(typeFilter === undefined
          ? tabs
          : ['All items', 'Low stock', 'Expiring soon']
        ).map((t) => (
          <button
            key={t}
            aria-pressed={
              filter === t || (t === 'All items' && filter === typeFilter)
            }
            className={
              filter === t || (t === 'All items' && filter === typeFilter)
                ? 'active'
                : ''
            }
            onClick={() =>
              setFilter(t === 'All items' && typeFilter ? typeFilter : t)
            }
          >
            {t}
            {t === 'Low stock' && low.length > 0 && <span>{low.length}</span>}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <div
          className="pantry-view-toggle"
          role="group"
          aria-label="Pantry display"
        >
          {(['cards', 'table'] as const).map((v) => (
            <button
              key={v}
              aria-pressed={view === v}
              onClick={() => {
                setView(v)
                onView?.(v)
              }}
            >
              {v === 'cards' ? 'Cards' : 'Table'}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={18} />
          <span className="sr-only">Search pantry</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your pantry…"
          />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="btn secondary">
              <SlidersHorizontal size={17} />
              Filter
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="workspace-menu">
            {[...tabs, 'Expired'].map((t) => (
              <DropdownMenuItem key={t} onSelect={() => setFilter(t)}>
                {t}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <label className="pantry-sort">
          Sort by
          <select
            aria-label="Sort by"
            value={sort.key}
            onChange={(e) =>
              chooseSort({ ...sort, key: e.target.value as PantrySort['key'] })
            }
          >
            {columns.map(([key, label]) => (
              <option key={key} value={key}>
                {key === 'name' ? 'Name' : label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn secondary"
          aria-label="Reverse sort direction"
          onClick={() =>
            chooseSort({
              ...sort,
              direction: sort.direction === 'asc' ? 'desc' : 'asc',
            })
          }
        >
          {sort.direction === 'asc' ? '↑ Ascending' : '↓ Descending'}
        </button>
        <span className="muted item-count">{rows.length} items</span>
      </div>
      <p className="muted table-note">
        Quantity, cost and reorder sorts group weight, volume, length and count;
        compatible units normalize to g, ml or each. Missing values appear last.
      </p>
      {view === 'cards' ? (
        <div className="pantry-card-grid" aria-label="Pantry cards">
          {rows.map((i) => {
            const unit = i.storageUnit || i.unit
            const converted = (n: number) =>
              precise(convert(n, i.unit, unit, i.conversions))
            const cost =
              convert(1, unit, i.unit, i.conversions) *
              (i.currentCost ?? i.cost)
            const status = stockStatus(i)
            return (
              <article
                className="panel pantry-card"
                key={i.id}
                aria-label={i.name}
              >
                <div className="pantry-card-top">
                  <span className={`status ${stockTone(status)}`}>
                    {status}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="icon-button"
                        aria-label={`Actions for ${i.name}`}
                      >
                        <MoreHorizontal size={20} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => open('shelf-label', i)}>
                        Print shelf/bin label
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          open('receive', {
                            ...i,
                            quantity: i.purchaseQuantity || 1,
                            unit: i.purchaseUnit || i.unit,
                            price: i.packagePrice || 0,
                          })
                        }
                      >
                        Receive stock
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => open('adjust', { ...i, quantity: -1 })}
                      >
                        Adjust / record waste
                      </DropdownMenuItem>
                      {isFabric(i) && i.fabricTracking === 'length' && (
                        <DropdownMenuItem
                          onSelect={() => open('fabric-remnant', i)}
                        >
                          Transfer usable remnant
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <button
                  className="pantry-card-photo-button"
                  aria-label={`View photo and details for ${i.name}`}
                  onClick={() => open('ingredient-detail', i)}
                >
                  <PantryPhoto item={i} assets={assets} />
                </button>
                <div className="pantry-card-main">
                  <button
                    className="pantry-card-title"
                    onClick={() => open('ingredient-detail', i)}
                  >
                    {i.name}
                  </button>
                  <p className="muted">
                    {[i.brand, i.category].filter(Boolean).join(' · ')}
                  </p>
                  <dl>
                    <dt>On hand</dt>
                    <dd>
                      {converted(i.quantity)} {unit}
                    </dd>
                    <dt>Cost per {unit}</dt>
                    <dd>
                      {i.needsCostSetup
                        ? 'Needs cost details'
                        : '$' + precise(cost)}
                    </dd>
                    <dt>Inventory value</dt>
                    <dd>{money(i.quantity * i.cost)}</dd>
                    <dt>Reorder at</dt>
                    <dd>
                      {i.threshold == null
                        ? 'Not set'
                        : `${converted(i.threshold)} ${unit}`}
                    </dd>
                  </dl>
                  {isFabric(i) && (
                    <div className="fabric-card-details">
                      <p>
                        <strong>Width:</strong> {i.fabricWidth} {i.widthUnit}
                      </p>
                      <p>
                        {[i.color, i.pattern, i.collection]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p>
                        {i.fabricTracking === 'precut'
                          ? 'Counted precuts / bundles'
                          : i.pieceMode === 'separate'
                            ? `Separate piece: ${i.pieceId}`
                            : 'Total length · continuity unknown'}
                      </p>
                      {i.storageLocation && (
                        <p>Location: {i.storageLocation}</p>
                      )}
                    </div>
                  )}
                  {i.vendor && (
                    <p className="muted">Preferred vendor: {i.vendor}</p>
                  )}
                </div>
                <footer>
                  <button
                    className="btn secondary"
                    onClick={() => open('ingredient-detail', i)}
                  >
                    View details
                  </button>
                  <button
                    className="btn secondary"
                    onClick={() => open('ingredient-edit', i)}
                  >
                    {editActionLabel(i, 'ingredients')}
                  </button>
                </footer>
              </article>
            )
          })}
          {!rows.length && (
            <div className="calm-empty">
              <h3>No items match this view.</h3>
              <p>Try another filter, or add a pantry item.</p>
              <button
                className="btn secondary"
                onClick={() =>
                  open(
                    filter === 'Packaging'
                      ? 'packaging'
                      : filter === 'Craft materials'
                        ? 'trade-material'
                        : 'ingredient',
                  )
                }
              >
                Add Item
              </button>
            </div>
          )}
        </div>
      ) : (
        <section className="panel pantry-table">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columns.map(([key, label]) => (
                    <th
                      key={key}
                      aria-sort={
                        sort.key === key
                          ? sort.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        className="sort-heading"
                        onClick={() =>
                          chooseSort({
                            key,
                            direction:
                              sort.key === key && sort.direction === 'asc'
                                ? 'desc'
                                : 'asc',
                          })
                        }
                      >
                        {label}{' '}
                        <span aria-hidden="true">
                          {sort.key === key
                            ? sort.direction === 'asc'
                              ? '↑'
                              : '↓'
                            : '↕'}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th>
                    <span className="sr-only">Item actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const unit = i.storageUnit || i.unit,
                    quantity = convert(i.quantity, i.unit, unit, i.conversions),
                    threshold =
                      i.threshold == null
                        ? null
                        : convert(i.threshold, i.unit, unit, i.conversions),
                    cost =
                      convert(1, unit, i.unit, i.conversions) *
                      (i.currentCost ?? i.cost)
                  const status = stockStatus(i),
                    tone = stockTone(status)
                  return (
                    <tr key={i.id}>
                      <td data-label="Item">
                        <button
                          className="item-name"
                          onClick={() => open('ingredient-detail', i)}
                        >
                          <PantryPhoto item={i} assets={assets} />
                          <span>
                            <strong>{i.name}</strong>
                            <small>{i.category}</small>
                          </span>
                        </button>
                      </td>
                      <td data-label="Category">{i.category || '—'}</td>
                      <td data-label="On hand">
                        <strong>{precise(quantity)}</strong>{' '}
                        <span className="muted">{unit}</span>
                      </td>
                      <td data-label="Unit cost">
                        {i.needsCostSetup
                          ? 'Needs cost details'
                          : '$' + precise(cost)}{' '}
                        <small>/ {unit}</small>
                      </td>
                      <td data-label="Inventory value">
                        {money(i.quantity * i.cost)}
                      </td>
                      <td data-label="Status">
                        <span className={`status ${tone}`}>
                          {tone === 'amber' || tone === 'pink' ? (
                            <TriangleAlert size={13} />
                          ) : null}
                          {status}
                        </span>
                      </td>
                      <td data-label="Reorder point">
                        {threshold == null
                          ? 'Not set'
                          : `${precise(threshold)} ${unit}`}
                      </td>
                      <td data-label="Preferred vendor">{i.vendor || '—'}</td>
                      <td data-label="Actions">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="icon-button"
                              aria-label={`Actions for ${i.name}`}
                            >
                              <MoreHorizontal size={21} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="workspace-menu"
                          >
                            <DropdownMenuItem
                              onSelect={() => open('shelf-label', i)}
                            >
                              Print shelf/bin label
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => open('ingredient-detail', i)}
                            >
                              View item
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                open('receive', {
                                  ...i,
                                  quantity: i.purchaseQuantity || 1,
                                  unit: i.purchaseUnit || i.unit,
                                  price: i.packagePrice || 0,
                                })
                              }
                            >
                              <Plus size={16} />
                              Receive stock
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                open('adjust', { ...i, quantity: -1 })
                              }
                            >
                              Adjust / record waste
                            </DropdownMenuItem>
                            {isFabric(i) && i.fabricTracking === 'length' && (
                              <DropdownMenuItem
                                onSelect={() => open('fabric-remnant', i)}
                              >
                                Transfer usable remnant
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <div className="calm-empty">
              <Package size={30} />
              <h3>No items match this view.</h3>
              <p>Try another filter, or add a pantry item.</p>
              <button
                className="btn secondary"
                onClick={() =>
                  open(
                    filter === 'Packaging'
                      ? 'packaging'
                      : filter === 'Craft materials'
                        ? 'trade-material'
                        : 'ingredient',
                  )
                }
              >
                Add Item <ArrowRight size={16} />
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
