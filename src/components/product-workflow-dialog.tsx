import { ProductLinkImport } from './product-link-import'
import { ProductEditor } from './product-editor'
import { InventoryProductFields } from './inventory-product-fields'
import { ovenToday } from '@/lib/oven-dates'
import {
  useEffect,
  useRef,
  useState,
  useId,
  isValidElement,
  cloneElement,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { PantryPhoto } from './pantry-photo'
import { ProductArtworkFields } from './product-artwork-fields'
import {
  costBreakdown,
  money,
  units,
  type Item,
  type Workspace,
} from '@/lib/domain'
import { stockReceiptPreview } from '@/lib/inventory-browse'
import {
  FabricFields,
  FabricPurchaseFields,
  FabricPriceFields,
} from './fabric-fields'
import {
  fabricReceipt,
  fabricUnitOptions,
  isFabric,
  materialPlan,
  fabricPurchaseCost,
} from '@/lib/fabric'

function Field({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId()
  return (
    <label className="field">
      <span id={labelId}>{label}</span>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{ 'aria-labelledby'?: string }>,
            { 'aria-labelledby': labelId },
          )
        : children}
    </label>
  )
}
type WorkflowProps = Parameters<typeof ProductEditor>[0]
/**
 * Products (handmade and resale) use the shared tabbed ProductEditor from both
 * Products and Inventory. Other workflow kinds keep their dedicated forms.
 */
