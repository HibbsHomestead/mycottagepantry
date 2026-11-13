import { IngredientPurchaseSetup } from './ingredient-purchase-setup'
import {
  applyPurchaseSetup,
  purchaseSetupView,
  validateConversions,
} from '@/lib/purchase-setup'
import { IngredientLookupTools } from './ingredient-lookup-tools'
import { ItemDetailHeader, ItemDetailLayout } from './item-detail-layout'
import { IngredientCostCards } from './ingredient-cost-cards'
import { foodProduct } from '@/lib/inventory-product'
import { ovenToday } from '@/lib/oven-dates'
import { InventoryProductFields } from './inventory-product-fields'
import {
  isPackaging,
  pantryCategories,
  pantryCategoryId,
  selectPantryCategory,
} from '@/lib/pantry-category'
import { BarcodeScanner } from './barcode-scanner'
import { ProductLinkImport } from './product-link-import'
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { ConversionEditor, CustomCountUnit } from './financial-editors'
import {
  allergens,
  convert,
  ingredientUnits,
  unitLabel,
  parseQuantity,
  money,
  type Item,
  type Workspace,
} from '@/lib/domain'
import {
  affectedRecipes,
  compareOffer,
  duplicateBarcodes,
  packageCost,
  hasPurchasePackage,
  precise,
  stockStatus,
} from '@/lib/ingredients'
import './ingredient-detail.css'
import { PantryPhoto } from './pantry-photo'
import { ItemPhotoField } from './item-photo-field'
import { editActionLabel } from '@/lib/item-actions'
import { inventoryMovementView } from '@/lib/inventory-adjustment'
import {
  changeStockShelfUnit,
  ingredientHasStockHistory,
  prepareStockUnitBasis,
  stockUnitNeedsNewBasis,
} from '@/lib/ingredient-stock-unit'
function Measure({ children }: { children: () => ReactNode }) {
  try {
    return <>{children()}</>
  } catch (e) {
    return <span className="warning-text">{(e as Error).message}</span>
  }
}
export function PackageSummary({
  ingredient,
  offer = ingredient,
  onAdd,
  editing = false,
}: {
  ingredient: Item
  offer?: any
  onAdd?: () => void
  editing?: boolean
}) {
  if (!hasPurchasePackage(offer))
    return editing ? null : (
      <div className="calculation-box">
        <p>Purchase package details not set.</p>
        {onAdd && (
          <button className="text-button" onClick={onAdd}>
            Add purchase details
          </button>
        )}
      </div>
    )
  return (
    <div className="calculation-box">
      <Measure>
        {() => {
          const p = packageCost(ingredient, offer)
          return (
            <strong>
              {precise(Number(offer.purchaseQuantity ?? offer.packageQuantity))}{' '}
              {offer.purchaseUnit} for{' '}
              {offer.currency || ingredient.currency || 'USD'}{' '}
              {precise(Number(offer.packagePrice))} → {precise(p.contents)}{' '}
              {p.unit} → {precise(p.unitCost)} per {p.unit}
            </strong>
          )
        }}
      </Measure>
    </div>
  )
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}
export function IngredientDetail({
  ingredient: i,
  workspace: w,
  canEdit,
  close,
  open,
  save,
  onWorkspace,
  initialEditing = false,
}: {
  isOwner?: boolean
  initialEditing?: boolean
  ingredient: Item
  workspace: Workspace
  canEdit: boolean
  close: () => void
  open: (kind: string, item?: Item) => void
  save: (action: string, data: any) => Promise<void>
  onWorkspace: (w: Workspace) => void
}) {
  const [editTab, setEditTab] = useState('details')
  const [scanning, setScanning] = useState(false)
  const [editing, setEditing] = useState(false),
    [offerEdit, setOfferEdit] = useState<any>(null),
    [draft, setDraft] = useState<any>({}),
    [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState<null | (() => void)>(null),
    [reference, setReference] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [showAll, setShowAll] = useState(false),
    [importBusy, setImportBusy] = useState(false)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const contentRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const discardRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement
  }, [])
  useLayoutEffect(() => {
    if (initialEditing) edit()
    else setEditing(false)
    setOfferEdit(null)
    setDirty(false)
    setDiscard(null)
    setReference(null)
    setError('')
    setShowAll(false)
    if (contentRef.current) contentRef.current.scrollTop = 0
    closeRef.current?.focus({ preventScroll: true })
  }, [i.id])
  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0
  }, [editing, offerEdit])
  useLayoutEffect(() => {
    if (!discard) return
    if (contentRef.current) contentRef.current.scrollTop = 0
    discardRef.current?.focus({ preventScroll: true })
  }, [discard])
  const pending = useRef(false)
  const editRevision = useRef<string | undefined>(i.updatedAt)
  const referenceRevision = useRef<string | undefined>(i.updatedAt)
  const today = () => ovenToday(w.settings[0])
  const food = foodProduct(i)
  const material = i.usedAs === 'material'
  const packaging = isPackaging(editing ? draft : i)
  const storage = i.storageUnit || i.unit
  const usage = affectedRecipes(i.id, w.ingredients, w.recipes)
  const offers = i.purchaseOffers || []
  const history = w.ledger.filter((l) => l.ingredientId === i.id)
  const hasStockHistory = ingredientHasStockHistory(i, w)
  const needsStockBasis = editing && stockUnitNeedsNewBasis(i, draft)
  const units = Object.keys(ingredientUnits(draft.conversions || i.conversions))
  const guard = (next: () => void) => {
    if (busy || importBusy) return
    if (dirty) setDiscard(() => next)
    else next()
  }
  const change = (key: string, value: any) => {
    setDirty(true)
    setDraft((d: any) =>
      key === 'categoryId'
        ? selectPantryCategory(d, value, true)
        : { ...d, [key]: value },
    )
  }
  const applyImport = (patch: Record<string, Item[string]>) => {
    setDraft((old: Item) => {
      const next = { ...old, ...patch }
      if (
        ['purchaseQuantity', 'purchaseUnit', 'packagePrice'].some((key) =>
          Object.hasOwn(patch, key),
        )
      ) {
        const mapping = purchaseSetupView({
          ...next,
          purchaseSetup: undefined,
        })
        next.purchaseSetup = mapping.setup
        next.purchaseSetupReview = mapping.review || ''
        next.purchaseSetupConfirmed = false
        next.confirmEmptyStockUnitChange = false
      }
      return next
    })
    setDirty(true)
  }
  let conversionReview = ''
  try {
    validateConversions(draft.conversions || i.conversions || [])
  } catch (e) {
    conversionReview = (e as Error).message
  }
  function edit() {
    editRevision.current = i.updatedAt
    setEditTab('details')
    setDraft({
      ...i,
      openingStock: undefined,
      purchaseSetup: purchaseSetupView(i).setup,
      purchaseOffers: undefined,
      purchaseQuantity: i.purchaseQuantity ?? i.packageQuantity ?? '',
      purchaseUnit: i.purchaseUnit || '',
      packagePrice: i.packagePrice ?? '',
      recipeUnit: i.recipeUnit || storage,
      storageUnit: storage,
      currency: i.currency || 'USD',
      threshold: convert(i.threshold || 0, i.unit, storage, i.conversions),
      reorderQuantity: convert(
        i.reorderQuantity || 0,
        i.unit,
        storage,
        i.conversions,
      ),
    })
    setEditing(true)
    setOfferEdit(null)
    setDirty(false)
    setError('')
  }
  function editOffer(offer?: any) {
    editRevision.current = i.updatedAt
    setDraft(
      offer
        ? { ...offer }
        : {
            purchaseQuantity: 1,
            purchaseUnit: i.purchaseUnit || storage,
            packagePrice: '',
            currency: i.currency || 'USD',
            includesTax: i.includesTax ?? null,
            includesShipping: i.includesShipping ?? null,
            priceCheckedAt: today(),
            vendorId: w.vendors[0]?.id || '',
            allergens: [],
          },
    )
    setOfferEdit(offer || {})
    setEditing(false)
    setDirty(false)
    setError('')
  }
  async function run(action: string, data: any) {
    if (pending.current || importBusy) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await save(action, {
        ...data,
        id: i.id,
        expectedUpdatedAt:
          editing || offerEdit
            ? editRevision.current
            : data.operation === 'reference'
              ? referenceRevision.current
              : i.updatedAt,
      })
      setEditing(false)
      setOfferEdit(null)
      setDirty(false)
      setReference(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const input = (key: string, type = 'text') => (
    <input
      data-item-name={key === 'name' ? '' : undefined}
      type={type === 'number' && /quantity/i.test(key) ? 'text' : type}
      aria-label={
        key === 'purchaseQuantity'
          ? 'Purchase package quantity'
          : key === 'packagePrice'
            ? 'Package price'
            : undefined
      }
      step={type === 'number' ? 'any' : undefined}
      min={type === 'number' ? 0 : undefined}
      aria-invalid={
        key === 'purchaseQuantity'
          ? !!quantityError
          : key === 'packagePrice'
            ? !!priceError
            : undefined
      }
      value={draft[key] ?? ''}
      onChange={(e) => change(key, e.target.value)}
    />
  )
  const unitSelect = (key: string) => (
    <select
      aria-label={key === 'purchaseUnit' ? 'Purchase unit' : undefined}
      value={draft[key] || ''}
      onChange={(e) => change(key, e.target.value)}
    >
      <option value="">Choose unit</option>
      {units.map((u) => (
        <option key={u} value={u}>
          {unitLabel(u)}
        </option>
      ))}
    </select>
  )
  const check = (key: string, label: string) => (
    <label className="check-label">
      <input
        type="checkbox"
        checked={draft[key] === true}
        onChange={(e) => change(key, e.target.checked)}
      />
      {label}
    </label>
  )
  const basis = (key: string, label: string) => (
    <Field label={label}>
      <select
        value={
          draft[key] === true ? 'yes' : draft[key] === false ? 'no' : 'unknown'
        }
        onChange={(e) =>
          change(
            key,
            e.target.value === 'unknown' ? null : e.target.value === 'yes',
          )
        }
      >
        <option value="unknown">Not specified</option>
        <option value="yes">Included</option>
        <option value="no">Excluded</option>
      </select>
    </Field>
  )
  const barcodeWarnings = duplicateBarcodes(
    w.ingredients,
    String(draft.barcode || ''),
    i.id,
    offerEdit?.id,
  )
  const emptyReference =
    editing &&
    !hasPurchasePackage(i) &&
    (draft.purchaseQuantity == null || draft.purchaseQuantity === '') &&
    (draft.packagePrice == null || draft.packagePrice === '')
  const quantityError =
    !emptyReference &&
    (!Number.isFinite(parseQuantity(draft.purchaseQuantity)) ||
      parseQuantity(draft.purchaseQuantity) <= 0)
      ? 'Enter a package quantity greater than zero.'
      : ''
  const priceError =
    !emptyReference &&
    (draft.packagePrice == null ||
      draft.packagePrice === '' ||
      !Number.isFinite(Number(draft.packagePrice)) ||
      Number(draft.packagePrice) < 0)
      ? 'Enter a total package price of zero or more.'
      : ''
  const priceFields = (
    <>
      {packaging && (
        <p className="muted">
          For 100 bags purchased for $12, enter quantity 100, unit each, and
          price 12: $0.12 per bag.
        </p>
      )}
      <div className="form-grid">
        <Field label="Purchase package quantity">
          {input('purchaseQuantity', 'number')}
          {quantityError && (
            <small className="warning-text">{quantityError}</small>
          )}
        </Field>
        <div>
          <Field label="Purchase unit">{unitSelect('purchaseUnit')}</Field>
          {packaging && draft.purchaseUnit !== 'each' && (
            <p className="muted">
              Your saved unit is preserved.{' '}
              <button
                type="button"
                className="text-button"
                onClick={() => change('purchaseUnit', 'each')}
              >
                Change purchase unit to each
              </button>
              . Define verified contents first when converting a case, box,
              pack, or roll.
            </p>
          )}
        </div>
        <Field label="Package price">
          {input('packagePrice', 'number')}
          {priceError && <small className="warning-text">{priceError}</small>}
        </Field>
        <Field label="Currency">{input('currency')}</Field>
      </div>
      <p className="muted">
        {packaging
          ? 'Total price paid for the full purchase quantity above.'
          : 'Total price paid for the package amount above—not the price per oz or g.'}
      </p>
      <div className="form-grid">
        {basis('includesTax', 'Purchase tax')}
        {basis('includesShipping', 'Shipping')}
      </div>
      <PackageSummary
        ingredient={{
          ...i,
          ...(editing ? draft : {}),
          storageUnit: draft.storageUnit || storage,
        }}
        offer={draft}
        editing
      />
      <p className="muted">
        Bag, package and case contents require a verified conversion. No density
        or package contents are assumed.
      </p>
    </>
  )
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) guard(close)
      }}
    >
      {scanning && (
        <BarcodeScanner
          onCode={(raw, format) => {
            change('barcode', raw)
            if (format) change('barcodeFormat', format)
            setScanning(false)
          }}
          onClose={() => setScanning(false)}
        />
      )}
      <DialogContent
        ingredient={editing || !!offerEdit}
        className={`app-dialog ${editing || offerEdit ? 'ingredient-detail' : 'wide-dialog item-detail-dialog ingredient-detail-view'}`}
        showCloseButton={false}
        presentation={editing || offerEdit ? 'detail' : 'modal'}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          closeRef.current?.focus({ preventScroll: true })
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus.current?.focus({ preventScroll: true })
        }}
      >
        {!editing && !offerEdit ? (
          <>
            <ItemDetailHeader name={i.name}>
              {[i.brand, i.category || 'Pantry item']
                .filter(Boolean)
                .join(' · ')}{' '}
              <span className="status neutral">{stockStatus(i)}</span>
            </ItemDetailHeader>
            <button
              className="ingredient-detail-close absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden"
              onClick={() => guard(close)}
              ref={closeRef}
              aria-label={
                packaging
                  ? 'Close packaging details'
                  : 'Close ingredient details'
              }
            >
              <X size={16} />
            </button>
          </>
        ) : (
          <header className="ingredient-detail-header">
            <div className="ingredient-title-row">
              {(editing || offerEdit) && (
                <PantryPhoto
                  item={editing ? { ...i, ...draft } : i}
                  assets={w.graphic_assets}
                />
              )}
              <div>
                {!editing && !offerEdit && (
                  <div className="eyebrow">COTTAGE PANTRY · YOUR OVEN</div>
                )}
                <DialogTitle>
                  {editing ? editActionLabel(i, 'ingredients') : i.name}
                </DialogTitle>
                {editing && <p>{i.name}</p>}
                <DialogDescription>
                  {[i.brand, i.category || 'Pantry item']
                    .filter(Boolean)
                    .join(' · ')}
                  <span className="status neutral">{stockStatus(i)}</span>
                </DialogDescription>
              </div>
              <button
                className="icon-button"
                onClick={() => guard(close)}
                ref={closeRef}
                aria-label={
                  packaging
                    ? 'Close packaging details'
                    : 'Close ingredient details'
                }
              >
                <X size={22} />
              </button>
            </div>
          </header>
        )}
        <div className="ingredient-detail-body" ref={contentRef}>
          {error && (
            <p role="alert" className="warning-text">
              {error}
            </p>
          )}
          {discard && (
            <div
              className="calculation-box"
              role="alert"
              ref={discardRef}
              tabIndex={-1}
            >
              <strong>Discard unsaved changes?</strong>
              <p>
                Your saved {packaging ? 'packaging' : 'ingredient'} and stock
                remain unchanged.
              </p>
              <div className="button-row">
                <button
                  className="btn secondary"
                  onClick={() => setDiscard(null)}
                >
                  Keep editing
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    const next = discard
                    setDiscard(null)
                    setDirty(false)
                    next()
                  }}
                >
                  Discard changes
                </button>
              </div>
            </div>
          )}
          {editing || offerEdit ? (
            <form
              id="ingredient-editor"
              onSubmit={(e) => {
                e.preventDefault()
                if (
                  !editing &&
                  (quantityError ||
                    priceError ||
                    (!emptyReference && !draft.purchaseUnit))
                ) {
                  setError(
                    quantityError || priceError || 'Choose a purchase unit.',
                  )
                  if (contentRef.current) contentRef.current.scrollTop = 0
                  return
                }
                if (editing) {
                  try {
                    const basis = prepareStockUnitBasis(
                      i,
                      draft,
                      hasStockHistory,
                    )
                    applyPurchaseSetup(i, basis.input)
                  } catch (e) {
                    setError((e as Error).message)
                    setEditTab('details')
                    return
                  }
                }
                void run(
                  editing ? 'ingredientUpdate' : 'ingredientOffer',
                  editing ? draft : { operation: 'save', offer: draft },
                )
              }}
            >
              {editing ? (
                <div
                  className={`ingredient-detail-grid ingredient-tab-${editTab} ${packaging ? 'packaging-edit-grid' : 'ingredient-edit-grid'}`}
                >
                  <div
                    className="ingredient-setup-tabs"
                    aria-label="Ingredient editor sections"
                  >
                    {[
                      ['details', 'Details & Costing'],
                      ['labels', 'Images & Label Info'],
                      ['stock', 'Stock & Other Details'],
                      ['conversions', 'Unit Conversions'],
                    ].map(([key, label]) => (
                      <button
                        type="button"
                        className={editTab === key ? 'btn' : 'btn secondary'}
                        aria-pressed={editTab === key}
                        key={key}
                        onClick={() => setEditTab(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {editTab === 'conversions' && (
                    <section className="ingredient-section ingredient-conversions-tab">
                      <h3>Unit Conversions</h3>
                      {conversionReview && (
                        <p className="warning-text" role="status">
                          {conversionReview}
                        </p>
                      )}
                      <p className="form-hint">
                        Standard compatible units convert automatically. Add
                        only measured or verified ingredient-specific
                        relationships.
                      </p>
                      <p className="form-hint">
                        Primary: 1{' '}
                        {draft.purchaseSetup?.packageUnit || 'package'} ={' '}
                        {draft.purchaseSetup?.stockUnits || '…'}{' '}
                        {draft.storageUnit}.{' '}
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setEditTab('details')}
                        >
                          Edit in Details & Costing
                        </button>
                      </p>
                      {(draft.conversions || []).map(
                        (c: any, index: number) => {
                          const primary =
                            (c.from === draft.purchaseSetup?.packageUnit &&
                              c.to === draft.storageUnit) ||
                            (c.to === draft.purchaseSetup?.packageUnit &&
                              c.from === draft.storageUnit)
                          return (
                            <p key={index}>
                              {c.amountFrom} {unitLabel(c.from)} = {c.amountTo}{' '}
                              {unitLabel(c.to)} ·{' '}
                              {c.verified ? 'Reviewed' : 'Needs review'}{' '}
                              {(!primary ||
                                (draft.conversions || [])
                                  .slice(0, index)
                                  .some(
                                    (previous: any) =>
                                      (previous.from === c.from &&
                                        previous.to === c.to) ||
                                      (previous.from === c.to &&
                                        previous.to === c.from),
                                  )) && (
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() =>
                                    change(
                                      'conversions',
                                      draft.conversions.filter(
                                        (_: any, n: number) => n !== index,
                                      ),
                                    )
                                  }
                                >
                                  Remove relationship
                                </button>
                              )}
                              {primary && ' · Edit in Details & Costing'}
                            </p>
                          )
                        },
                      )}
                      <ConversionEditor
                        disclosure={false}
                        ingredient={{ ...i, ...draft, unit: i.unit }}
                        initialAmountTo=""
                        onSave={async (c) => {
                          const s = draft.purchaseSetup
                          if (
                            (c.from === s?.packageUnit &&
                              c.to === draft.storageUnit) ||
                            (c.to === s?.packageUnit &&
                              c.from === draft.storageUnit)
                          )
                            throw new Error(
                              'Edit the primary package relationship in Details & Costing.',
                            )
                          const next = [...(draft.conversions || []), c]
                          validateConversions(next)
                          // Also validate against the primary package relationship in this draft.
                          applyPurchaseSetup(i, {
                            ...draft,
                            conversions: next,
                            purchaseSetupConfirmed: !!s?.packageUnit,
                          })
                          change('conversions', next)
                          setError('')
                        }}
                      />
                      <CustomCountUnit
                        ingredient={i}
                        onSave={async (data) => {
                          if (dirty)
                            throw new Error(
                              'Save ingredient changes before adding a custom count unit.',
                            )
                          await save('unit', data)
                          setEditing(false)
                        }}
                      />
                    </section>
                  )}
                  <div className="product-link-panel ingredient-import-tools">
                    <ProductLinkImport
                      lookupPanel
                      afterLookup={(selectUrl) => (
                        <IngredientLookupTools
                          draft={draft}
                          workspace={w}
                          existing
                          onScan={
                            packaging ? () => setScanning(true) : undefined
                          }
                          onSourceUrl={selectUrl}
                          apply={applyImport}
                        />
                      )}
                      populateDraft={food}
                      vendors={w.vendors}
                      settings={w.settings[0]}
                      draft={draft}
                      existing
                      onBusyChange={setImportBusy}
                      onWorkspace={onWorkspace}
                      onVendorsChange={(vendors) =>
                        onWorkspace({ ...w, vendors })
                      }
                      apply={applyImport}
                    />
                  </div>
                  {packaging && (
                    <InventoryProductFields value={draft} change={change} />
                  )}
                  <section className="ingredient-section ingredient-edit-identification">
                    <h3>Identification</h3>
                    <div className="ingredient-edit-identity-body">
                      <div className="ingredient-edit-identity-fields">
                        <Field label={packaging ? 'Packaging name' : 'Name'}>
                          {input('name')}
                        </Field>
                        <div className="form-grid">
                          <Field label="Brand">{input('brand')}</Field>
                          <Field label="Category">
                            <select
                              aria-label="Category"
                              value={pantryCategoryId(draft) || '__custom'}
                              onChange={(e) =>
                                change('categoryId', e.target.value)
                              }
                            >
                              {!pantryCategories.some(
                                (c) => c.value === pantryCategoryId(draft),
                              ) && (
                                <option
                                  value={pantryCategoryId(draft) || '__custom'}
                                >
                                  {draft.category || 'Uncategorized'}
                                </option>
                              )}
                              {pantryCategories.map((c) => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Preferred vendor">
                            <select
                              value={
                                draft.vendorId ||
                                w.vendors.find((v) => v.name === draft.vendor)
                                  ?.id ||
                                (draft.vendor ? '__saved_vendor_name__' : '') ||
                                ''
                              }
                              onChange={(e) => {
                                change('vendorId', e.target.value || null)
                                change(
                                  'vendor',
                                  w.vendors.find((v) => v.id === e.target.value)
                                    ?.name || '',
                                )
                              }}
                            >
                              <option value="">Not set</option>
                              {draft.vendor &&
                                !draft.vendorId &&
                                !w.vendors.some(
                                  (v) => v.name === draft.vendor,
                                ) && (
                                  <option
                                    value="__saved_vendor_name__"
                                    disabled
                                  >
                                    {draft.vendor} (saved name)
                                  </option>
                                )}
                              {w.vendors.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Default barcode">
                            {input('barcode')}
                            {!packaging && (
                              <button
                                type="button"
                                className="btn secondary"
                                onClick={() => setScanning(true)}
                              >
                                Scan barcode
                              </button>
                            )}
                          </Field>
                        </div>
                        {!packaging && (
                          <Field label="Internal SKU">{input('sku')}</Field>
                        )}
                      </div>
                      <div className="ingredient-edit-identity-photo">
                        <ItemPhotoField
                          value={{ ...i, ...draft }}
                          assets={w.graphic_assets || []}
                          disabled={busy}
                          canUpload={canEdit}
                          onChange={change}
                          onWorkspace={onWorkspace}
                          onBusy={setBusy}
                          className="item-photo-control"
                          previewClassName="pantry-edit-photo"
                        />
                      </div>
                    </div>
                    {packaging && (
                      <Field label="Internal SKU">{input('sku')}</Field>
                    )}
                  </section>
                  <div className="ingredient-edit-columns">
                    <div className="ingredient-edit-primary">
                      <section className="ingredient-section">
                        <h3>Details & Costing</h3>
                        <IngredientPurchaseSetup
                          original={i}
                          draft={draft}
                          change={change}
                          conversions={() => setEditTab('conversions')}
                          changeStorage={(u) => {
                            setDraft((current: Item) => ({
                              ...current,
                              ...changeStockShelfUnit(current, u),
                            }))
                            setDirty(true)
                            setError('')
                          }}
                        />
                        {draft.stockUnitChangeNotice && (
                          <p className="form-hint" role="status">
                            {draft.stockUnitChangeNotice}
                          </p>
                        )}
                        {(draft.threshold === '' ||
                          draft.reorderQuantity === '') && (
                          <p className="form-hint warning-text">
                            Re-enter the reorder threshold and reorder quantity
                            in {unitLabel(draft.storageUnit)} under Stock &
                            Other Details. Their previous amounts could not be
                            converted.
                          </p>
                        )}
                        {needsStockBasis &&
                          (hasStockHistory ? (
                            <div
                              className="form-hint warning-text"
                              role="status"
                            >
                              <p>
                                Existing stock/history is recorded in{' '}
                                {unitLabel(i.unit)}. Saving{' '}
                                {unitLabel(draft.storageUnit)} requires a
                                measured conversion from that saved basis.
                                Entering a new net weight per jar alone does not
                                verify the old cup amount. Quantities, valuation
                                and historical records stay unchanged.
                              </p>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => setEditTab('conversions')}
                              >
                                Review stock-unit conversion
                              </button>
                              <p>
                                In Unit Conversions, enter a measured
                                relationship between the saved inventory unit
                                and the new shelf unit, cite the measurement or
                                supplier reference, and mark it verified. If
                                that relationship is unknown, keep the existing
                                item for its history and create a separate
                                weight-tracked ingredient.
                              </p>
                            </div>
                          ) : (
                            <div className="form-hint">
                              <p>
                                This item has zero stock and no stock history.
                                Confirming a new basis replaces its old package
                                relationship and recalculates the unit cost from
                                the verified package contents. No stock is
                                added.
                              </p>
                              <label className="check-label">
                                <input
                                  type="checkbox"
                                  checked={
                                    draft.confirmEmptyStockUnitChange === true
                                  }
                                  onChange={(event) =>
                                    change(
                                      'confirmEmptyStockUnitChange',
                                      event.target.checked,
                                    )
                                  }
                                />
                                I confirm the verified package contents and new
                                stock basis in {unitLabel(draft.storageUnit)}{' '}
                                for this empty item.
                              </label>
                            </div>
                          ))}
                        <Field label="Currency">{input('currency')}</Field>
                        <div className="form-grid">
                          {basis('includesTax', 'Purchase tax')}
                          {basis('includesShipping', 'Shipping')}
                        </div>
                        {packaging ? (
                          <p className="calculation-box">
                            Changing a package price updates current estimates
                            for{' '}
                            {usage.length
                              ? usage.map((r) => r.name).join(', ')
                              : 'no existing recipes'}
                            . Stock balances, inventory valuation, historical
                            purchases and completed batches remain unchanged.
                            Use Adjust stock to correct quantities.
                          </p>
                        ) : (
                          <p className="muted">
                            Package prices update current recipe estimates.
                            Stock, valuation and completed batches stay
                            unchanged. Use Adjust stock to correct quantities.
                          </p>
                        )}
                      </section>
                      {!packaging && (
                        <section className="ingredient-section ingredient-edit-usage">
                          <h3>Recipe usage</h3>
                          <p>
                            {usage.map((r) => r.name).join(', ') ||
                              'No recipes use this ingredient yet.'}
                          </p>
                        </section>
                      )}
                    </div>
                    <div className="ingredient-edit-secondary">
                      <section className="ingredient-section">
                        <h3>Opening stock</h3>
                        <p className="form-hint">
                          Current balance:{' '}
                          {precise(
                            convert(i.quantity, i.unit, storage, i.conversions),
                          )}{' '}
                          {unitLabel(storage)}.{' '}
                          {history.some((l) => l.type === 'opening_balance') ||
                          i.openingStockRecorded
                            ? 'Opening stock has been recorded.'
                            : history.length || Number(i.quantity) !== 0
                              ? 'Stock history already exists. Use a count or adjustment.'
                              : 'No opening stock recorded.'}
                        </p>
                        {!history.length &&
                        Number(i.quantity) === 0 &&
                        !i.openingStockRecorded ? (
                          <>
                            <label className="check-label">
                              <input
                                type="checkbox"
                                checked={draft.openingStock?.enabled === true}
                                onChange={(e) =>
                                  change('openingStock', {
                                    operationId:
                                      draft.openingStock?.operationId ||
                                      crypto.randomUUID(),
                                    quantity: '',
                                    value: '',
                                    date: today(),
                                    ...draft.openingStock,
                                    unit: storage,
                                    enabled: e.target.checked,
                                  })
                                }
                              />
                              Enter opening stock already owned
                            </label>
                            {draft.openingStock?.enabled && (
                              <>
                                <div className="form-grid">
                                  <Field
                                    label={`Opening stock quantity (${unitLabel(storage)})`}
                                  >
                                    <input
                                      type="number"
                                      step="any"
                                      min="0.000001"
                                      required
                                      value={draft.openingStock.quantity}
                                      onChange={(e) =>
                                        change('openingStock', {
                                          ...draft.openingStock,
                                          quantity: e.target.value,
                                        })
                                      }
                                    />
                                  </Field>
                                  <Field label="Inventory unit">
                                    <input
                                      readOnly
                                      value={unitLabel(storage)}
                                    />
                                  </Field>
                                  <Field label="Opening stock value">
                                    <input
                                      type="number"
                                      step="any"
                                      min="0"
                                      required
                                      value={draft.openingStock.value}
                                      onChange={(e) =>
                                        change('openingStock', {
                                          ...draft.openingStock,
                                          value: e.target.value,
                                        })
                                      }
                                    />
                                  </Field>
                                  <Field label="Inventory as of">
                                    <input
                                      type="date"
                                      required
                                      value={draft.openingStock.date}
                                      onChange={(e) =>
                                        change('openingStock', {
                                          ...draft.openingStock,
                                          date: e.target.value,
                                        })
                                      }
                                    />
                                  </Field>
                                </div>
                                <p className="form-hint">
                                  Save records this quantity as the initial
                                  balance, once. It records stock already owned,
                                  with its value posted to owner equity. Cancel
                                  records nothing.
                                </p>
                              </>
                            )}
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn secondary"
                              disabled={dirty || busy}
                              onClick={() => open('adjust', i)}
                            >
                              Stock count / adjustment
                            </button>
                            <p className="form-hint">
                              Choose Set total balance to replace the balance
                              with your count, or Add / remove to change it by a
                              quantity.
                              {dirty
                                ? ' Save or cancel your ingredient edits before adjusting stock.'
                                : ''}
                            </p>
                          </>
                        )}
                      </section>
                      <section className="ingredient-section">
                        <h3>
                          {packaging ? 'Inventory' : 'Inventory settings'}
                        </h3>
                        <p>
                          Stock balances change only through Receive stock or a
                          reason-backed adjustment.
                        </p>
                        <Field
                          label={`Reorder threshold (${draft.storageUnit})`}
                        >
                          {input('threshold', 'number')}
                        </Field>
                        <Field
                          label={`Reorder quantity (${draft.storageUnit})`}
                        >
                          {input('reorderQuantity', 'number')}
                        </Field>
                        <Field label="Storage location">
                          {input('storageLocation')}
                        </Field>
                      </section>
                      <details
                        open={editTab === 'labels'}
                        className="ingredient-section ingredient-optional ingredient-edit-labels"
                      >
                        <summary>
                          {packaging
                            ? 'Packaging notes'
                            : 'Label information & notes'}
                        </summary>
                        <Field label="Notes">
                          <textarea
                            value={draft.notes || ''}
                            onChange={(e) => change('notes', e.target.value)}
                          />
                        </Field>
                        {food && (
                          <>
                            <Field label="Ingredient statement name">
                              {input('statement')}
                            </Field>
                            <Field label="Subingredients text">
                              <textarea
                                value={draft.subingredients || ''}
                                onChange={(e) =>
                                  change('subingredients', e.target.value)
                                }
                              />
                            </Field>
                            <Field label="Source Contains statement">
                              <textarea
                                value={draft.sourceContains || ''}
                                onChange={(e) =>
                                  change('sourceContains', e.target.value)
                                }
                              />
                            </Field>
                            <Field label="Source May contain / facility statement">
                              <textarea
                                value={draft.sourceMayContain || ''}
                                onChange={(e) =>
                                  change('sourceMayContain', e.target.value)
                                }
                              />
                            </Field>
                            <fieldset>
                              <legend>Allergens</legend>
                              {allergens.map((a) => (
                                <label className="check-label" key={a}>
                                  <input
                                    type="checkbox"
                                    checked={(draft.allergens || []).includes(
                                      a,
                                    )}
                                    onChange={(e) =>
                                      change(
                                        'allergens',
                                        e.target.checked
                                          ? [...(draft.allergens || []), a]
                                          : (draft.allergens || []).filter(
                                              (v: string) => v !== a,
                                            ),
                                      )
                                    }
                                  />
                                  {a}
                                </label>
                              ))}
                            </fieldset>
                            {check(
                              'reviewed',
                              'Supplier ingredient and allergen information reviewed',
                            )}
                          </>
                        )}
                      </details>
                      {!packaging && (
                        <InventoryProductFields value={draft} change={change} />
                      )}
                      {offers.length > 0 && (
                        <section className="ingredient-section ingredient-optional">
                          <h3>Saved vendor quotes</h3>
                          <p>
                            {offers.length} saved quotes. Finish editing to
                            manage quotes.
                          </p>
                        </section>
                      )}
                    </div>
                  </div>
                  {packaging && (
                    <section className="ingredient-section">
                      <h3>Recipe usage</h3>
                      <p>
                        {usage.map((r) => r.name).join(', ') ||
                          'No recipes use this packaging yet.'}
                      </p>
                    </section>
                  )}
                </div>
              ) : (
                <>
                  <h3>Manually entered store price</h3>
                  <Field label="Store/vendor">
                    <select
                      value={draft.vendorId || ''}
                      onChange={(e) => change('vendorId', e.target.value)}
                    >
                      <option value="">Choose vendor</option>
                      {w.vendors.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {!w.vendors.length && (
                    <p>
                      Add a vendor in Pantry → Vendors before recording an
                      offer.
                    </p>
                  )}
                  <Field label="Brand / product description">
                    {input('brand')}
                  </Field>
                  {priceFields}
                  <div className="form-grid">
                    <Field label="Package barcode">
                      {input('barcode')}
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => setScanning(true)}
                      >
                        Scan barcode
                      </button>
                    </Field>
                    <Field label="Product URL">
                      {input('productUrl', 'url')}
                    </Field>
                    <Field label="Price checked date">
                      {input('priceCheckedAt', 'date')}
                    </Field>
                    <Field label="Sale price expiration">
                      {input('offerExpiresAt', 'date')}
                    </Field>
                  </div>
                  <Field label="Notes">
                    <textarea
                      value={draft.notes || ''}
                      onChange={(e) => change('notes', e.target.value)}
                    />
                  </Field>
                  {food && (
                    <>
                      <Field label="Supplier subingredients">
                        {input('subingredients')}
                      </Field>
                      <fieldset>
                        <legend>
                          Supplier-declared allergens (review before
                          substituting)
                        </legend>
                        {allergens.map((a) => (
                          <label className="check-label" key={a}>
                            <input
                              type="checkbox"
                              checked={(draft.allergens || []).includes(a)}
                              onChange={(e) =>
                                change(
                                  'allergens',
                                  e.target.checked
                                    ? [...(draft.allergens || []), a]
                                    : (draft.allergens || []).filter(
                                        (v: string) => v !== a,
                                      ),
                                )
                              }
                            />
                            {a}
                          </label>
                        ))}
                      </fieldset>
                    </>
                  )}
                  <p className="muted">
                    A product URL does not connect live pricing. Saving an offer
                    never changes inventory or recipe costs.
                  </p>
                </>
              )}
              {!!barcodeWarnings.length && (
                <p role="status" className="warning-text">
                  This barcode is also assigned to: {barcodeWarnings.join(', ')}
                  . Confirm the package identity. Barcodes are not lot numbers.
                </p>
              )}
            </form>
          ) : (
            <>
              <ItemDetailLayout
                item={i}
                assets={w.graphic_assets}
                photoDetails={
                  <section
                    aria-label="Recipe usage"
                    className="ingredient-section ingredient-section-wide"
                  >
                    <h3>Recipe usage</h3>
                    {usage.length ? (
                      usage.map((r) => (
                        <button
                          key={r.id}
                          className="text-button"
                          onClick={() => open('recipe-detail', r)}
                        >
                          {r.name}
                        </button>
                      ))
                    ) : (
                      <p>
                        No recipes use this{' '}
                        {packaging ? 'packaging' : 'ingredient'} yet.
                      </p>
                    )}
                  </section>
                }
              >
                <IngredientCostCards ingredient={i} />
                {!hasPurchasePackage(i) && (
                  <div>
                    <p className="warning-text">
                      Purchase package details not set.
                    </p>
                    {canEdit && (
                      <button className="text-button" onClick={edit}>
                        Add purchase details
                      </button>
                    )}
                  </div>
                )}
                <details
                  className="calculation-box ingredient-detail-card"
                  id="ingredient-conversions"
                >
                  <summary>How this is calculated</summary>
                  <PackageSummary
                    ingredient={i}
                    onAdd={canEdit ? edit : undefined}
                  />
                  <p>
                    Storage unit: {storage} · Default recipe unit:{' '}
                    {i.recipeUnit || storage}. Current unit costs use the saved
                    inventory cost reference. Package unit cost uses the
                    configured purchase price and package amount.
                  </p>
                  <div className="ingredient-conversion-details">
                    <h4>Units & verified conversions</h4>
                    {canEdit && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          edit()
                          setEditTab('conversions')
                        }}
                      >
                        Open Unit Conversions
                      </button>
                    )}
                    {(i.conversions || []).map((c: any, index: number) => (
                      <p key={index}>
                        {c.amountFrom} {c.from} = {c.amountTo} {c.to} ·{' '}
                        {c.verified ? 'Reviewed' : 'Needs review'} · {c.notes}
                      </p>
                    ))}
                  </div>
                </details>
                <details className="calculation-box ingredient-detail-card">
                  <summary>Purchasing</summary>
                  <section
                    aria-label="Purchase & costing"
                    className="ingredient-section"
                  >
                    <h3>Purchase & costing</h3>
                    <p>
                      Preferred store/vendor:{' '}
                      <strong>{i.vendor || 'Not set'}</strong>
                    </p>
                    <p>
                      Price reference source:{' '}
                      {i.referenceVendor || i.vendor || 'Not set'}
                    </p>
                    {i.productSourceUrl && (
                      <p>
                        Product source:{' '}
                        <a
                          href={
                            /^https:\/\//.test(i.productSourceUrl)
                              ? i.productSourceUrl
                              : undefined
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View retailer page
                        </a>{' '}
                        · checked {i.productCheckedAt}
                      </p>
                    )}
                    {i.listedOnlinePrice != null && (
                      <p>
                        Listed online price: {i.currency || 'USD'}{' '}
                        {String(i.listedOnlinePrice)}. Confirm or replace the
                        package price with the actual amount paid.
                      </p>
                    )}
                    {i.priceCheckedAt && (
                      <p>Price checked: {i.priceCheckedAt}</p>
                    )}
                    <p>
                      Package:{' '}
                      {hasPurchasePackage(i)
                        ? `${precise(i.purchaseQuantity ?? i.packageQuantity)} ${i.purchaseUnit} for ${money(i.packagePrice)}`
                        : 'Not set'}
                    </p>
                    <p className="muted">
                      Purchase tax:{' '}
                      {i.includesTax === true
                        ? 'included'
                        : i.includesTax === false
                          ? 'excluded'
                          : 'not specified'}{' '}
                      · Shipping:{' '}
                      {i.includesShipping === true
                        ? 'included'
                        : i.includesShipping === false
                          ? 'excluded'
                          : 'not specified'}
                    </p>
                  </section>
                  <section
                    aria-label="Vendor quotes"
                    className="ingredient-section ingredient-section-wide"
                  >
                    <h3>Vendor quotes</h3>
                    {canEdit && (
                      <button
                        className="text-button"
                        onClick={() => editOffer()}
                      >
                        Enter store price manually
                      </button>
                    )}
                    {offers.length > 0 && <h4>Saved offers</h4>}
                    {(showAll ? offers : offers.slice(0, 2)).map((o: any) => (
                      <StoreOffer
                        key={o.id}
                        ingredient={i}
                        today={today()}
                        offer={o}
                        canEdit={canEdit && !busy}
                        edit={() => editOffer(o)}
                        act={(op) => {
                          if (op === 'conversion') {
                            requestAnimationFrame(() => {
                              const details = document.getElementById(
                                'ingredient-conversions',
                              ) as HTMLDetailsElement | null
                              if (details) {
                                details.open = true
                                details.scrollIntoView({ block: 'start' })
                              }
                            })
                          } else if (op === 'reference') {
                            referenceRevision.current = i.updatedAt
                            setReference(o)
                          } else
                            void run('ingredientOffer', {
                              operation: op,
                              offerId: o.id,
                            })
                        }}
                      />
                    ))}
                    {offers.length > 2 && (
                      <button
                        className="text-button"
                        onClick={() => setShowAll(!showAll)}
                      >
                        {showAll
                          ? 'Show two alternatives'
                          : `Show all ${offers.length} alternatives`}
                      </button>
                    )}
                    {reference && (
                      <section
                        className="calculation-box"
                        aria-label="Confirm reference price"
                      >
                        <h3>Change recipe-cost reference?</h3>
                        <p>
                          {reference.vendor} · {reference.brand}
                        </p>
                        <PackageSummary ingredient={i} offer={reference} />
                        <p>
                          Current estimates affected:{' '}
                          {usage.map((r) => r.name).join(', ') ||
                            'No existing recipes'}
                          . Inventory valuation and historical purchases stay
                          unchanged.{' '}
                          {food &&
                            'Review supplier allergens and subingredients when changing brands.'}
                        </p>
                        <div className="button-row">
                          <button
                            className="btn secondary"
                            onClick={() => setReference(null)}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn"
                            disabled={busy}
                            onClick={() =>
                              void run('ingredientOffer', {
                                operation: 'reference',
                                offerId: reference.id,
                                confirmed: true,
                              })
                            }
                          >
                            Confirm reference price
                          </button>
                        </div>
                      </section>
                    )}
                  </section>
                </details>
                <details className="calculation-box ingredient-detail-card">
                  <summary>Inventory</summary>
                  <section
                    aria-label="Inventory"
                    className="ingredient-section"
                  >
                    <h3>Inventory</h3>
                    <div className="ingredient-metrics">
                      <div>
                        <small>Inventory value</small>
                        <strong>
                          {i.quantity != null && i.cost != null
                            ? money(i.quantity * i.cost)
                            : 'Not set'}
                        </strong>
                      </div>
                      <div>
                        <small>Reorder threshold</small>
                        <strong>
                          <Measure>
                            {() =>
                              i.threshold == null
                                ? 'Not set'
                                : `${precise(convert(i.threshold, i.unit, storage, i.conversions))} ${storage}`
                            }
                          </Measure>
                        </strong>
                      </div>
                      <div>
                        <small>Reorder quantity</small>
                        <strong>
                          <Measure>
                            {() =>
                              i.reorderQuantity == null
                                ? 'Not set'
                                : `${precise(convert(i.reorderQuantity, i.unit, storage, i.conversions))} ${storage}`
                            }
                          </Measure>
                        </strong>
                      </div>
                    </div>
                    <p>Storage location: {i.storageLocation || 'Not set'}</p>
                    <div className="button-row">
                      <button
                        className="btn secondary"
                        disabled={!canEdit}
                        onClick={() =>
                          open('receive', {
                            ...i,
                            quantity: i.purchaseQuantity || 1,
                            unit: i.purchaseUnit || i.unit,
                            price: i.packagePrice || 0,
                          })
                        }
                      >
                        Receive stock
                      </button>
                      <button
                        className="btn secondary"
                        disabled={!canEdit}
                        onClick={() => open('adjust', { ...i, quantity: -1 })}
                      >
                        Adjust stock
                      </button>
                    </div>
                  </section>
                  <details>
                    <summary>Inventory ledger & purchase history</summary>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Activity</th>
                            <th>Quantity</th>
                            <th>Amount</th>
                            <th>Reason / vendor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.map(inventoryMovementView).map((l) => (
                            <tr key={l.id}>
                              <td>{l.date}</td>
                              <td>{l.type}</td>
                              <td>
                                {precise(l.quantity)} {l.unit}
                                {l.resultingInventoryQuantity != null &&
                                  l.inventoryUnit && (
                                    <small>
                                      {' '}
                                      · Balance:{' '}
                                      {precise(
                                        l.resultingInventoryQuantity,
                                      )}{' '}
                                      {l.inventoryUnit}
                                    </small>
                                  )}
                              </td>
                              <td>{money(l.amount)}</td>
                              <td>
                                {l.reason} {l.vendor}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!history.length && <p>No stock activity recorded.</p>}
                  </details>
                  <details>
                    <summary>Cost history</summary>
                    {history
                      .filter(
                        (l) => l.type === 'purchase_receipt' && l.quantity > 0,
                      )
                      .map((l) => (
                        <p key={l.id}>
                          {l.date} ·{' '}
                          {precise(
                            (l.amount ?? l.packagePrice ?? l.purchasePrice) /
                              l.quantity,
                          )}{' '}
                          / {l.unit} actual receipt cost
                        </p>
                      ))}
                    {(i.costReferenceHistory || []).map(
                      (h: any, index: number) => (
                        <p key={index}>
                          {h.date} · reference {h.purchaseQuantity}{' '}
                          {h.purchaseUnit} for {money(h.packagePrice)} ·{' '}
                          {h.reason}
                        </p>
                      ),
                    )}
                    <p>Completed production keeps historical cost snapshots.</p>
                  </details>
                </details>
                <details className="calculation-box ingredient-detail-card">
                  <summary>
                    {packaging
                      ? 'Packaging details'
                      : material
                        ? 'Item details'
                        : 'Label & ingredient details'}
                  </summary>
                  <section
                    aria-label="Identification"
                    className="ingredient-section"
                  >
                    <h3>Identification</h3>
                    <p>Barcode: {i.barcode || 'Not set'}</p>
                    <p>Internal SKU: {i.sku || 'Not set'}</p>
                    <p>Retailer SKU: {i.retailerSku || 'Not provided'}</p>

                    <p>
                      Lot: {i.lot || 'Not recorded'} · Expiration:{' '}
                      {i.expires || 'Not recorded'}
                    </p>
                    <p>Brand: {i.brand || 'Not set'}</p>
                    <p>Notes: {i.notes || 'Not recorded'}</p>
                  </section>
                  {food && (
                    <section
                      aria-label="Label information"
                      className="ingredient-section"
                    >
                      <h3>Label information</h3>
                      <p>Ingredient statement: {i.statement || i.name}</p>
                      <p>
                        Subingredients: {i.subingredients || 'Not recorded'}
                      </p>
                      {i.sourceContains && (
                        <p>
                          Source Contains (verify package): {i.sourceContains}
                        </p>
                      )}
                      {i.sourceMayContain && (
                        <p>
                          Source May contain (verify package):{' '}
                          {i.sourceMayContain}
                        </p>
                      )}
                      <p>
                        Allergens:{' '}
                        {[
                          ...new Set([
                            ...(i.allergens || []),
                            ...(i.componentAllergens || []),
                          ]),
                        ].join(', ') ||
                          'No declarations recorded — not confirmed allergen-free'}
                      </p>
                      <span
                        className={`status ${i.reviewed && (!i.compoundRecipeId || i.componentReviewed) ? 'green' : 'amber'}`}
                      >
                        {i.reviewed &&
                        (!i.compoundRecipeId || i.componentReviewed)
                          ? 'Allergen information reviewed'
                          : 'Needs label/allergen review'}
                      </span>
                      <p>{i.labelReviewReason}</p>
                    </section>
                  )}
                </details>
                <div className="button-row ingredient-detail-actions">
                  <button className="btn" disabled={!canEdit} onClick={edit}>
                    {editActionLabel(i, 'ingredients')}
                  </button>
                  <button
                    className="btn secondary"
                    onClick={() => open('shelf-label', i)}
                  >
                    Print shelf/bin label
                  </button>
                </div>
              </ItemDetailLayout>
            </>
          )}
        </div>
        {(editing || offerEdit) && (
          <footer className="ingredient-detail-footer">
            <Fragment key="edit-actions">
              <button
                className="btn secondary"
                disabled={busy || importBusy}
                onClick={() =>
                  (() => {
                    setEditing(false)
                    setOfferEdit(null)
                    setDirty(false)
                    setError('')
                  })()
                }
              >
                Cancel
              </button>
              <button
                className="btn"
                type="submit"
                form="ingredient-editor"
                disabled={busy || importBusy || !canEdit}
              >
                {busy
                  ? 'Saving…'
                  : editing
                    ? packaging
                      ? 'Save packaging'
                      : 'Save changes'
                    : 'Save offer'}
              </button>
            </Fragment>
          </footer>
        )}
      </DialogContent>
    </Dialog>
  )
}
function StoreOffer({
  ingredient,
  today,
  offer: o,
  canEdit,
  edit,
  act,
}: {
  ingredient: Item
  today: string
  offer: any
  canEdit: boolean
  edit: () => void
  act: (op: string) => void
}) {
  let comparison: ReactNode
  try {
    if (!hasPurchasePackage(o)) comparison = null
    else {
      const c = compareOffer(ingredient, o)
      const diff = c.difference
      comparison = c.warning ? (
        <p className="warning-text">{c.warning}</p>
      ) : (
        <>
          <span
            className={`status ${diff! < 0 ? 'green' : diff! > 0 ? 'amber' : 'neutral'}`}
          >
            {diff! < 0
              ? 'Cheaper'
              : diff! > 0
                ? 'More expensive'
                : 'Same unit price'}
          </span>
          <p>
            {o.currency} {diff! >= 0 ? '+' : '-'}
            {precise(Math.abs(diff!))}/{c.unit} ·{' '}
            {precise(Math.abs(c.percent!))}%{' '}
            {diff! < 0
              ? 'cheaper'
              : diff! > 0
                ? 'more expensive'
                : 'difference'}
          </p>
          <p>
            Equivalent {c.equivalent! < 0 ? 'savings' : 'extra cost'} on{' '}
            {ingredient.purchaseQuantity} {ingredient.purchaseUnit}:{' '}
            {o.currency} {precise(Math.abs(c.equivalent!))}
          </p>
        </>
      )
    }
  } catch (e) {
    comparison = (
      <p className="warning-text">
        {(e as Error).message} Add the missing conversion in History &
        conversions → Units & verified conversions.
        <button
          className="text-button"
          disabled={!canEdit}
          onClick={() => act('conversion')}
        >
          Add conversion
        </button>
      </p>
    )
  }
  return (
    <article className="ingredient-offer">
      <h3>
        {o.vendor}{' '}
        {o.preferred && <span className="status green">Preferred store</span>}
      </h3>
      <p>{o.brand || 'No brand specified'}</p>
      <PackageSummary ingredient={ingredient} offer={o} />
      {comparison}
      <p className="muted">
        {o.source === 'manual'
          ? 'Manually entered'
          : o.source === 'receipt'
            ? 'From receipt'
            : 'Connected provider'}{' '}
        · checked {o.priceCheckedAt}
        {o.offerExpiresAt
          ? ` · ${o.offerExpiresAt < today ? 'Expired' : 'Expires'} ${o.offerExpiresAt}`
          : ''}
      </p>
      <p className="muted">
        {o.currency} · Tax{' '}
        {o.includesTax === true
          ? 'included'
          : o.includesTax === false
            ? 'excluded'
            : 'not specified'}{' '}
        · Shipping{' '}
        {o.includesShipping === true
          ? 'included'
          : o.includesShipping === false
            ? 'excluded'
            : 'not specified'}
      </p>
      {o.barcode && <p>Package barcode: {o.barcode}</p>}
      {o.productUrl && (
        <a href={o.productUrl} target="_blank" rel="noreferrer">
          Product page
        </a>
      )}
      <p>{o.notes}</p>
      {!isPackaging(ingredient) &&
        ingredient.usedAs !== 'material' &&
        (o.brand !== ingredient.brand ||
          o.subingredients !== ingredient.subingredients ||
          JSON.stringify(o.allergens || []) !==
            JSON.stringify(ingredient.allergens || [])) && (
          <p className="warning-text">
            Different brand or ingredient information: review labels and
            allergens before substituting.
          </p>
        )}
      <div className="button-row">
        <button className="btn secondary" disabled={!canEdit} onClick={edit}>
          Edit offer
        </button>
        <button
          className="btn secondary"
          disabled={!canEdit}
          onClick={() => act('preferred')}
        >
          Mark preferred store
        </button>
        <button
          className="btn secondary"
          disabled={!canEdit}
          onClick={() => act('reference')}
        >
          Use as reference price
        </button>
        <button
          className="text-button"
          disabled={!canEdit}
          onClick={() => act('remove')}
        >
          Remove offer
        </button>
      </div>
    </article>
  )
}
