import { ProductLabelsInfo } from './product-labels'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ItemEditorShell, invalidEditorTabs } from './item-editor-shell'
import { NetWeightField } from './net-weight-field'
import { ItemImagesPanel } from './item-images-panel'
import { PantryPhoto } from './pantry-photo'
import { ProductCategorySelector } from './product-categories'
import { ProductLinkImport } from './product-link-import'
import { InventoryProductFields } from './inventory-product-fields'
import {
  money,
  productCosting,
  profitability,
  type Item,
  type Workspace,
} from '@/lib/domain'
import { productWorkflows, tracksFinishedStock } from '@/lib/product-workflows'
import {
  conflictMessage,
  creationOnlyKeys,
  productEditDraft,
  productIdentityConflict,
} from '@/lib/product-edit'

type Props = {
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
  /** Opens the explicit stock workflows; item editing never moves stock. */
  onStockAction?: (kind: 'trade-receive' | 'trade-adjust', item: Item) => void
}

function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="form-hint">{hint}</small>}
    </label>
  )
}

/**
 * Shared editor for handmade and resale products, opened from Products and
 * from Inventory. "Edit Product" always updates the stored product ID.
 */
export function ProductEditor({
  kind,
  item,
  workspace,
  role,
  mutate,
  onWorkspace,
  close,
  onDirty,
  onStockAction,
}: Props) {
  const stored = item?.id
    ? workspace.products.find((p) => p.id === item.id) || null
    : null
  // The edit target is fixed when the editor opens and survives every tab,
  // import and upload. Imports can never replace it.
  const editId = useRef<string | null>(stored?.id || null)
  const editing = editId.current !== null
  const [draft, setDraft] = useState<Item>(() =>
    stored
      ? productEditDraft(stored)
      : {
          id: crypto.randomUUID(),
          creationRequestId: crypto.randomUUID(),
          name: '',
          workflow: kind === 'trade-product-resale' ? 'resale' : 'handmade',
          recipeId: '',
          price: '',
          threshold: 0,
          sku: '',
          barcode: '',
          supplierId: '',
          productCategoryId: '',
          laborRate: workspace.settings[0]?.laborRate ?? 0,
          ...(item || {}),
        },
  )
  const current = editing
    ? workspace.products.find((p) => p.id === editId.current) || stored
    : null
  const [tab, setTab] = useState<string>('details')
  const [errorTabs, setErrorTabs] = useState<string[]>([])
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [uploadBusy, setUploadBusy] = useState(false),
    [categoryBusy, setCategoryBusy] = useState(false),
    [importBusy, setImportBusy] = useState(false),
    [error, setError] = useState('')
  const saving = useRef(false)
  const canManage = ['Owner', 'Manager'].includes(role)
  const working = busy || uploadBusy || categoryBusy || importBusy
  const resale = draft.workflow === 'resale'

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

  const change = (key: string, value: Item[string]) => {
    setDirty(true)
    setDraft((d) => ({ ...d, [key]: value }))
  }
  function dismiss() {
    if (
      !busy &&
      (!dirty || window.confirm('Discard unsaved changes to this product?'))
    )
      close()
  }
  const input = (key: string, type = 'text', required = false) => (
    <input
      type={type}
      step={type === 'number' ? 'any' : undefined}
      min={type === 'number' ? 0 : undefined}
      inputMode={type === 'number' ? 'decimal' : undefined}
      value={draft[key] ?? ''}
      required={required}
      data-field={key}
      onChange={(e) => change(key, e.target.value)}
    />
  )

  let costLine: ReactNode
  try {
    const cost = productCosting(draft as Item, workspace).perPackage
    let result: ReturnType<typeof profitability> | undefined
    try {
      result = profitability(draft as Item, cost, workspace.settings[0])
    } catch {
      /* Tax setup is independent of the cost estimate. */
    }
    costLine = (
      <>
        <p>
          {resale ? 'Average received cost' : 'Estimated unit cost'}:{' '}
          <strong>{money(cost)}</strong>
        </p>
        <p>
          {result ? (
            <>
              Profit before fees, excluding tax:{' '}
              <strong>{money(result.profit)}</strong> · margin{' '}
              <strong>{result.margin.toFixed(1)}%</strong>
            </>
          ) : (
            'Profit and margin need configured category tax treatment.'
          )}
        </p>
      </>
    )
  } catch {
    costLine = (
      <p>
        {resale
          ? 'No received cost yet. Use Receive Stock to record a purchase; unknown costs are never shown as zero.'
          : 'Choose a saved handmade design to see its estimated cost.'}
      </p>
    )
  }

  const stockKind = (k: 'trade-receive' | 'trade-adjust') => {
    if (!current || !onStockAction) return
    if (
      dirty &&
      !window.confirm(
        'You have unsaved product changes. Leave without saving them to record a stock movement?',
      )
    )
      return
    onStockAction(k, current)
  }

  async function submit(form: HTMLFormElement) {
    if (saving.current || working) return
    const invalidTabs = invalidEditorTabs(form, 'details')
    if (invalidTabs.length) {
      setErrorTabs(invalidTabs)
      setTab(invalidTabs[0])
      setError('Check the highlighted fields before saving.')
      return
    }
    setErrorTabs([])
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const payload: Item = { ...draft, id: editId.current ?? draft.id }
      if (editing) for (const key of creationOnlyKeys) delete payload[key]
      const conflict = productIdentityConflict(
        workspace.products,
        payload,
        current || undefined,
      )
      if (conflict) {
        setErrorTabs(['details'])
        setTab('details')
        throw new Error(conflictMessage(conflict))
      }
      await mutate('save', 'products', payload)
      setDirty(false)
      close()
    } catch (e) {
      const message =
        e instanceof Error && e.message
          ? e.message
          : 'Save did not complete. Your changes are still here; check the connection and select Save again.'
      setError(message)
      if (/^(SKU|Barcode)\b/.test(message)) {
        setErrorTabs(['details'])
        setTab('details')
      }
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  const workflowLabel =
    productWorkflows.find((w) => w.value === draft.workflow)?.label ||
    draft.workflow
  const handmade = draft.workflow === 'handmade'
  const stockShown = !!(editing && current && tracksFinishedStock(current))
  const quantityText = (n: unknown) =>
    Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 4 })

  const details = (
    <>
      <Field label="Product name">
        <input
          value={draft.name || ''}
          required
          maxLength={200}
          data-field="name"
          onChange={(e) => change('name', e.target.value)}
        />
      </Field>
      <div className="form-grid">
        {editing ? (
          <Field label="Product type">
            <input value={workflowLabel} readOnly />
          </Field>
        ) : (
          <Field label="Product type">
            <select
              value={draft.workflow}
              onChange={(e) => change('workflow', e.target.value)}
            >
              {productWorkflows
                .filter((w) => w.value !== 'food')
                .map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field label="Supplier">
          <select
            value={draft.supplierId || ''}
            onChange={(e) => change('supplierId', e.target.value)}
          >
            <option value="">No supplier</option>
            {workspace.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        {handmade && (
          <Field label="Saved handmade design">
            <select
              value={draft.recipeId || ''}
              required
              data-field="recipeId"
              onChange={(e) => change('recipeId', e.target.value)}
            >
              <option value="">Choose…</option>
              {workspace.recipes
                .filter((r) => r.workflow === 'handmade')
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
      </div>
      <ProductCategorySelector
        product={draft as Item}
        business={workspace.settings[0]}
        canManage={canManage}
        onChange={change}
        onBusyChange={setCategoryBusy}
        onConfig={(patch) =>
          onWorkspace({
            ...workspace,
            settings: workspace.settings.map((s, index) =>
              index === 0 ? { ...s, ...patch } : s,
            ),
          })
        }
        openTaxSettings={() =>
          window.open('/oven#Settings/Taxes', '_blank', 'noopener,noreferrer')
        }
      />
      <div className="form-grid">
        <Field label="SKU">{input('sku')}</Field>
        <Field label="Barcode">{input('barcode')}</Field>
        <Field label="Variant group (optional)">{input('variantGroup')}</Field>
        <Field label="Size / color / variant (optional)">
          {input('variant')}
        </Field>
      </div>
      <p className="form-hint">
        Each size or color is its own product with its own stock and SKU. Use
        the same group name to link variants.
      </p>
      <ProductLinkImport
        settings={workspace.settings[0]}
        draft={draft}
        existing={editing}
        onWorkspace={onWorkspace}
        onBusyChange={setImportBusy}
        onVendorsChange={(vendors) => onWorkspace({ ...workspace, vendors })}
        apply={(patch) => {
          setDirty(true)
          setDraft((d) => ({
            ...d,
            ...patch,
            // Imported details never change which record is edited.
            id: d.id,
            workflow: d.workflow,
            ...(patch.vendorId ? { supplierId: patch.vendorId } : {}),
          }))
        }}
      />
      <InventoryProductFields value={draft} change={change} />
    </>
  )

  const images = (
    <ItemImagesPanel
      value={draft}
      assets={workspace.graphic_assets || []}
      canUpload={canManage}
      disabled={working}
      onChange={change}
      onWorkspace={onWorkspace}
      onBusy={setUploadBusy}
    >
      <ProductLabelsInfo value={draft} workspace={workspace} />
      {handmade && (
        <section className="item-images-text" aria-label="Label text">
          <h3>Label text (optional)</h3>
          <div className="form-grid">
            <Field label="Label main name (optional)">
              {input('labelMainName')}
            </Field>
            <Field label="Label product type">
              {input('labelProductType')}
            </Field>
            <NetWeightField value={draft} onChange={change} />
          </div>
          <p className="form-hint">
            Label Studio can place these parts separately. The product name
            stays unchanged.
          </p>
        </section>
      )}
    </ItemImagesPanel>
  )

  const pricing = (
    <>
      <div className="form-grid">
        <Field label="Selling price">{input('price', 'number', true)}</Field>
        <Field label="Reorder threshold (items)">
          {input('threshold', 'number')}
        </Field>
      </div>
      {stockShown && (
        <section className="product-editor-summary" aria-label="Stock on hand">
          <h3>Stock</h3>
          <p>
            <strong>{quantityText(current.quantity)}</strong> items on hand
            {current.stockCostKnown
              ? ` · ${money(current.cost || 0)} average item cost`
              : ''}
          </p>
          <p className="form-hint">
            Saving changes here never adds stock, re-posts starting inventory or
            changes receipt costs. Use a stock action to record a movement.
          </p>
          {onStockAction && (
            <div className="product-editor-stock-actions">
              {current.workflow === 'resale' && (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => stockKind('trade-receive')}
                >
                  Receive Stock
                </button>
              )}
              <button
                type="button"
                className="btn secondary"
                onClick={() => stockKind('trade-adjust')}
              >
                Adjust Stock
              </button>
            </div>
          )}
        </section>
      )}
    </>
  )

  const summary = (
    <>
      <h3>{resale ? 'Cost & margin' : 'Production cost & margin'}</h3>
      <dl className="item-editor-summary-list">
        <div>
          <dt>Selling price</dt>
          <dd>
            {draft.price !== '' && draft.price != null && !isNaN(+draft.price)
              ? money(+draft.price)
              : 'Not set'}
          </dd>
        </div>
        {stockShown && (
          <div>
            <dt>On hand</dt>
            <dd>{quantityText(current.quantity)} items</dd>
          </div>
        )}
      </dl>
      <div className="item-editor-summary-note">{costLine}</div>
    </>
  )

  return (
    <ItemEditorShell
      title={editing ? 'Edit Product' : 'Create Product'}
      description={
        editing
          ? `${workflowLabel}. Changes update this product only; stock and receipt history are not changed.`
          : 'Add a product to your oven. Record stock separately after saving.'
      }
      photo={
        <PantryPhoto
          item={{ ...draft, name: draft.name || 'New product' }}
          assets={workspace.graphic_assets || []}
          kind="product"
        />
      }
      photoTab="images"
      tabs={[
        { id: 'details', label: 'Details', content: details },
        { id: 'images', label: 'Images & Labels', content: images },
        { id: 'pricing', label: 'Pricing & Stock', content: pricing },
      ]}
      tab={tab}
      onTab={setTab}
      errorTabs={errorTabs}
      summary={summary}
      summaryLabel="Cost and margin"
      summaryTab="pricing"
      sectionsLabel="Product sections"
      disabled={busy || !canManage}
      error={error}
      notice={
        !canManage && (
          <p className="form-hint">
            Only an Owner or Manager can change products.
          </p>
        )
      }
      busy={busy}
      submitDisabled={working || !canManage}
      submitLabel={editing ? 'Save Changes' : 'Create Product'}
      cancel={dismiss}
      onSubmit={(form) => void submit(form)}
    />
  )
}