export function ProductWorkflowDialog(props: WorkflowProps) {
  return props.kind.startsWith('trade-product') ? (
    <ProductEditor {...props} />
  ) : (
    <WorkflowDialog {...props} />
  )
}
function WorkflowDialog({
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
  item: Item | null
  workspace: Workspace
  role: string
  mutate: (
    action: string,
    table: string,
    data: Record<string, unknown>,
  ) => Promise<void>
  onWorkspace: (workspace: Workspace) => void
  close: () => void
  onDirty: (dirty: boolean) => void
}) {
  const [draft, setDraft] = useState<Item>(() => ({
    id: crypto.randomUUID(),
    creationRequestId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    name: '',
    workflow: 'handmade',
    recipeId: '',
    yield: 1,
    yieldUnit: 'each',
    laborMinutes: 0,
    laborRate: workspace.settings[0]?.laborRate ?? 0,
    overhead: 0,
    threshold: 0,
    purchaseQuantity: '',
    packagePrice: '',
    price: '',
    unit: 'each',
    purchaseUnit: 'each',
    fabricTracking: 'length',
    widthUnit: 'in',
    pieceLengthUnit: 'in',
    usableLengthUnit: 'yd',
    pieceMode: 'aggregate',
    itemsPerUnit: 1,
    quantity: '',
    reason: '',
    count: 1,
    actualYield: item?.yield || 1,
    waste: 0,
    wasteReason: '',
    date: ovenToday(workspace.settings[0]),
    receivedDate: ovenToday(workspace.settings[0]),
    ...item,
    ...(['trade-receive', 'trade-adjust'].includes(kind)
      ? {
          receivedDate: ovenToday(workspace.settings[0]),
          purchaseDate: '',
          quantity:
            kind === 'trade-adjust' && item?.proposedAdjustment
              ? String(item.proposedAdjustment)
              : '',
          price: '',
          unit: item?.purchaseUnit || 'each',
          itemsPerUnit: item?.itemsPerUnit || 1,
        }
      : {}),
    ...(kind === 'trade-complete'
      ? {
          laborMinutes:
            (workspace.recipes.find((r) => r.id === item?.recipeId)
              ?.laborMinutes || 0) * (item?.count || 1),
        }
      : {}),
  }))
  const [lines, setLines] = useState<
    {
      ingredientId: string
      quantity: string | number
      unit: string
      minimumWidth?: string
      widthUnit?: string
    }[]
  >(
    item?.lines?.map(
      (l: {
        ingredientId: string
        quantity: string | number
        unit: string
      }) => ({ ...l }),
    ) || [],
  )
  const [usage, setUsage] = useState<Record<string, string | number>>({})
  const [materialWaste, setMaterialWaste] = useState<
    Record<string, string | number>
  >({})
  const [importBusy, setImportBusy] = useState(false)
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const saving = useRef(false)
  const canManage = ['Owner', 'Manager'].includes(role)
  const isDesign = kind === 'trade-design'
  const isMaterial = kind === 'trade-material'
  const isRun = kind === 'trade-run'
  const isComplete = kind === 'trade-complete'
  const isReceive = kind === 'trade-receive'
  const isAdjust = kind === 'trade-adjust'
  const design = workspace.recipes.find((r) => r.id === draft.recipeId)
  const change = (key: string, value: string | number | boolean) => {
    setDirty(true)
    setDraft((d) => ({ ...d, [key]: value }))
  }
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
  function dismiss() {
    if (
      !busy &&
      (!dirty || window.confirm('Discard unsaved changes to this record?'))
    )
      close()
  }
  const input = (key: string, type = 'text', required = false) => (
    <input
      type={type}
      step={type === 'number' ? 'any' : undefined}
      value={draft[key] ?? ''}
      required={required}
      onChange={(e) => change(key, e.target.value)}
    />
  )
  const select = (key: string, options: { value: string; label: string }[]) => (
    <select
      value={draft[key] || ''}
      onChange={(e) => change(key, e.target.value)}
    >
      <option value="">Choose…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
  const title = isDesign
    ? item
      ? 'Edit Recipe'
      : 'Create handmade design'
    : isMaterial
      ? 'Receive a new craft material'
      : isRun
        ? 'Plan handmade production'
        : isComplete
          ? 'Complete handmade production'
          : isReceive
            ? 'Receive resale stock'
            : 'Adjust finished stock'
  let estimate: ReactNode = null
  try {
    if (isDesign && lines.length) {
      const cost = costBreakdown(
        { ...draft, id: draft.id, name: draft.name, lines },
        workspace.ingredients,
      )
      estimate = (
        <p className="calculation-box">
          Estimated cost per good item: <strong>{money(cost.perItem)}</strong> ·
          materials {money(cost.ingredient)}, labor {money(cost.labor)}, other{' '}
          {money(cost.overhead)}
        </p>
      )
    }
  } catch {
    /* Incomplete drafts show guidance, never an invented zero estimate. */
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss()
      }}
    >
      <DialogContent className="app-dialog wide-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isComplete
              ? 'Record good output and actual use. Material waste is additional to material used. Completion locks this run and its cost basis.'
              : isReceive
                ? 'Enter the pack contents and total acquisition cost. This receipt immediately adds sellable items.'
                : 'Save to your oven.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="app-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (saving.current || busy || importBusy) return
            saving.current = true
            setBusy(true)
            setError('')
            try {
              if (isDesign)
                await mutate('save', 'recipes', {
                  ...draft,
                  workflow: 'handmade',
                  lines,
                })
              else if (isMaterial)
                await mutate('save', 'ingredients', {
                  ...draft,
                  categoryId: 'craft-materials',
                  usedAs: 'material',
                  category: 'Craft materials',
                  currency: workspace.settings[0]?.currency || 'USD',
                  allergens: [],
                })
              else if (isRun) {
                const product = workspace.products.find(
                  (p) => p.id === draft.productId,
                )
                const source = workspace.recipes.find(
                  (r) => r.id === product?.recipeId,
                )
                if (!source)
                  throw new Error(
                    'Choose a handmade product with a saved design.',
                  )
                await mutate('save', 'batches', {
                  ...draft,
                  name: product!.name,
                  recipeId: source.id,
                  yield: source.yield * Number(draft.count),
                  status: 'scheduled',
                })
              } else if (isComplete) {
                const actual: Record<string, string | number> = {},
                  wasted: Record<string, string | number> = {}
                for (const line of design?.lines || []) {
                  actual[line.ingredientId] =
                    usage[line.ingredientId] ??
                    line.quantity * Number(draft.count)
                  wasted[line.ingredientId] =
                    materialWaste[line.ingredientId] ?? 0
                }
                await mutate('complete', 'batches', {
                  ...draft,
                  usage: actual,
                  materialWaste: wasted,
                })
              } else
                await mutate(
                  isReceive ? 'receive' : 'adjust',
                  'products',
                  draft,
                )
              setDirty(false)
              close()
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : 'Save failed. Your draft is preserved.',
              )
            } finally {
              saving.current = false
              setBusy(false)
            }
          }}
        >
          <fieldset
            disabled={
              busy || (!isComplete && !isReceive && !isAdjust && !canManage)
            }
            className="workflow-fields"
          >
            {(isMaterial || isReceive) && (
              <>
                <ProductLinkImport
                  settings={workspace.settings[0]}
                  draft={{
                    ...draft,
                    ...(isMaterial ? { usedAs: 'material' } : {}),
                  }}
                  existing={!!item}
                  onWorkspace={onWorkspace}
                  onBusyChange={setImportBusy}
                  onVendorsChange={(vendors) =>
                    onWorkspace({ ...workspace, vendors })
                  }
                  apply={(patch) => {
                    setDirty(true)
                    setDraft((d) => ({
                      ...d,
                      ...patch,
                      ...(patch.vendorId && isReceive
                        ? { supplierId: patch.vendorId }
                        : {}),
                    }))
                  }}
                />
                <InventoryProductFields value={draft} change={change} />
                {isReceive && (
                  <p>
                    Imported details update the package reference only. Confirm
                    purchased packs, contents and actual cost below.
                  </p>
                )}
              </>
            )}
            {(isMaterial || isReceive) && (
              <div className="form-grid">
                <Field label="Received date">
                  {input('receivedDate', 'date', true)}
                </Field>
                <Field label="Purchase date (optional)">
                  {input('purchaseDate', 'date')}
                </Field>
              </div>
            )}
            {isMaterial && draft.listedOnlinePrice != null && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={draft.purchasePriceConfirmed === true}
                  onChange={(e) =>
                    change('purchasePriceConfirmed', e.target.checked)
                  }
                />{' '}
                I confirmed the actual total purchase cost entered below.
              </label>
            )}
            {isMaterial && draft.productCheckedAt && (
              <>
                <Field label="Packages actually received">
                  {input('receivedPackages', 'number', true)}
                </Field>
                <p>
                  Package contents above describe one listed package. Enter the
                  number actually purchased and the total actual cost below.
                </p>
              </>
            )}
            {(isDesign || isMaterial) && (
              <Field label={isDesign ? 'Design name' : 'Material name'}>
                {input('name', 'text', true)}
              </Field>
            )}
            {isMaterial && (
              <>
                <PantryPhoto
                  className="pantry-edit-photo"
                  item={{
                    ...draft,
                    id: draft.id,
                    name: draft.name || 'New item',
                  }}
                  assets={workspace.graphic_assets || []}
                  kind="pantry"
                />
                <ProductArtworkFields
                  purpose="material"
                  assets={workspace.graphic_assets || []}
                  value={draft}
                  onChange={change}
                  onWorkspace={onWorkspace}
                  canUpload={canManage}
                  onBusy={setBusy}
                />
                <div className="form-grid">
                  <Field label="SKU">{input('sku')}</Field>
                  <Field label="Barcode">{input('barcode')}</Field>
                </div>
              </>
            )}
            {isMaterial && (
              <>
                <Field label="Material type">
                  <select
                    value={draft.materialType || 'other'}
                    onChange={(e) => {
                      change('materialType', e.target.value)
                      change(
                        'unit',
                        e.target.value === 'fabric' ? 'yd' : 'each',
                      )
                      change(
                        'purchaseUnit',
                        e.target.value === 'fabric' ? 'yd' : 'each',
                      )
                    }}
                  >
                    <option value="other">Other craft material</option>
                    <option value="fabric">Fabric</option>
                    <option value="yarn">Yarn</option>
                  </select>
                </Field>
                <div className="form-grid">
                  <Field label="Purchase quantity">
                    {input('purchaseQuantity', 'text', true)}
                  </Field>
                  <Field label="Purchase unit">
                    {select(
                      'purchaseUnit',
                      (isFabric(draft)
                        ? [
                            ...fabricUnitOptions(draft.fabricTracking),
                            ...(draft.fabricTracking === 'length'
                              ? ['bolt', 'roll']
                              : []),
                          ]
                        : Object.keys(units)
                      ).map((u) => ({ value: u, label: u })),
                    )}
                  </Field>
                  <Field label="Stock/display unit">
                    {select(
                      'unit',
                      (isFabric(draft)
                        ? fabricUnitOptions(draft.fabricTracking)
                        : Object.keys(units)
                      ).map((u) => ({ value: u, label: u })),
                    )}
                  </Field>
                  {isFabric(draft) ? (
                    <FabricPriceFields
                      value={draft}
                      change={change}
                      totalKey="packagePrice"
                    />
                  ) : (
                    <Field label="Total purchase cost">
                      {input('packagePrice', 'number', true)}
                    </Field>
                  )}
                  <Field label="Reorder threshold">
                    {input('threshold', 'text')}
                  </Field>
                </div>
                {isFabric(draft) && (
                  <>
                    <FabricFields value={draft} change={change} />
                    <FabricPurchaseFields value={draft} change={change} />
                    <FabricReceiptEstimate draft={draft} />
                    <Field label="Supplier">
                      {select(
                        'vendorId',
                        workspace.vendors.map((v) => ({
                          value: v.id,
                          label: v.name,
                        })),
                      )}
                    </Field>
                  </>
                )}
                <p className="form-hint">
                  Choose compatible units. No density or pack size is assumed.
                  Receive additional stock using the shared inventory receipt
                  action.
                </p>
              </>
            )}
            {isDesign && (
              <>
                <div className="form-grid">
                  <Field label="Good items per design run">
                    {input('yield', 'number', true)}
                  </Field>
                  <Field label="Labor minutes per run">
                    {input('laborMinutes', 'number', true)}
                  </Field>
                  <Field label="Configured hourly labor cost">
                    {input('laborRate', 'number', true)}
                  </Field>
                  <Field label="Other configured cost per run">
                    {input('overhead', 'number', true)}
                  </Field>
                </div>
                <h3>Materials & packaging</h3>
                {lines.map((line, index) => (
                  <div className="form-grid workflow-line" key={index}>
                    <Field label={`Material ${index + 1}`}>
                      <select
                        value={line.ingredientId}
                        required
                        onChange={(e) => {
                          const input = workspace.ingredients.find(
                            (i) => i.id === e.target.value,
                          )
                          setDirty(true)
                          setLines((all) =>
                            all.map((l, n) =>
                              n === index
                                ? {
                                    ...l,
                                    ingredientId: input?.id || '',
                                    unit: input?.unit || 'each',
                                  }
                                : l,
                            ),
                          )
                        }}
                      >
                        <option value="">Choose material…</option>
                        {workspace.ingredients
                          .filter(
                            (i) =>
                              ['material', 'packaging'].includes(i.usedAs) &&
                              i.trackInventory !== false,
                          )
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label={`Quantity ${index + 1}`}>
                      <input
                        type="text"
                        required
                        value={line.quantity}
                        onChange={(e) => {
                          setDirty(true)
                          setLines((all) =>
                            all.map((l, n) =>
                              n === index
                                ? { ...l, quantity: e.target.value }
                                : l,
                            ),
                          )
                        }}
                      />
                    </Field>
                    {isFabric(
                      workspace.ingredients.find(
                        (i) => i.id === line.ingredientId,
                      ),
                    ) && (
                      <>
                        <Field label={`Minimum fabric width ${index + 1}`}>
                          <input
                            value={line.minimumWidth || ''}
                            onChange={(e) => {
                              setDirty(true)
                              setLines((all) =>
                                all.map((l, n) =>
                                  n === index
                                    ? {
                                        ...l,
                                        minimumWidth: e.target.value,
                                        widthUnit: l.widthUnit || 'in',
                                      }
                                    : l,
                                ),
                              )
                            }}
                          />
                        </Field>
                        <Field label={`Width unit ${index + 1}`}>
                          <select
                            value={line.widthUnit || 'in'}
                            onChange={(e) => {
                              setDirty(true)
                              setLines((all) =>
                                all.map((l, n) =>
                                  n === index
                                    ? { ...l, widthUnit: e.target.value }
                                    : l,
                                ),
                              )
                            }}
                          >
                            {fabricUnitOptions('length').map((u) => (
                              <option key={u}>{u}</option>
                            ))}
                          </select>
                        </Field>
                      </>
                    )}
                    <Field label={`Unit ${index + 1}`}>
                      <select
                        value={line.unit}
                        onChange={(e) => {
                          setDirty(true)
                          setLines((all) =>
                            all.map((l, n) =>
                              n === index ? { ...l, unit: e.target.value } : l,
                            ),
                          )
                        }}
                      >
                        {(isFabric(
                          workspace.ingredients.find(
                            (i) => i.id === line.ingredientId,
                          ),
                        )
                          ? fabricUnitOptions(
                              workspace.ingredients.find(
                                (i) => i.id === line.ingredientId,
                              )!.fabricTracking,
                            )
                          : Object.keys(units)
                        ).map((u) => (
                          <option key={u}>{u}</option>
                        ))}
                      </select>
                    </Field>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        setDirty(true)
                        setLines((all) => all.filter((_, n) => n !== index))
                      }}
                    >
                      Remove line {index + 1}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    setDirty(true)
                    setLines((all) => [
                      ...all,
                      { ingredientId: '', quantity: 1, unit: 'each' },
                    ])
                  }}
                >
                  Add material line
                </button>
                {estimate}
                <MaterialPlan
                  design={{ ...draft, lines }}
                  workspace={workspace}
                />
              </>
            )}
            {isRun && (
              <>
                <Field label="Handmade product">
                  {select(
                    'productId',
                    workspace.products
                      .filter((p) => p.workflow === 'handmade')
                      .map((p) => ({ value: p.id, label: p.name })),
                  )}
                </Field>
                <div className="form-grid">
                  <Field label="Number of design runs">
                    {input('count', 'number', true)}
                  </Field>
                  <Field label="Planned date">
                    {input('date', 'date', true)}
                  </Field>
                </div>
              </>
            )}
            {isComplete && (
              <>
                <div className="form-grid">
                  <Field label="Completed sellable items">
                    {input('actualYield', 'number', true)}
                  </Field>
                  <Field label="Finished items wasted (not received)">
                    {input('waste', 'number', true)}
                  </Field>
                  <Field label="Actual labor minutes">
                    {input('laborMinutes', 'number', true)}
                  </Field>
                </div>
                {(design?.lines || []).map((line: Item) => (
                  <div className="form-grid" key={line.ingredientId}>
                    <Field
                      label={`${workspace.ingredients.find((i) => i.id === line.ingredientId)?.name} used (${line.unit})`}
                    >
                      <input
                        type="text"
                        value={
                          usage[line.ingredientId] ??
                          line.quantity * Number(draft.count)
                        }
                        onChange={(e) => {
                          setDirty(true)
                          setUsage((u) => ({
                            ...u,
                            [line.ingredientId]: e.target.value,
                          }))
                        }}
                      />
                    </Field>
                    <Field label={`Additional material waste (${line.unit})`}>
                      <input
                        type="text"
                        value={materialWaste[line.ingredientId] ?? 0}
                        onChange={(e) => {
                          setDirty(true)
                          setMaterialWaste((u) => ({
                            ...u,
                            [line.ingredientId]: e.target.value,
                          }))
                        }}
                      />
                    </Field>
                  </div>
                ))}
                {design && (
                  <MaterialPlan
                    design={design}
                    workspace={workspace}
                    count={Number(draft.count)}
                  />
                )}
                <Field label="Waste / adjustment explanation">
                  {input('wasteReason')}
                </Field>
                <p className="form-hint">
                  All actual input cost and configured labor/other cost is
                  allocated across good output. Waste is not counted twice.
                  Unconsumed fabric stays in stock. Transfer usable full-width
                  remnants from the fabric card in Craft Materials.
                </p>
              </>
            )}
            {(isReceive || isAdjust) && (
              <>
                <p>
                  <strong>{item?.name}</strong> · {item?.quantity || 0} items on
                  hand · {money(item?.cost || 0)} average item cost
                </p>
                <Field
                  label={
                    isReceive
                      ? 'Purchase quantity (packs/cases)'
                      : 'Signed item adjustment'
                  }
                >
                  {input('quantity', 'number', true)}
                </Field>
                {isReceive && (
                  <>
                    <div className="form-grid">
                      <Field label="Purchase unit">
                        {select(
                          'unit',
                          ['each', 'pack', 'case', 'box'].map((u) => ({
                            value: u,
                            label: u,
                          })),
                        )}
                      </Field>
                      <Field label="Items per purchase unit">
                        {input('itemsPerUnit', 'number', true)}
                      </Field>
                      <Field label="Total acquisition cost">
                        {input('price', 'number', true)}
                      </Field>
                    </div>
                    <Field label="Supplier">
                      {select(
                        'supplierId',
                        workspace.vendors.map((v) => ({
                          value: v.id,
                          label: v.name,
                        })),
                      )}
                    </Field>
                    <p className="calculation-box">
                      Receipt:{' '}
                      {Number(draft.quantity) * Number(draft.itemsPerUnit) || 0}{' '}
                      sellable items ·{' '}
                      {Number(draft.quantity) * Number(draft.itemsPerUnit) >
                        0 && draft.price !== ''
                        ? money(
                            Number(draft.price) /
                              (Number(draft.quantity) *
                                Number(draft.itemsPerUnit)),
                          )
                        : '—'}{' '}
                      per item for this receipt
                    </p>
                    {item && (
                      <p className="calculation-box" aria-live="polite">
                        {stockReceiptPreview(
                          workspace.products.find((p) => p.id === item.id) ||
                            item,
                          draft.quantity,
                          draft.unit,
                          draft,
                        ) ||
                          'Enter quantity and pack contents to preview the resulting stock.'}
                      </p>
                    )}
                    <p className="form-hint">
                      Enter the acquisition cost you choose to capitalize. This
                      purchase posts Inventory asset / Cash; it does not
                      reconcile an uploaded receipt or purchase order
                      automatically.
                    </p>
                  </>
                )}
                <Field label="Movement reason">
                  {input('reason', 'text', true)}
                </Field>
              </>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={dismiss}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn"
              disabled={
                busy ||
                importBusy ||
                (!isComplete && !isReceive && !isAdjust && !canManage)
              }
            >
              {busy ? 'Saving…' : isComplete ? 'Complete production' : 'Save'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MaterialPlan({
  design,
  workspace,
  count = 1,
}: {
  design: Item
  workspace: Workspace
  count?: number
}) {
  let rows: ReturnType<typeof materialPlan> = []
  let message = ''
  try {
    rows = materialPlan(design, workspace.ingredients, count)
  } catch (e) {
    message =
      e instanceof Error
        ? e.message
        : 'Complete the material lines to see the plan.'
  }
  if (message)
    return (
      <p role="status" className="form-hint">
        {message}
      </p>
    )
  return rows.length ? (
    <section className="calculation-box">
      <h3>Planned material usage</h3>
      {rows.map((row) => (
        <p key={row.id}>
          <strong>{row.name}</strong>: {row.planned} {row.enteredUnit} planned ·{' '}
          {row.available.toLocaleString('en-US', { maximumFractionDigits: 8 })}{' '}
          {row.unit} available · {money(row.cost)} estimated
          {row.shortage > 1e-9
            ? ` · Shortage: ${row.shortage.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${row.unit}`
            : ' · Stock available'}
        </p>
      ))}
    </section>
  ) : null
}

function FabricReceiptEstimate({ draft }: { draft: Item }) {
  let quantity = 0,
    cost = 0,
    incomplete = false
  try {
    quantity = fabricReceipt(draft, {
      ...draft,
      quantity: draft.purchaseQuantity,
      unit: draft.purchaseUnit,
    })
    cost = fabricPurchaseCost(
      { ...draft, quantity: draft.purchaseQuantity },
      draft.packagePrice,
    )
  } catch {
    incomplete = true
  }
  if (incomplete)
    return (
      <p className="form-hint">
        Enter a confirmed quantity and acquisition cost to calculate cost per
        stock unit. Fractions such as 1 1/2 are supported.
      </p>
    )
  return quantity > 0 && Number.isFinite(cost) ? (
    <p className="calculation-box">
      Receive {quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })}{' '}
      {draft.unit} · {money(cost / quantity)} per {draft.unit} for this
      purchase. Fractional entries such as 1 1/2 are supported.
    </p>
  ) : null
}
