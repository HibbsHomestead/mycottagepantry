import { ProductLinkImport } from './product-link-import'
import { InventoryProductFields } from './inventory-product-fields'
import { ovenToday } from '@/lib/oven-dates'
import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import {
  FabricFields,
  FabricPurchaseFields,
  FabricPriceFields,
} from './fabric-fields'
import { ItemPhotoField } from './item-photo-field'
import { PantryPhoto } from './pantry-photo'
import { fabricUnitOptions } from '@/lib/fabric'
import { convert, money, type Item, type Workspace } from '@/lib/domain'
import { precise } from '@/lib/ingredients'
import { stockReceiptPreview } from '@/lib/inventory-browse'
import { InventoryPackageFields } from './inventory-package-fields'
import {
  fabricPurchaseDraft,
  fabricByYard,
  fabricYardContents,
  inventoryPackagePreview,
  inventoryPackagePlan,
} from '@/lib/inventory-package'
export function FabricDialog({
  kind,
  item,
  workspace,
  role,
  mutate,
  onWorkspace,
  close,
  onDirty,
}: {
  kind: string
  item: Item
  workspace: Workspace
  role: string
  mutate: (
    action: string,
    table: string,
    data: Record<string, unknown>,
  ) => Promise<unknown>
  onWorkspace: (w: Workspace) => void
  close: () => void
  onDirty: (v: boolean) => void
}) {
  const [draft, setDraft] = useState<Item>(() => ({
    ...(kind === 'fabric-edit' ? fabricPurchaseDraft(item) : item),
    operationId: crypto.randomUUID(),
    expectedUpdatedAt: item.updatedAt,
    ...(kind === 'fabric-receive' ||
    kind === 'fabric-adjust' ||
    kind === 'fabric-remnant'
      ? {
          receivedDate: ovenToday(workspace.settings[0]),
          purchaseDate: '',
          quantity: '',
          price: '',
          unit: item.storageUnit || item.unit,
          purchaseUnit: '',
          pieceId: '',
          usableLengthUnit: item.storageUnit || 'yd',
          lengthConfirmed: false,
          ...(kind === 'fabric-receive'
            ? {
                lot: '',
                priceMode:
                  (item.storageUnit || item.unit) === 'yd'
                    ? 'per_unit'
                    : 'total',
                purchaseUnitPrice: '',
              }
            : {}),
        }
      : {}),
  }))
  const [importBusy, setImportBusy] = useState(false)
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const lock = useRef(false)
  const read = kind === 'fabric-detail',
    receive = kind === 'fabric-receive',
    remnant = kind === 'fabric-remnant',
    edit = kind === 'fabric-edit'
  const manager = ['Owner', 'Manager'].includes(role)
  const purchaseReview =
    edit &&
    !!inventoryPackagePreview({ ...draft, purchasePriceReviewRequired: false })
      .error
  const canWrite = manager || (role === 'Production Staff' && !edit && !remnant)
  useEffect(() => {
    onDirty(dirty)
    return () => onDirty(false)
  }, [dirty, onDirty])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const change = (key: string, value: string | number | boolean) => {
    setDirty(true)
    setDraft((d) => ({ ...d, [key]: value }))
  }
  const dismiss = () => {
    if (!busy && (!dirty || window.confirm('Discard unsaved fabric changes?')))
      close()
  }
  const field = (
    key: string,
    label: string,
    required = false,
    type = 'text',
  ) => (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={draft[key] ?? ''}
        required={required}
        onChange={(e) => change(key, e.target.value)}
      />
    </label>
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss()
      }}
    >
      <DialogContent className="app-dialog wide-dialog">
        <DialogHeader>
          <DialogTitle>
            {read
              ? item.name
              : edit
                ? 'Edit Material'
                : receive
                  ? 'Receive fabric'
                  : remnant
                    ? 'Transfer usable remnant'
                    : 'Adjust fabric / record waste'}
          </DialogTitle>
          <DialogDescription>
            Fabric stock, piece details and recorded cost. Width stays separate
            from available length.
          </DialogDescription>
        </DialogHeader>
        {read ? (
          <>
            <PantryPhoto
              className="pantry-edit-photo"
              item={item}
              assets={workspace.graphic_assets || []}
            />
            <dl className="fabric-summary">
              <dt>Available</dt>
              <dd>
                {precise(
                  convert(
                    item.quantity,
                    item.unit,
                    item.storageUnit || item.unit,
                  ),
                )}{' '}
                {item.storageUnit || item.unit}
              </dd>
              <dt>Width</dt>
              <dd>
                {item.fabricWidth} {item.widthUnit}
              </dd>
              <dt>Average cost per {item.storageUnit || item.unit}</dt>
              <dd>
                {precise(
                  item.cost *
                    convert(1, item.storageUnit || item.unit, item.unit),
                )}
              </dd>
              <dt>Reorder at</dt>
              <dd>
                {item.threshold} {item.unit} ·{' '}
                {item.quantity <= item.threshold ? 'Low stock' : 'In stock'}
              </dd>
            </dl>
            <p>
              {[item.fiber, item.color, item.pattern, item.collection]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p>
              SKU: {item.sku || 'Not set'} · Barcode:{' '}
              {item.barcode || 'Not set'}
            </p>
            <p>
              Supplier: {item.vendor || 'Not set'} · Location:{' '}
              {item.storageLocation || 'Not set'}
            </p>
            <p>
              {item.fabricTracking === 'precut'
                ? `Counted precuts / bundles${item.pieceLength ? ` · ${item.pieceLength} ${item.pieceLengthUnit} × ${item.fabricWidth} ${item.widthUnit} per piece` : ''}`
                : item.pieceMode === 'separate'
                  ? `Separate piece: ${item.pieceId}`
                  : 'Total length; continuity unknown. Separate pieces are not one continuous length.'}
            </p>
            {item.parentMaterialId && (
              <p>
                Transferred from:{' '}
                {workspace.ingredients.find(
                  (i) => i.id === item.parentMaterialId,
                )?.name || 'Parent fabric record'}
              </p>
            )}
            <p>{item.notes}</p>
            <h3>Stock movement history</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Movement</th>
                    <th>Quantity</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.ledger
                    .filter((l) => l.ingredientId === item.id)
                    .map((l) => (
                      <tr key={l.id}>
                        <td>{l.date}</td>
                        <td>{l.type}</td>
                        <td>
                          {precise(l.quantity)} {l.unit}
                        </td>
                        <td>{l.reason}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <form
            className="app-form"
            onSubmit={async (event) => {
              event.preventDefault()
              if (lock.current || importBusy) return
              lock.current = true
              setBusy(true)
              setError('')
              try {
                if (edit && draft.fabricPurchaseChanged)
                  inventoryPackagePlan(draft)
                await mutate(
                  edit
                    ? 'fabricUpdate'
                    : remnant
                      ? 'fabricRemnant'
                      : receive
                        ? 'receive'
                        : 'adjust',
                  'ingredients',
                  { ...draft, unit: edit ? item.unit : draft.unit },
                )
                setDirty(false)
                close()
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : 'Fabric could not be saved.',
                )
              } finally {
                lock.current = false
                setBusy(false)
              }
            }}
          >
            <fieldset disabled={busy || !canWrite}>
              <p>
                {item.name} · {precise(item.quantity)} {item.unit} on hand ·{' '}
                {money(item.cost)} per {item.unit}
              </p>
              {(edit || receive) && (
                <>
                  <ProductLinkImport
                    settings={workspace.settings[0]}
                    draft={draft}
                    existing
                    onWorkspace={onWorkspace}
                    onBusyChange={setImportBusy}
                    apply={(patch) => {
                      setDirty(true)
                      setDraft((d) =>
                        edit
                          ? { ...d, ...patch }
                          : {
                              ...d,
                              productDetails: { ...d.productDetails, ...patch },
                            },
                      )
                    }}
                  />
                  <InventoryProductFields
                    value={edit ? draft : { ...draft, ...draft.productDetails }}
                    change={(key, value) => {
                      if (receive) {
                        setDirty(true)
                        setDraft((d) => ({
                          ...d,
                          productDetails: { ...d.productDetails, [key]: value },
                        }))
                      } else change(key, value)
                    }}
                  />
                </>
              )}
              {receive && (
                <div className="form-grid">
                  {field('receivedDate', 'Received date', true, 'date')}
                  {field(
                    'purchaseDate',
                    'Purchase date (optional)',
                    false,
                    'date',
                  )}
                  {field('lot', 'Lot (optional)')}
                </div>
              )}
              {edit ? (
                <>
                  {field('name', 'Fabric name', true)}
                  <FabricFields value={draft} change={change} fixed />
                  <div className="form-grid">
                    {field('sku', 'SKU')}
                    {field('barcode', 'Barcode')}
                    {field('threshold', `Reorder threshold (${item.unit})`)}
                  </div>
                  <label className="field">
                    <span>Supplier</span>
                    <select
                      value={draft.vendorId || ''}
                      onChange={(e) => change('vendorId', e.target.value)}
                    >
                      <option value="">No supplier</option>
                      {workspace.vendors.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ItemPhotoField
                    value={draft as Item}
                    assets={workspace.graphic_assets || []}
                    onChange={change}
                    onWorkspace={onWorkspace}
                    canUpload={manager}
                    disabled={busy}
                    onBusy={setBusy}
                    className="item-photo-control"
                    previewClassName="pantry-edit-photo"
                  />
                  {purchaseReview && (
                    <div className="calculation-box" role="status">
                      <p>
                        Review this saved purchase basis. Its quantities and
                        price remain unchanged until you confirm new purchase
                        details.
                      </p>
                      {!draft.fabricPurchaseChanged && (
                        <p>
                          Saved reference: {item.purchaseQuantity ?? 'Not set'}{' '}
                          {item.purchaseUnit || 'purchase unit'} for{' '}
                          {item.packagePrice == null
                            ? 'an unknown price'
                            : money(item.packagePrice)}
                          .
                        </p>
                      )}
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => {
                          setDirty(true)
                          setDraft((d) => ({
                            ...d,
                            amountPerPackage: fabricByYard(d)
                              ? fabricYardContents(d)
                              : '',
                            packagePrice: '',
                            fabricPurchaseChanged: true,
                            fabricPurchaseBasisConflict: false,
                            purchasePriceReviewRequired: true,
                            purchasePriceReviewNote: `Enter and review the cost per ${d.purchaseUnit || 'purchase unit'}. Saved stock and historical prices stay unchanged.`,
                          }))
                        }}
                      >
                        Review purchase details
                      </button>
                    </div>
                  )}
                  {(!purchaseReview || draft.fabricPurchaseChanged) && (
                    <InventoryPackageFields
                      value={draft}
                      workspace={workspace}
                      openingStock={false}
                      fixedStockUnit
                      showSupplier={false}
                      change={(key, value) => {
                        setDirty(true)
                        setDraft((d) => ({
                          ...d,
                          [key]: value,
                          ...(key !== 'vendorId'
                            ? { fabricPurchaseChanged: true }
                            : {}),
                        }))
                      }}
                    />
                  )}
                  <p className="form-hint">
                    Purchase details set the current reference price. Saving
                    them does not change stock quantities, inventory valuation,
                    or historical purchases.
                  </p>
                </>
              ) : (
                <>
                  {field(
                    'quantity',
                    receive
                      ? 'Quantity received (decimals or fractions)'
                      : remnant
                        ? 'Usable remnant length'
                        : 'Signed quantity adjustment',
                    true,
                  )}
                  <label className="field">
                    <span>Unit</span>
                    <select
                      aria-label="Unit"
                      value={draft.unit}
                      onChange={(e) => {
                        const unit = e.target.value
                        setDirty(true)
                        setDraft((d) => ({
                          ...d,
                          unit,
                          purchaseUnit: unit,
                          lengthConfirmed: false,
                          ...(receive
                            ? {
                                priceMode: unit === 'yd' ? 'per_unit' : 'total',
                                price: '',
                                purchaseUnitPrice: '',
                                purchasePriceReviewNote:
                                  'Purchase unit changed. Review the price for this receipt; the previous price has not been carried over.',
                              }
                            : {}),
                        }))
                      }}
                    >
                      {[
                        ...fabricUnitOptions(item.fabricTracking),
                        ...(receive && item.fabricTracking === 'length'
                          ? ['bolt', 'roll']
                          : []),
                      ].map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </label>
                  {receive && (
                    <>
                      <FabricPriceFields value={draft} change={change} />
                      {draft.unit === 'yd' && (
                        <p className="form-hint">
                          Purchase quantity: 1 yd. Enter the total yards
                          received above.
                        </p>
                      )}
                      {draft.purchasePriceReviewNote && (
                        <p className="form-hint" role="status">
                          {draft.purchasePriceReviewNote}
                        </p>
                      )}
                      <FabricPurchaseFields
                        value={{ ...draft, purchaseUnit: draft.unit }}
                        change={change}
                      />
                      <p className="calculation-box" aria-live="polite">
                        {stockReceiptPreview(
                          item,
                          draft.quantity,
                          draft.unit,
                          draft,
                        ) ||
                          'Enter quantity and confirmed usable contents to preview the resulting stock.'}
                      </p>
                      <p className="form-hint">
                        Total cost follows the existing inventory asset / cash
                        posting and weighted average policy.{' '}
                        {draft.priceMode === 'per_unit'
                          ? `Total acquisition cost is the quantity received × cost per ${draft.unit}.`
                          : 'Enter the total paid for this receipt.'}{' '}
                        A bolt or roll needs confirmed usable length.
                      </p>
                    </>
                  )}
                  {remnant ? (
                    <>
                      {field('pieceId', 'Remnant identifier', true)}
                      {field('storageLocation', 'Remnant storage location')}
                      {field('notes', 'Remnant notes')}
                      <p className="form-hint">
                        This transfers length out of the parent into a separate
                        piece at the same width and cost. It adds no purchased
                        stock and records no waste. Narrower cut remnants
                        require a separate adjustment; this transfer supports
                        full-width remnants.
                      </p>
                    </>
                  ) : (
                    field('reason', 'Movement / waste reason', !receive)
                  )}
                  {!receive && !remnant && (
                    <label className="field">
                      <span>Movement type</span>
                      <select
                        value={draft.type || 'adjustment'}
                        onChange={(e) => change('type', e.target.value)}
                      >
                        <option value="adjustment">Adjustment</option>
                        <option value="waste">Waste</option>
                        <option value="spoilage">Spoilage</option>
                      </select>
                    </label>
                  )}
                </>
              )}
            </fieldset>
            {error && <p role="alert">{error}</p>}
            <div className="form-actions">
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                onClick={dismiss}
              >
                Cancel
              </button>
              <button
                className="btn"
                type="submit"
                disabled={busy || !canWrite}
              >
                {busy ? 'Saving…' : remnant ? 'Transfer remnant' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
