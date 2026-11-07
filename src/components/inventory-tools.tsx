import { useRef, useState } from 'react'
import type { Item, Workspace } from '@/lib/domain'
import {
  barcodeMatches,
  barcodeText,
  internalItemId,
  type BarcodeMatch,
} from '@/lib/barcodes'
import { ShelfLabels } from './shelf-labels'
import { BarcodeScanner } from './barcode-scanner'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { countQuantity } from '@/lib/inventory-count'
import './inventory-tools.css'
import { PantryPhoto } from './pantry-photo'
import {
  inventoryEntries,
  onHandText,
  packageText,
} from '@/lib/inventory-browse'

export function InventoryTools({
  workspace,
  role,
  open,
  mutate,
  refresh,
}: {
  workspace: Workspace
  role: string
  open: (kind: string, item?: Item) => void
  mutate: (
    action: string,
    table: string,
    data: Record<string, any>,
  ) => Promise<void>
  refresh: () => Promise<void>
}) {
  const items = workspace.ingredients,
    sessions = workspace.inventory_counts || []
  const [scanner, setScanner] = useState(false),
    [mode, setMode] = useState<'find' | 'receive' | 'count'>('find'),
    [code, setCode] = useState(''),
    [codeFormat, setCodeFormat] = useState<string | undefined>(),
    [matches, setMatches] = useState<BarcodeMatch[]>([]),
    [resultOpen, setResultOpen] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [labelItems, setLabelItems] = useState<Item[] | null>(null),
    [locationLabels, setLocationLabels] = useState(false),
    [countOpen, setCountOpen] = useState(false),
    [sessionId, setSessionId] = useState(''),
    [countItem, setCountItem] = useState(''),
    [quantity, setQuantity] = useState(''),
    [unit, setUnit] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [linkId, setLinkId] = useState('')
  const pending = useRef(false),
    startId = useRef<string | null>(null)
  const canStock = ['Owner', 'Manager', 'Production Staff'].includes(role),
    canEdit = ['Owner', 'Manager'].includes(role)
  const session = sessions.find((s) => s.id === sessionId),
    item = items.find((i) => i.id === countItem)
  async function run(fn: () => Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  function found(raw: string, format?: string) {
    setScanner(false)
    setError('')
    try {
      const value = barcodeText(raw)
      setCode(value)
      setCodeFormat(format)
      setConfirmed(false)
      const internal = internalItemId(value)
      setMatches(
        internal
          ? items.filter((i) => i.id === internal).map((item) => ({ item }))
          : barcodeMatches(
              inventoryEntries(workspace).map((e) => e.item),
              value,
              format,
            ),
      )
      setResultOpen(true)
      setLinkId('')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  function choose(match: BarcodeMatch) {
    setResultOpen(false)
    if (mode === 'find')
      open('inventory-preview-item', {
        ...match.item,
        inventoryTable:
          match.item.workflow === 'resale' ? 'products' : 'ingredients',
      })
    else if (mode === 'receive') {
      const source = match.offer || match.item
      // Scanning fills a draft only. Unknown package contents are never converted to stock.
      open('receive', {
        ...match.item,
        quantity: '',
        unit: source.purchaseUnit || match.item.unit,
        price: '',
        vendor: source.vendor || match.item.vendor,
        operationId: crypto.randomUUID(),
      })
    } else {
      setCountItem(match.item.id)
      setUnit(match.item.storageUnit || match.item.unit)
      setQuantity('')
      setCountOpen(true)
    }
  }
  function scan(next: typeof mode) {
    setMode(next)
    setScanner(true)
  }
  return (
    <>
      <div
        className="inventory-tool-actions"
        aria-label="Inventory scanning and labels"
      >
        <button className="btn secondary" onClick={() => scan('find')}>
          Scan barcode
        </button>
        {canStock && (
          <>
            <button className="btn secondary" onClick={() => scan('receive')}>
              Scan to receive
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                setCountOpen(true)
                setError('')
              }}
            >
              Inventory count sessions
            </button>
          </>
        )}
        <button
          className="btn secondary"
          onClick={() => (
            setLocationLabels(false),
            setLabelItems(items.filter((i) => selected.includes(i.id)))
          )}
          disabled={!selected.length}
        >
          Print shelf/bin labels ({selected.length})
        </button>
        {items.some((i) => i.storageLocation) && (
          <button
            className="btn secondary"
            onClick={() => {
              setLocationLabels(true)
              setLabelItems(items)
            }}
          >
            Location labels
          </button>
        )}
      </div>
      <details>
        <summary>Select inventory items for shelf/bin labels</summary>
        <div className="inventory-tool-actions">
          <button
            className="btn secondary"
            onClick={() => setSelected(items.slice(0, 100).map((i) => i.id))}
          >
            Select up to 100
          </button>
          <button className="btn secondary" onClick={() => setSelected([])}>
            Clear selection
          </button>
        </div>
        {items.map((i) => (
          <label className="check-label" key={i.id}>
            <input
              type="checkbox"
              checked={selected.includes(i.id)}
              onChange={(e) =>
                setSelected((s) =>
                  e.target.checked
                    ? [...s, i.id].slice(0, 100)
                    : s.filter((id) => id !== i.id),
                )
              }
            />
            {i.name}
          </label>
        ))}
      </details>
      {error && !countOpen && !resultOpen && (
        <p role="alert" className="warning-text">
          {error}
        </p>
      )}
      {scanner && (
        <BarcodeScanner onCode={found} onClose={() => setScanner(false)} />
      )}
      {labelItems && (
        <ShelfLabels
          items={labelItems}
          initialLocationOnly={locationLabels}
          profiles={workspace.settings[0]?.currentShelfMediaProfiles || []}
          onSave={(profile) => mutate('shelfMedia', 'settings', { profile })}
          onClose={() => setLabelItems(null)}
        />
      )}
      <Dialog open={resultOpen} onOpenChange={setResultOpen}>
        <DialogContent className="inventory-tool-dialog">
          <DialogTitle>
            {matches.length ? 'Review barcode match' : 'Unknown barcode'}
          </DialogTitle>
          <DialogDescription>
            Code: {code}. Only this oven is searched. No external lookup or
            stock update occurs.
          </DialogDescription>
          {matches.length > 1 && (
            <p className="warning-text">
              Multiple matches: choose the correct item and package.
            </p>
          )}
          {mode === 'receive' && !!matches.length && (
            <>
              <p>
                Pending receipt quantity: not entered. Scanning posts no stock.
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{' '}
                I checked the variant and package size against the item being
                received.
              </label>
            </>
          )}
          {matches.map((m, n) => (
            <button
              className="btn secondary scan-match"
              key={n}
              disabled={mode === 'receive' && !confirmed}
              onClick={() => choose(m)}
            >
              <PantryPhoto item={m.item} assets={workspace.graphic_assets} />
              {m.item.name} {m.item.variant || ''} — {onHandText(m.item)} ·{' '}
              {packageText(m.offer || m.item) || 'Package size not recorded'}{' '}
              {m.offer
                ? `${m.offer.vendor || 'Package'} · ${m.offer.purchaseQuantity} ${m.offer.purchaseUnit}`
                : 'Item barcode'}
            </button>
          ))}
          {!matches.length && canEdit && (
            <>
              <p>
                Product lookup unavailable: no product-data provider is
                connected. Preserve this barcode and continue with a manual
                draft or URL import; no product data or actual price was found.
              </p>
              <label className="field">
                Link existing item
                <select
                  value={linkId}
                  onChange={(e) => setLinkId(e.target.value)}
                >
                  <option value="">Choose an item</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn secondary"
                disabled={!linkId || busy}
                onClick={() =>
                  void run(async () => {
                    const i = items.find((i) => i.id === linkId)!
                    if (i.barcode && i.barcode !== code)
                      throw new Error(
                        'This item has a barcode. Add a package barcode in item details instead of replacing it.',
                      )
                    await mutate('ingredientBarcode', 'ingredients', {
                      id: i.id,
                      expectedUpdatedAt: i.updatedAt,
                      barcode: code,
                      barcodeFormat: codeFormat,
                    })
                    setResultOpen(false)
                  })
                }
              >
                Confirm barcode link
              </button>
              <button
                className="btn secondary"
                onClick={() => {
                  setResultOpen(false)
                  open('ingredient', {
                    id: '',
                    name: '',
                    barcode: code,
                    barcodeFormat: codeFormat,
                    purchaseQuantity: '',
                    purchaseUnit: '',
                    packagePrice: '',
                    unit: 'each',
                    quantity: 0,
                    threshold: 0,
                    usedAs: 'ingredient',
                    category: '',
                    vendor: '',
                  })
                }}
              >
                Create draft item
              </button>
            </>
          )}
          {error && (
            <p role="alert" className="warning-text">
              {error}
            </p>
          )}
          <button
            className="btn secondary"
            onClick={() => setResultOpen(false)}
          >
            Close
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={countOpen} onOpenChange={setCountOpen}>
        <DialogContent className="inventory-tool-dialog">
          <DialogTitle>Inventory count session</DialogTitle>
          <DialogDescription>
            Count actual stock on hand, including partial packages. Saving count
            lines changes no stock. Applying reviewed differences creates stock
            adjustments and associated accounting entries.
          </DialogDescription>
          <label className="field">
            Saved session
            <select
              value={sessionId}
              onChange={(e) => {
                setSessionId(e.target.value)
                setConfirmed(false)
              }}
            >
              <option value="">Choose a session</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.date} · {s.id.slice(0, 8)} · {s.status}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                startId.current ||= crypto.randomUUID()
                await mutate('inventoryCountStart', 'inventory_counts', {
                  id: startId.current,
                })
                setSessionId(startId.current)
                startId.current = null
                setConfirmed(false)
              })
            }
          >
            Start new count
          </button>
          {session?.status === 'draft' && (
            <>
              <button className="btn secondary" onClick={() => scan('count')}>
                Scan barcode for count
              </button>
              <label className="field">
                Item
                <select
                  value={countItem}
                  onChange={(e) => {
                    const i = items.find((i) => i.id === e.target.value)
                    setCountItem(e.target.value)
                    setUnit(i?.storageUnit || i?.unit || '')
                    setQuantity('')
                    setConfirmed(false)
                  }}
                >
                  <option value="">Choose tracked item</option>
                  {items
                    .filter((i) => i.trackInventory !== false)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                </select>
              </label>
              {item && (
                <>
                  <p>
                    Current system balance: {item.quantity} {item.unit}. Check
                    the ledger if stock moved while you counted.
                  </p>
                  <label className="field">
                    Actual quantity on hand
                    <input
                      type="text"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Count unit
                    <input
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                    />
                  </label>
                  <p className="muted">
                    Use recorded storage units or explicitly verified package
                    units. “1 package” never implies its contents.
                  </p>
                  <button
                    className="btn secondary"
                    disabled={busy || !quantity}
                    onClick={() =>
                      void run(async () => {
                        countQuantity(quantity, unit, item)
                        await mutate('inventoryCountLine', 'inventory_counts', {
                          id: session.id,
                          revision: session.revision,
                          ingredientId: item.id,
                          quantity,
                          unit,
                          inventoryRevision: item.inventoryRevision,
                        })
                        setConfirmed(false)
                        setQuantity('')
                      })
                    }
                  >
                    Save count line
                  </button>
                </>
              )}
            </>
          )}
          {!!session?.lines.length && (
            <>
              <ul>
                {session.lines.map((l: Item) => (
                  <li key={l.ingredientId}>
                    {l.name}: counted {l.enteredQuantity} {l.enteredUnit} ={' '}
                    {l.countedQuantity} {l.unit}; system at count{' '}
                    {l.systemQuantity}; adjustment{' '}
                    {Number((l.countedQuantity - l.systemQuantity).toFixed(8))}{' '}
                    {l.unit}
                    {items.find((i) => i.id === l.ingredientId)
                      ?.inventoryRevision !== l.inventoryRevision && (
                      <strong className="warning-text">
                        {' '}
                        — Stock changed: refresh/recount required
                      </strong>
                    )}
                  </li>
                ))}
              </ul>
              {session.status === 'draft' && (
                <>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I reviewed all differences and their stock/accounting
                    effects.
                  </label>
                  <button
                    className="btn"
                    disabled={busy || !confirmed}
                    onClick={() =>
                      void run(async () => {
                        await mutate(
                          'inventoryCountComplete',
                          'inventory_counts',
                          {
                            id: session.id,
                            revision: session.revision,
                            confirm: true,
                          },
                        )
                        setConfirmed(false)
                      })
                    }
                  >
                    Apply reviewed count adjustments
                  </button>
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="warning-text">
              {error} Your entered quantity stays here.
            </p>
          )}
          <div className="inventory-tool-actions">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => void run(refresh)}
            >
              Refresh balances / retry connection
            </button>
            <button
              className="btn secondary"
              onClick={() => setCountOpen(false)}
            >
              Close
            </button>
          </div>
          <p className="muted">
            Saved lines persist on the server. Unsaved quantities remain only
            while this form is open; offline saving is not supported.
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
