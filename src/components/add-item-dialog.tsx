import { IngredientLookupTools } from './ingredient-lookup-tools'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useId,
  cloneElement,
  isValidElement,
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
import { ProductLinkImport } from './product-link-import'
import { ProductTemplateField } from './label-template-assignment'
import { InventoryProductFields } from './inventory-product-fields'
import { FabricFields, FabricPurchaseFields } from './fabric-fields'
import { ConversionEditor } from './financial-editors'
import { InventoryPackageFields } from './inventory-package-fields'
import { inventoryPackagePlan } from '@/lib/inventory-package'
import {
  activeItemDraft,
  defaultItemType,
  itemTypes,
  itemUnitOptions,
} from '@/lib/add-item'
import { ovenToday } from '@/lib/oven-dates'
import { pantryCategories } from '@/lib/pantry-category'
import { allergens, units, type Item, type Workspace } from '@/lib/domain'
import './add-item-dialog.css'
import * as Tabs from '@radix-ui/react-tabs'
import { ItemPhotoField } from './item-photo-field'
import { BarcodeScanner } from './barcode-scanner'
import {
  InventoryBarcodeReview,
  inventoryBarcodeMatches,
} from './inventory-barcode-review'

function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  return (
    <label className="field">
      <span id={id}>{label}</span>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{ 'aria-labelledby'?: string }>,
            { 'aria-labelledby': id },
          )
        : children}
    </label>
  )
}
function growTextareas(root: HTMLElement | null) {
  root?.querySelectorAll('textarea').forEach((field) => {
    if (!field.getClientRects().length) return
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight + 2}px`
  })
}
export function AddItemDialog({
  workspace,
  initialType = '',
  initialName = '',
  initialValues,
  receiptLine = false,
  onWorkspace,
  close,
  save,
  onCreated,
  onExisting,
  onDirty,
  onView,
  onReceive,
}: {
  workspace: Workspace
  initialType?: string
  initialName?: string
  initialValues?: Item
  receiptLine?: boolean
  onWorkspace: (w: Workspace) => void
  close: () => void
  save: (table: string, data: Item) => Promise<void>
  onDirty?: (dirty: boolean) => void
  onExisting?: (item: Item) => void
  onCreated?: (id: string, table: string) => void
  onView?: (item: Item, table: string) => void
  onReceive?: (item: Item) => void
}) {
  const [type, setType] = useState(defaultItemType(initialType) || initialType)
  const packageSetup = !receiptLine && itemTypes.some(([key]) => key === type)
  const [shared, setShared] = useState<Record<string, Item[string]>>(() => ({
    id: crypto.randomUUID(),
    creationRequestId: crypto.randomUUID(),
    name: initialName,
    barcode: initialValues?.barcode || '',
    barcodeFormat: initialValues?.barcodeFormat || '',
    threshold: 0,
    receivedDate: ovenToday(workspace.settings[0]),
    initialStock: false,
    stockAction: 'opening',
    packagePrice: '',
    purchaseQuantity: '',
  }))
  const [drafts, setDrafts] = useState<
    Record<string, Record<string, Item[string]>>
  >({})
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [importBusy, setImportBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    onDirty?.(dirty)
    return () => onDirty?.(false)
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
  const saving = useRef(false)
  const [scanner, setScanner] = useState(false),
    [reviewVersion, setReviewVersion] = useState(0)
  const [tab, setTab] = useState('details')
  const [method, setMethod] = useState('manual')
  const [errorTabs, setErrorTabs] = useState<string[]>([])
  const formRef = useRef<HTMLFormElement>(null)
  useLayoutEffect(() => {
    growTextareas(formRef.current)
  })
  const returnFocus = useRef<HTMLElement | null>(
    typeof document === 'undefined'
      ? null
      : (document.activeElement as HTMLElement | null),
  )
  const scanned = useRef(false)
  useEffect(() => () => returnFocus.current?.focus({ preventScroll: true }), [])
  const subtype = drafts.material?.materialType || 'other'
  const draftKey = type === 'material' ? `material:${subtype}` : type
  const defaults = {
    unit:
      type === 'ingredient'
        ? 'g'
        : subtype === 'fabric' && type === 'material'
          ? 'yd'
          : 'each',
    purchaseUnit:
      type === 'ingredient'
        ? 'g'
        : subtype === 'fabric' && type === 'material'
          ? 'yd'
          : 'each',
    categoryId: type === 'ingredient' ? 'flour-grains' : '',
    fabricTracking: 'length',
    pieceMode: 'aggregate',
    widthUnit: 'in',
    materialType: subtype,
    price: '',
    foodClass: '',
    itemsPerUnit: '',
    contentsUnit: 'each',
    ...(type === 'resale'
      ? {
          stockChoice: 'none',
          sellUnit: '',
          countMethod: 'direct',
          costBasis: 'unit',
        }
      : {}),
    ...(packageSetup
      ? {
          purchaseUnit: '',
          packagePrice: '',
          initialStock: false,
          stockAction: 'opening',
          openingCount: '',
          openingCountUnit: '',
          openingValueOverride: false,
        }
      : {}),
  }
  const specific = { ...defaults, ...drafts[draftKey] }
  const value = {
    ...shared,
    ...specific,
    usedAs: type,
    inventoryCreation: true,
    ...(type === 'resale' ? { workflow: 'resale' } : {}),
  } as unknown as Item
  const sharedKeys = [
    'name',
    'brand',
    'vendorId',
    'vendor',
    'sku',
    'barcode',
    'barcodeFormat',
    'imageAssetId',
    'storageLocation',
    'notes',
    'threshold',
    'receivedDate',
    'purchaseDate',
    'receiptReference',
    'initialStock',
    'stockAction',
    'referenceQuantity',
    'referencePrice',
    'packagePrice',
    'purchaseQuantity',
    'productSourceUrl',
    'productRequestedUrl',
    'listedOnlinePrice',
    'productCheckedAt',
    'currency',
  ]
  function change(key: string, v: Item[string]) {
    setDirty(true)
    if (key === 'materialType')
      setDrafts((d) => ({ ...d, material: { ...d.material, materialType: v } }))
    else if (
      sharedKeys.includes(key) &&
      !(packageSetup && ['initialStock', 'packagePrice'].includes(key))
    )
      setShared((d) => ({ ...d, [key]: v }))
    else setDrafts((d) => ({ ...d, [draftKey]: { ...d[draftKey], [key]: v } }))
  }
  function dismiss() {
    if (
      !busy &&
      !importBusy &&
      (!dirty || window.confirm('Discard unsaved item changes?'))
    )
      close()
  }
  const input = (key: string, kind = 'text', required = false) => (
    <input
      type={kind}
      step={kind === 'number' ? 'any' : undefined}
      value={value[key] ?? ''}
      required={required}
      onChange={(e) => change(key, e.target.value)}
    />
  )
  const select = (key: string, options: readonly string[]) => (
    <select
      value={value[key] || ''}
      onChange={(e) => change(key, e.target.value)}
    >
      {options.map((u) => (
        <option key={u}>{u}</option>
      ))}
    </select>
  )
  const food =
    type === 'ingredient' || (type === 'resale' && value.foodClass === 'food')
  const existingProduct =
    type === 'resale'
      ? workspace.products.find(
          (p) => p.id === value.existingProductId && p.workflow === 'resale',
        )
      : undefined
  const allowedUnits = itemUnitOptions(type, subtype)
  if (scanner)
    return (
      <BarcodeScanner
        onClose={() => setScanner(false)}
        onCode={(code, format) => {
          change('barcode', code)
          change('barcodeFormat', format || '')
          setReviewVersion((v) => v + 1)
          setScanner(false)
        }}
      />
    )
  const specificLabel = food
    ? 'Ingredients & allergens'
    : type === 'material' && subtype === 'fabric'
      ? 'Fabric'
      : type === 'material' && subtype === 'yarn'
        ? 'Yarn'
        : ''
  const tabs = [
    ['details', 'Details'],
    ...(type === 'resale' ? [['labels', 'Images & Labels']] : []),
    ['purchase', 'Purchase & Stock'],
    ['more', 'More'],
    ...(specificLabel ? [['specific', specificLabel]] : []),
  ]
  function switchTab(next: string) {
    setTab(next)
  }
  const panel = (id: string, children: ReactNode) => (
    <Tabs.Content
      key={id}
      value={id}
      forceMount
      hidden={tab !== id}
      data-item-tab={id}
      className="add-item-tab-panel"
    >
      {children}
    </Tabs.Content>
  )
  const hasCatalog = ['ingredient', 'packaging', 'supply'].includes(type)
  const applyImport = (patch: Record<string, Item[string]>) => {
    for (const [key, v] of Object.entries(patch)) change(key, v)
  }
  const barcodeLookup = (
    <InventoryBarcodeReview
      compact
      inline={type === 'ingredient'}
      key={reviewVersion}
      workspace={workspace}
      code={String(shared.barcode || '')}
      format={String(shared.barcodeFormat || '') || undefined}
      change={(code) => change('barcode', code)}
      onScan={() => {
        scanned.current = true
        setScanner(true)
      }}
      autoSearch={reviewVersion > 0}
      receiptLine={receiptLine}
      onView={onView}
      onReceive={onReceive}
      onUse={(id, table) => {
        onCreated?.(id, table)
        close()
      }}
      onManual={() => {
        setMethod('manual')
        requestAnimationFrame(() =>
          formRef.current
            ?.querySelector<HTMLInputElement>('[data-item-name]')
            ?.focus(),
        )
      }}
      onUrl={() => setMethod('url')}
    />
  )

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss()
      }}
    >
      <DialogContent
        className="app-dialog add-item-dialog"
        overlayClassName="add-item-overlay"
        presentation="detail"
        onOpenAutoFocus={(event) => {
          if (scanned.current) {
            event.preventDefault()
            requestAnimationFrame(() =>
              formRef.current
                ?.querySelector<HTMLInputElement>('.barcode-entry-result input')
                ?.focus(),
            )
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus.current?.focus({ preventScroll: true })
        }}
      >
        <div className="add-item-surface">
          <DialogHeader>
            <DialogTitle>Add Item</DialogTitle>
            <DialogDescription>
              {receiptLine
                ? 'Item details for this receipt line.'
                : 'Item details, package cost, and an optional count of stock you already own.'}
            </DialogDescription>
          </DialogHeader>
          <form
            ref={formRef}
            noValidate
            onSubmit={async (event) => {
              event.preventDefault()
              if (saving.current || importBusy || busy) return
              const invalid = Array.from(
                event.currentTarget.querySelectorAll<
                  HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
                >('input,select,textarea'),
              ).filter((field) => !field.validity.valid)
              if (invalid.length) {
                const sections = invalid.map(
                  (field) =>
                    field.closest<HTMLElement>('[data-item-tab]')?.dataset
                      .itemTab || 'details',
                )
                setErrorTabs([...new Set(sections)])
                setTab(sections[0])
                const field = invalid[0]
                field.closest('details')?.setAttribute('open', '')
                setError('Check the highlighted fields before saving.')
                requestAnimationFrame(() => {
                  field.focus()
                  field.reportValidity()
                })
                return
              }
              setErrorTabs([])
              saving.current = true
              setBusy(true)
              setError('')
              try {
                if (!itemTypes.some(([key]) => key === type))
                  throw new Error('Choose an Item Type.')
                if (existingProduct) {
                  onCreated?.(existingProduct.id, 'products')
                  close()
                  onExisting?.(existingProduct)
                  return
                }
                const data = activeItemDraft(shared, {
                  ...specific,
                  usedAs: type,
                }) as unknown as Item
                const table = type === 'resale' ? 'products' : 'ingredients'
                if (packageSetup) {
                  data.inventoryPackageSetup = true
                  inventoryPackagePlan(data)
                }
                if (type === 'resale') delete data.stockChoice
                if (
                  data.barcode &&
                  inventoryBarcodeMatches(
                    workspace,
                    String(data.barcode),
                    data.barcodeFormat,
                  ).length
                ) {
                  setReviewVersion((v) => v + 1)
                  throw new Error(
                    'An existing item uses this barcode. Select View Item or Receive Stock instead of creating a duplicate.',
                  )
                }
                await save(table, data)
                onCreated?.(data.id, table)
                close()
              } catch (e) {
                const message = (e as Error).message
                setError(message)
                const section = /barcode/i.test(message)
                  ? 'details'
                  : /selling price|material subtype|category|photo|name/i.test(
                        message,
                      )
                    ? 'details'
                    : /fabric|piece|width|yarn/i.test(message)
                      ? 'specific'
                      : /ingredient statement|allergen|supplier.*review/i.test(
                            message,
                          )
                        ? 'specific'
                        : /reorder|threshold|sku|storage|specification/i.test(
                              message,
                            )
                          ? 'more'
                          : /purchase|supplier|pack|stock|opening|count|quantity|cost|price|unit|date|length|conversion/i.test(
                                message,
                              )
                            ? 'purchase'
                            : 'details'
                const target =
                  section === 'specific' && !specificLabel ? 'details' : section
                setTab(target)
                setErrorTabs([target])
                if (/barcode/i.test(message)) setMethod('barcode')
                requestAnimationFrame(() => {
                  const fields = Array.from(
                    formRef.current?.querySelectorAll<HTMLElement>(
                      `[data-item-tab="${target}"] input,[data-item-tab="${target}"] select,[data-item-tab="${target}"] textarea`,
                    ) || [],
                  )
                  const field = /name/i.test(message)
                    ? formRef.current?.querySelector<HTMLElement>(
                        '[data-item-name]',
                      )
                    : fields.find((node) => node.getClientRects().length > 0)
                  field?.focus()
                })
              } finally {
                saving.current = false
                setBusy(false)
              }
            }}
          >
            <div className="add-item-body">
              <Field label="Item Type">
                <select
                  required
                  value={type}
                  onChange={(e) => {
                    setDirty(true)
                    setType(e.target.value)
                    setTab('details')
                    setError('')
                    setErrorTabs([])
                  }}
                >
                  <option value="">Choose an item type…</option>
                  {itemTypes.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              {type && (
                <Tabs.Root value={tab} onValueChange={switchTab}>
                  <Tabs.List
                    className="add-item-tabs"
                    aria-label="Item sections"
                  >
                    {tabs
                      .filter(([id]) => !existingProduct || id === 'details')
                      .map(([id, label]) => (
                        <Tabs.Trigger key={id} value={id}>
                          {label}
                          {errorTabs.includes(id) && (
                            <span
                              className="add-item-tab-error"
                              aria-label="has errors"
                            >
                              !
                            </span>
                          )}
                        </Tabs.Trigger>
                      ))}
                  </Tabs.List>
                  {panel(
                    'details',
                    <>
                      {!hasCatalog && (
                        <div
                          className="add-item-methods"
                          role="group"
                          aria-label="Entry method"
                        >
                          {['manual', 'barcode', 'url'].map((entry) => (
                            <button
                              key={entry}
                              type="button"
                              aria-pressed={method === entry}
                              disabled={importBusy}
                              onClick={() => setMethod(entry)}
                            >
                              {entry === 'url'
                                ? 'URL'
                                : entry === 'barcode'
                                  ? 'Barcode'
                                  : 'Manual'}
                            </button>
                          ))}
                        </div>
                      )}
                      {!hasCatalog && (
                        <div hidden={method !== 'barcode'}>{barcodeLookup}</div>
                      )}
                      <div
                        className={
                          hasCatalog ? 'add-ingredient-lookups' : undefined
                        }
                        hidden={!hasCatalog && method !== 'url'}
                      >
                        <ProductLinkImport
                          compact
                          afterLookup={
                            hasCatalog
                              ? (selectUrl) => (
                                  <IngredientLookupTools
                                    key={type + reviewVersion}
                                    draft={value}
                                    workspace={workspace}
                                    apply={applyImport}
                                    onScan={() => {
                                      scanned.current = true
                                      setScanner(true)
                                    }}
                                    autoSearch={reviewVersion > 0}
                                    packageSetup={packageSetup}
                                    onSourceUrl={selectUrl}
                                  />
                                )
                              : undefined
                          }
                          populateDraft={type === 'ingredient'}
                          packageSetup={packageSetup}
                          vendors={workspace.vendors}
                          key={type + subtype}
                          settings={workspace.settings[0]}
                          draft={value}
                          onWorkspace={onWorkspace}
                          onBusyChange={setImportBusy}
                          apply={(patch) => {
                            for (const [key, v] of Object.entries(patch))
                              if (
                                ![
                                  'usedAs',
                                  'workflow',
                                  'materialType',
                                  'categoryId',
                                  'fabricTracking',
                                ].includes(key)
                              )
                                change(key, v)
                          }}
                        />
                      </div>
                      {type === 'resale' && (
                        <Field label="Resale product / variant">
                          <select
                            value={value.existingProductId || ''}
                            onChange={(e) =>
                              change('existingProductId', e.target.value)
                            }
                          >
                            <option value="">
                              Create a new resale product / variant
                            </option>
                            {workspace.products
                              .filter((p) => p.workflow === 'resale')
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                  {p.variant ? ` · ${p.variant}` : ''}
                                </option>
                              ))}
                          </select>
                        </Field>
                      )}
                      {existingProduct ? (
                        <p>
                          {receiptLine
                            ? 'Selects the existing item without posting stock.'
                            : 'Continue to Receive Stock for this existing product.'}
                        </p>
                      ) : (
                        <>
                          <div className="add-item-details-grid">
                            <div className="add-item-basics">
                              <Field label="Item name">
                                <input
                                  data-item-name
                                  value={value.name || ''}
                                  required
                                  onChange={(e) =>
                                    change('name', e.target.value)
                                  }
                                />
                              </Field>
                              {type === 'material' && (
                                <Field label="Material Subtype">
                                  <select
                                    value={subtype}
                                    onChange={(e) =>
                                      change('materialType', e.target.value)
                                    }
                                  >
                                    <option value="fabric">Fabric</option>
                                    <option value="yarn">Yarn</option>
                                    <option value="other">
                                      Other craft material
                                    </option>
                                  </select>
                                </Field>
                              )}
                              <div className="form-grid">
                                {type === 'ingredient' && (
                                  <Field label="Category">
                                    <select
                                      value={value.categoryId}
                                      onChange={(e) =>
                                        change('categoryId', e.target.value)
                                      }
                                    >
                                      {pantryCategories
                                        .filter(
                                          (c) =>
                                            ![
                                              'packaging',
                                              'supplies',
                                              'craft-materials',
                                            ].includes(c.value),
                                        )
                                        .map((c) => (
                                          <option key={c.value} value={c.value}>
                                            {c.label}
                                          </option>
                                        ))}
                                    </select>
                                  </Field>
                                )}
                                {type === 'resale' && (
                                  <>
                                    <Field label="Product category">
                                      <select
                                        value={value.productCategoryId || ''}
                                        onChange={(e) =>
                                          change(
                                            'productCategoryId',
                                            e.target.value,
                                          )
                                        }
                                      >
                                        <option value="">Uncategorized</option>
                                        {(
                                          workspace.settings[0]
                                            ?.productCategories || []
                                        )
                                          .filter(
                                            (c: Item) => c.active !== false,
                                          )
                                          .map((c: Item) => (
                                            <option key={c.id} value={c.id}>
                                              {c.name}
                                            </option>
                                          ))}
                                      </select>
                                    </Field>
                                    <Field label="Food classification">
                                      <select
                                        value={value.foodClass || ''}
                                        onChange={(e) =>
                                          change('foodClass', e.target.value)
                                        }
                                      >
                                        <option value="">Not specified</option>
                                        <option value="food">Food</option>
                                        <option value="non-food">
                                          Non-food
                                        </option>
                                      </select>
                                    </Field>
                                    <Field label="Variant (optional)">
                                      {input('variant')}
                                    </Field>
                                    <Field label="Selling price">
                                      {input('price', 'number')}
                                    </Field>
                                  </>
                                )}

                                <Field label="Brand">{input('brand')}</Field>
                              </div>
                            </div>
                            <ItemPhotoField
                              value={value}
                              assets={workspace.graphic_assets || []}
                              kind={type === 'resale' ? 'product' : 'pantry'}
                              disabled={busy || importBusy}
                              onChange={change}
                              onWorkspace={onWorkspace}
                              onBusy={setBusy}
                              onError={setError}
                            />
                          </div>
                        </>
                      )}
                    </>,
                  )}
                  {!existingProduct &&
                    type === 'resale' &&
                    panel(
                      'labels',
                      <ProductTemplateField
                        value={value}
                        workspace={workspace}
                        change={change}
                      />,
                    )}
                  {!existingProduct &&
                    panel(
                      'purchase',
                      packageSetup ? (
                        <InventoryPackageFields
                          value={value}
                          change={change}
                          workspace={workspace}
                        />
                      ) : (
                        <>
                          <div className="form-grid">
                            <Field label="Supplier / vendor">
                              <select
                                value={value.vendorId || ''}
                                onChange={(e) =>
                                  change('vendorId', e.target.value)
                                }
                              >
                                <option value="">Not set</option>
                                {workspace.vendors.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            <Field label="Stock / display unit">
                              {type === 'resale' ? (
                                <input value="each" readOnly />
                              ) : (
                                select(
                                  'unit',
                                  allowedUnits.filter(
                                    (u) => units[u]?.factor > 0,
                                  ),
                                )
                              )}
                            </Field>
                          </div>
                          <div className="form-grid">
                            <Field label="Purchase unit">
                              {select('purchaseUnit', allowedUnits)}
                            </Field>
                            {['pack', 'case', 'box', 'bundle', 'roll'].includes(
                              value.purchaseUnit,
                            ) &&
                              !(
                                type === 'material' && subtype === 'fabric'
                              ) && (
                                <>
                                  <Field label="Confirmed contents per package">
                                    {input('itemsPerUnit', 'number')}
                                  </Field>
                                  <Field label="Contents unit">
                                    {select(
                                      'contentsUnit',
                                      type === 'resale' || type === 'packaging'
                                        ? ['each']
                                        : allowedUnits.filter(
                                            (u) =>
                                              ![
                                                'pack',
                                                'case',
                                                'box',
                                                'bundle',
                                                'roll',
                                              ].includes(u),
                                          ),
                                    )}
                                  </Field>
                                  <label className="check-label">
                                    <input
                                      type="checkbox"
                                      checked={
                                        value.packageContentsConfirmed === true
                                      }
                                      onChange={(e) =>
                                        change(
                                          'packageContentsConfirmed',
                                          e.target.checked,
                                        )
                                      }
                                    />
                                    I verified the contents of each purchased
                                    package.
                                  </label>
                                </>
                              )}
                            {type === 'material' &&
                              subtype === 'fabric' &&
                              (value.initialStock ||
                                (value.referencePrice != null &&
                                  value.referencePrice !== '')) && (
                                <FabricPurchaseFields
                                  value={value}
                                  change={change}
                                />
                              )}
                            {!value.initialStock && (
                              <>
                                <Field label="Reference package quantity (optional)">
                                  {input('referenceQuantity', 'number')}
                                </Field>
                                <Field label="Reference package cost (optional; no stock or payment)">
                                  {input('referencePrice', 'number')}
                                </Field>
                              </>
                            )}
                          </div>
                          {receiptLine ? (
                            <p>
                              Save item details here. Stock and accounting are
                              posted once when you confirm the receipt.
                            </p>
                          ) : (
                            <label className="check-label">
                              <input
                                type="checkbox"
                                checked={value.initialStock === true}
                                onChange={(e) =>
                                  change('initialStock', e.target.checked)
                                }
                              />
                              Add opening stock / record a purchase now.
                            </label>
                          )}
                          {value.initialStock && !receiptLine && (
                            <>
                              <div className="form-grid">
                                <Field label="Stock entry type">
                                  <select
                                    value={value.stockAction}
                                    onChange={(e) =>
                                      change('stockAction', e.target.value)
                                    }
                                  >
                                    <option value="opening">
                                      Opening balance
                                    </option>
                                    <option value="purchase">
                                      Purchase receipt
                                    </option>
                                  </select>
                                </Field>
                                <Field label="Quantity received">
                                  {input('purchaseQuantity', 'number', true)}
                                </Field>
                                <Field
                                  label={
                                    value.stockAction === 'opening'
                                      ? 'Opening stock value'
                                      : 'Actual purchase cost'
                                  }
                                >
                                  {input('packagePrice', 'number', true)}
                                </Field>
                                <Field label="Received date">
                                  {input('receivedDate', 'date', true)}
                                </Field>
                                {value.stockAction === 'purchase' && (
                                  <Field label="Purchase date (optional)">
                                    {input('purchaseDate', 'date')}
                                  </Field>
                                )}
                                <Field label="Supplier receipt reference">
                                  {input('receiptReference')}
                                </Field>
                              </div>
                              <p className="form-hint">
                                {value.stockAction === 'opening'
                                  ? 'Opening stock posts to owner equity.'
                                  : 'A purchase records inventory and payment.'}
                              </p>
                              {Number(value.purchaseQuantity) > 0 &&
                                Number(value.itemsPerUnit) > 0 &&
                                value.contentsUnit === 'each' && (
                                  <p>
                                    Cost per usable item:{' '}
                                    {(
                                      Number(value.packagePrice) /
                                      (Number(value.purchaseQuantity) *
                                        Number(value.itemsPerUnit))
                                    ).toFixed(4)}
                                  </p>
                                )}
                            </>
                          )}

                          {food && (
                            <div className="form-grid">
                              <Field label="Lot (optional)">
                                {input('lot')}
                              </Field>
                              <Field label="Expiry (optional)">
                                {input('expires', 'date')}
                              </Field>
                            </div>
                          )}
                        </>
                      ),
                    )}
                  {!existingProduct &&
                    panel(
                      'more',
                      <>
                        <div className="form-grid">
                          <Field label="SKU">{input('sku')}</Field>
                          <Field label="Barcode">{input('barcode')}</Field>
                          <Field label="Storage location">
                            {input('storageLocation')}
                          </Field>
                          <Field label="Reorder threshold">
                            {input('threshold', 'number')}
                          </Field>
                        </div>
                        <Field label="Notes">
                          <textarea
                            rows={2}
                            value={value.notes || ''}
                            onChange={(e) => change('notes', e.target.value)}
                          />
                        </Field>
                        <InventoryProductFields
                          typeAware
                          value={value}
                          change={change}
                        />
                        {type === 'ingredient' && (
                          <details>
                            <summary>Verified density / conversions</summary>
                            <ConversionEditor
                              ingredient={{ ...value, id: 'preview' }}
                              from={value.purchaseUnit}
                              onSave={async (c) =>
                                change('conversions', [
                                  ...(value.conversions || []),
                                  c,
                                ])
                              }
                            />
                          </details>
                        )}
                      </>,
                    )}
                  {!existingProduct &&
                    specificLabel &&
                    panel(
                      'specific',
                      <>
                        {food && (
                          <>
                            <div className="form-grid">
                              {[
                                ['statement', 'Ingredient statement'],
                                ['subingredients', 'Subingredients'],
                                ['sourceContains', 'Source Contains statement'],
                                [
                                  'sourceMayContain',
                                  'May contain / facility statement',
                                ],
                              ].map(([key, label]) => (
                                <Field key={key} label={label}>
                                  {input(key)}
                                </Field>
                              ))}
                            </div>
                            <fieldset className="add-item-allergens">
                              <legend>Supplier-declared allergens</legend>
                              {allergens.map((a) => (
                                <label className="check-label" key={a}>
                                  <input
                                    type="checkbox"
                                    checked={(value.allergens || []).includes(
                                      a,
                                    )}
                                    onChange={(e) =>
                                      change(
                                        'allergens',
                                        e.target.checked
                                          ? [...(value.allergens || []), a]
                                          : value.allergens.filter(
                                              (v: string) => v !== a,
                                            ),
                                      )
                                    }
                                  />
                                  {a}
                                </label>
                              ))}
                            </fieldset>
                            <label className="check-label">
                              <input
                                type="checkbox"
                                checked={value.reviewed === true}
                                onChange={(e) =>
                                  change('reviewed', e.target.checked)
                                }
                              />
                              I reviewed the supplier’s ingredient and allergen
                              information.
                            </label>
                          </>
                        )}
                        {type === 'material' && subtype === 'fabric' && (
                          <FabricFields
                            compact
                            packageSetup={packageSetup}
                            value={value}
                            change={change}
                          />
                        )}
                        {type === 'material' && subtype === 'yarn' && (
                          <div className="form-grid">
                            <Field label="Yarn weight (separate from length)">
                              {input('yarnWeight')}
                            </Field>
                            <Field label="Yarn weight unit">
                              {select('yarnWeightUnit', [
                                'g',
                                'oz',
                                'lb',
                                'kg',
                              ])}
                            </Field>
                            <Field label="Yarn length">
                              {input('yarnLength')}
                            </Field>
                            <Field label="Yarn length unit">
                              {select('yarnLengthUnit', ['yd', 'm', 'ft'])}
                            </Field>
                            <Field label="Color">{input('color')}</Field>
                            <Field label="Dye lot (optional)">
                              {input('dyeLot')}
                            </Field>
                          </div>
                        )}
                      </>,
                    )}
                </Tabs.Root>
              )}
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
            </div>
            <footer className="add-item-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={busy || importBusy}
                onClick={dismiss}
              >
                Cancel
              </button>
              <button className="btn" disabled={busy || importBusy || !type}>
                {busy
                  ? 'Saving…'
                  : existingProduct
                    ? 'Use existing product'
                    : 'Save item'}
              </button>
            </footer>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
