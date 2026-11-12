import { useState } from 'react'
import { Search, ScanLine } from 'lucide-react'
import {
  barcodeMatches,
  barcodeText,
  internalItemId,
  type BarcodeMatch,
} from '@/lib/barcodes'
import { type Item, type Workspace } from '@/lib/domain'
import {
  inventoryEntries,
  onHandText,
  packageText,
  type InventoryEntry,
} from '@/lib/inventory-browse'
import { PantryPhoto } from './pantry-photo'
import './inventory-barcode-review.css'

export function inventoryBarcodeMatches(
  w: Workspace,
  raw: string,
  format?: string,
) {
  if (!raw.trim()) return []
  const code = barcodeText(raw),
    internal = internalItemId(code)
  return inventoryEntries(w).flatMap((entry) =>
    internal
      ? entry.table === 'ingredients' && entry.item.id === internal
        ? [{ item: entry.item, entry }]
        : []
      : barcodeMatches([entry.item], code, format).map((m) => ({
          ...m,
          entry,
        })),
  ) as (BarcodeMatch & { entry: InventoryEntry })[]
}
export function InventoryBarcodeReview({
  compact = false,
  inline = false,
  workspace,
  code,
  format,
  change,
  onScan,
  onView,
  onReceive,
  onManual,
  onUrl,
  autoSearch = false,
  receiptLine,
  onUse,
}: {
  compact?: boolean
  inline?: boolean
  workspace: Workspace
  code: string
  format?: string
  change: (code: string) => void
  onScan: () => void
  onView?: (item: Item, table: string) => void
  onReceive?: (item: Item) => void
  onManual: () => void
  onUrl: () => void
  autoSearch?: boolean
  receiptLine?: boolean
  onUse?: (id: string, table: string) => void
}) {
  const [searched, setSearched] = useState(autoSearch),
    [manual, setManual] = useState(compact || autoSearch),
    [error, setError] = useState(''),
    [choice, setChoice] = useState<number | null>(() => {
      try {
        return autoSearch &&
          inventoryBarcodeMatches(workspace, code, format).length === 1
          ? 0
          : null
      } catch {
        return null
      }
    }),
    [confirmed, setConfirmed] = useState(false)
  let matches: ReturnType<typeof inventoryBarcodeMatches> = []
  try {
    matches = inventoryBarcodeMatches(workspace, code, format)
  } catch {
    /* Invalid manual values are explained on intentional search. */
  }
  const match = choice === null ? null : matches[choice]
  function search() {
    try {
      const found = inventoryBarcodeMatches(workspace, code, format)
      barcodeText(code)
      setChoice(found.length === 1 ? 0 : null)
      setSearched(true)
      setConfirmed(false)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <section
      className="barcode-entry-result"
      aria-label="Barcode assisted entry"
    >
      {!inline && (
        <div className="barcode-entry-methods">
          <button type="button" className="btn secondary" onClick={onScan}>
            Scan Barcode
          </button>
          {!compact && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => setManual(true)}
            >
              Enter Barcode Manually
            </button>
          )}
          {!compact && (
            <button type="button" className="btn secondary" onClick={onUrl}>
              Import from URL
            </button>
          )}
          {!compact && (
            <button type="button" className="btn secondary" onClick={onManual}>
              Enter Details Manually
            </button>
          )}
        </div>
      )}
      {manual && (
        <div className={inline ? 'barcode-entry-row' : undefined}>
          <label className="field">
            <span>Scan or enter barcode</span>
            <input
              type="text"
              autoComplete="off"
              value={code}
              onChange={(e) => {
                change(e.target.value)
                setSearched(false)
                setConfirmed(false)
                setChoice(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  search()
                }
              }}
            />
          </label>
          <button
            type="button"
            className="btn secondary"
            onClick={search}
            disabled={!code.trim()}
            title={inline ? 'Search this Oven' : undefined}
          >
            {inline && <Search size={16} aria-hidden="true" />}
            <span className={inline ? 'barcode-entry-action-label' : undefined}>
              Search this Oven
            </span>
          </button>
          {inline && (
            <button
              type="button"
              className="btn secondary"
              onClick={onScan}
              title="Scan Barcode"
            >
              <ScanLine size={16} aria-hidden="true" />
              <span className="barcode-entry-action-label">Scan Barcode</span>
            </button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {searched && (
        <div aria-live="polite">
          <h3>
            {matches.length
              ? 'Existing inventory found'
              : 'No matching item in this Oven'}
          </h3>
          {matches.length > 1 && (
            <p>
              Choose the correct item, variant and package. Nothing is selected
              automatically.
            </p>
          )}
          {matches.map((m, n) => (
            <label className="barcode-match" key={`${m.entry.key}:${n}`}>
              <input
                type="radio"
                name="barcode-match"
                checked={choice === n}
                onChange={() => {
                  setChoice(n)
                  setConfirmed(false)
                }}
              />
              <PantryPhoto
                item={m.item}
                assets={workspace.graphic_assets}
                kind={m.entry.table === 'products' ? 'product' : 'pantry'}
              />
              <span>
                <strong>{m.item.name}</strong>
                {m.item.variant && <small>{m.item.variant}</small>}
                <small>{onHandText(m.item)}</small>
                <small>
                  {packageText(m.offer || m.item) ||
                    'Package size not recorded — confirm in receiving'}
                </small>
              </span>
            </label>
          ))}
          {match && (
            <>
              <p>
                Pending receipt quantity: not entered. Scanning adds no stock.
              </p>
              {!receiptLine && onReceive && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{' '}
                  I checked the variant and package size against the item being
                  received.
                </label>
              )}
              <div className="button-row">
                {onView && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => onView(match.item, match.entry.table)}
                  >
                    View Item
                  </button>
                )}
                {receiptLine ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onUse?.(match.item.id, match.entry.table)}
                  >
                    Use existing item
                  </button>
                ) : (
                  onReceive &&
                  !match.item.compoundRecipeId && (
                    <button
                      type="button"
                      className="btn"
                      disabled={!confirmed}
                      onClick={() =>
                        onReceive({
                          ...match.item,
                          quantity: '',
                          price: '',
                          unit:
                            match.offer?.purchaseUnit ||
                            match.item.purchaseUnit ||
                            match.item.unit,
                          vendor: match.offer?.vendor || match.item.vendor,
                          operationId: crypto.randomUUID(),
                        })
                      }
                    >
                      Receive Stock
                    </button>
                  )
                )}
              </div>
            </>
          )}
          {!matches.length && (
            <p>
              Barcode read: <strong>{code}</strong>. Product lookup unavailable:
              no product-data provider is connected. No product details or price
              were found. The barcode stays in this form; continue with manual
              details or URL import. Review ingredient/allergen information
              before saving.
            </p>
          )}
        </div>
      )}
      {!inline && (
        <p className="form-hint">
          Use a camera or keyboard scanner, or enter the barcode manually.
        </p>
      )}
    </section>
  )
}
