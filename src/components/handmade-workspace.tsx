import { PageOverview, PageActions } from './application-page'
import {
  ScopedCategorySelect,
  SectionCategoryTools,
} from './section-categories'
import { assignedCategoryId } from '@/lib/section-categories'
import * as Tabs from '@radix-ui/react-tabs'
import { isFabric } from '../lib/fabric'
import { useEffect, useRef, useState } from 'react'
import { ProductCards } from './product-cards'
import { ItemDetailLayout, ItemDetailHeader } from './item-detail-layout'
import { CostCard, costMoney } from './cost-cards'
import { invalidEditorTabs } from './item-editor-shell'
import { productCategoryName } from '../lib/product-categories'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu'
import { MoreHorizontal } from 'lucide-react'
import { money, type Item, type Workspace } from '../lib/domain'
import { handmadeBom, handmadeEstimate, handmadeUnits } from '../lib/handmade'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { ItemImagesPanel } from './item-images-panel'
import { ProductCategorySelector } from './product-categories'
import './handmade-workspace.css'

type Mutate = (action: string, table: string, data: Item) => Promise<unknown>
type Props = {
  workspace: Workspace
  role: string
  mutate: Mutate
  open: (kind: string, item?: Item) => void
  tab: string
  onWorkspace: (w: Workspace) => void
  onDirtyChange?: (dirty: boolean) => void
}
export function HandmadeWorkspace({
  workspace: w,
  role,
  mutate,
  open,
  tab,
  onWorkspace,
  onDirtyChange,
}: Props) {
  const [location, setLocation] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.hash,
  )
  useEffect(() => {
    if (window.location.hash !== location) setLocation(window.location.hash)
  })
  const dirty = useRef(false)
  useEffect(() => {
    const sync = () => {
      const next = window.location.hash
      dirty.current = false
      setLocation(next)
    }
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', unload)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
      window.removeEventListener('beforeunload', unload)
    }
  }, [])
  const params = new URLSearchParams(location.split('?')[1])
  const productId = params.get('product')
  const product = w.products.find(
    (p) => p.id === productId && p.workflow === 'handmade',
  )
  const go = (p?: Item, edit = '') => {
    window.location.hash =
      '#Handmade/Products%20%26%20Bills%20of%20Materials' +
      (p
        ? '?product=' + encodeURIComponent(p.id) + (edit ? '&edit=' + edit : '')
        : '')
  }
  const [categoryFilter, setCategoryFilter] = useState('all')
  useEffect(() => setCategoryFilter('all'), [tab])
  const categorySettings = (patch: Partial<Item>) =>
    onWorkspace({
      ...w,
      settings: w.settings.map((b, i) => (i === 0 ? { ...b, ...patch } : b)),
    })
  const [editing, setEditing] = useState<Item | null>(null)
  const [mode, setMode] = useState('')
  const products = w.products.filter((p) => p.workflow === 'handmade')
  const materials = w.ingredients.filter((i) => i.usedAs === 'material')
  const runs = w.batches.filter(
    (b) =>
      products.some((p) => p.id === b.productId) ||
      w.recipes.some((r) => r.id === b.recipeId && r.workflow === 'handmade'),
  )
  const manage = ['Owner', 'Manager'].includes(role)
  const estimate = (p: Item) => {
    try {
      return handmadeEstimate(p, w)
    } catch {
      return null
    }
  }
  const editMaterial = (i?: Item, receipt = false) => {
    if (isFabric(i)) {
      open(receipt ? 'fabric-receive' : 'fabric-edit', i)
      return
    }
    setEditing(
      i || { id: crypto.randomUUID(), name: '', unit: 'each', threshold: 0 },
    )
    setMode(receipt ? 'receive' : 'material')
  }
  if (productId && (!product || params.has('edit')))
    return (
      <div className="handmade-workspace">
        <nav className="breadcrumb" aria-label="Handmade breadcrumb">
          <a href="#Handmade/Overview">Handmade</a>
          <span>/</span>
          <a href="#Handmade/Products%20%26%20Bills%20of%20Materials">
            Products
          </a>
          <span>/</span>
          <strong>{product?.name || 'Product unavailable'}</strong>
        </nav>
        {!product ? (
          <section className="panel">
            <h2>Product unavailable</h2>
            <p>
              This handmade product is no longer available in this workspace.
            </p>
          </section>
        ) : (
          <HandmadeProductEditor
            key={product.id}
            item={product}
            workspace={w}
            role={role}
            mutate={async (...args) => {
              await mutate(args[0], args[1], args[2] as Item)
            }}
            onWorkspace={onWorkspace}
            onDirty={(v) => {
              dirty.current = v
              onDirtyChange?.(v)
            }}
            close={() => go(product)}
            inline
            initialTab={params.get('edit') || 'product'}
          />
        )}
      </div>
    )
  return (
    <div className="handmade-workspace">
      {product && !params.has('edit') && (
        <Dialog open onOpenChange={(v) => !v && go()}>
          <DialogContent className="app-dialog wide-dialog item-detail-dialog handmade-detail-dialog">
            <ItemDetailHeader name={product.name}>
              Handmade product · estimated BOM costs and recorded finished
              stock.
            </ItemDetailHeader>
            <HandmadeProductDetail
              key={product.id}
              product={product}
              w={w}
              manage={manage}
              open={(kind, item) => {
                go()
                open(kind, item)
              }}
              edit={(t) => go(product, t)}
            />
          </DialogContent>
        </Dialog>
      )}
      <section className="handmade-intro">
        <div>
          <h2>{tab}</h2>
        </div>
        <PageActions>
          {' '}
          <div className="button-row">
            {manage && (
              <>
                <button
                  className="btn secondary"
                  onClick={() => editMaterial()}
                >
                  Add material
                </button>
                <button className="btn" onClick={() => open('trade-product')}>
                  Create handmade product
                </button>
              </>
            )}
          </div>
        </PageActions>
      </section>
      {[
        'Products & Bills of Materials',
        'Finished Inventory',
        'Materials & Supplies',
      ].includes(tab) && (
        <SectionCategoryTools
          workspace={w}
          scope={
            tab === 'Materials & Supplies'
              ? 'handmade-materials'
              : 'handmade-products'
          }
          canManage={manage}
          onSettings={categorySettings}
          value={categoryFilter}
          onFilter={setCategoryFilter}
        />
      )}
      {tab === 'Overview' && (
        <>
          <PageOverview>
            <div className="handmade-summary">
              <div>
                <strong>{products.length}</strong>
                <span>Handmade products & variants</span>
              </div>
              <div>
                <strong>
                  {
                    materials.filter(
                      (i) => Number(i.quantity) <= Number(i.threshold || 0),
                    ).length
                  }
                </strong>
                <span>Materials at reorder level</span>
              </div>
              <div>
                <strong>
                  {products.filter((p) => !p.bom || !estimate(p)).length}
                </strong>
                <span>Products needing cost review</span>
              </div>
            </div>
          </PageOverview>
          <section className="panel">
            <h3>Ready for your attention</h3>
            {materials
              .filter((i) => Number(i.quantity) <= Number(i.threshold || 0))
              .map((i) => (
                <p key={i.id}>
                  <strong>{i.name}</strong> · {i.quantity} {i.unit} remaining{' '}
                  {manage && (
                    <button
                      className="btn secondary"
                      onClick={() => editMaterial(i, true)}
                    >
                      Receive purchase
                    </button>
                  )}
                </p>
              ))}
            {!materials.length && (
              <p>
                Add materials, receive an actual purchase, then build your first
                bill of materials.
              </p>
            )}
            {products
              .filter((p) => !p.bom)
              .map((p) => (
                <p key={p.id}>
                  {p.name}: legacy design retained. Review and save a
                  product-owned bill of materials before new production.
                </p>
              ))}
          </section>
        </>
      )}
      {tab === 'Materials & Supplies' && (
        <section className="panel">
          <h3>Production materials</h3>
          <p>
            Separate from food ingredients. Shared packaging is selected
            directly on a BOM; its balance is never copied.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Material / category</th>
                  <th>Available</th>
                  <th>Stock unit cost</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {materials
                  .filter(
                    (i) =>
                      categoryFilter === 'all' ||
                      (categoryFilter === 'uncategorized'
                        ? !assignedCategoryId(i, w, 'handmade-materials')
                        : assignedCategoryId(i, w, 'handmade-materials') ===
                          categoryFilter),
                  )
                  .map((i) => (
                    <tr key={i.id}>
                      <td>
                        <strong>{i.name}</strong>
                        <small>
                          {i.materialCategory} · {i.sku}
                        </small>
                      </td>
                      <td>
                        {i.quantity} {i.unit}
                        {Number(i.quantity) <= Number(i.threshold || 0) &&
                          ' · Reorder'}
                      </td>
                      <td>
                        {i.needsCostSetup || i.cost == null
                          ? 'Cost missing'
                          : money(i.cost)}
                      </td>
                      <td>
                        {manage && (
                          <div className="button-row">
                            <button
                              className="btn secondary"
                              onClick={() => editMaterial(i)}
                            >
                              Details & history
                            </button>
                            <button
                              className="btn secondary"
                              onClick={() => editMaterial(i, true)}
                            >
                              Receive purchase
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!materials.length && <p>No handmade materials yet.</p>}
        </section>
      )}
      {[
        'Overview',
        'Products & Bills of Materials',
        'Finished Inventory',
      ].includes(tab) && (
        <section className="handmade-products">
          {tab !== 'Products & Bills of Materials' && (
            <h3>
              {tab === 'Finished Inventory'
                ? 'Finished goods · recorded valuation'
                : 'Products & bills of materials'}
            </h3>
          )}
          <ProductCards
            products={products.filter(
              (p) =>
                categoryFilter === 'all' ||
                (categoryFilter === 'uncategorized'
                  ? !p.productCategoryId
                  : p.productCategoryId === categoryFilter),
            )}
            workspace={w}
            open={(kind, p) => {
              if (kind === 'product-detail') go(p)
              else if (kind === 'product' || kind === 'trade-product')
                go(p, 'product')
              else open(kind, p)
            }}
          />
          {!products.length && (
            <p>
              Create a handmade product with its own BOM. No food recipe is
              required.
            </p>
          )}
        </section>
      )}
      {tab === 'Products & Bills of Materials' &&
        w.recipes.some((r) => r.workflow === 'handmade') && (
          <details className="panel">
            <summary>Preserved legacy designs</summary>
            <p>
              Original designs remain available. Existing linked products can
              adopt a product-owned BOM through Edit BOM.
            </p>
            {w.recipes
              .filter((r) => r.workflow === 'handmade')
              .map((r) => (
                <div className="handmade-run" key={r.id}>
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      {r.yield} units per original design ·{' '}
                      {products.filter((p) => p.recipeId === r.id).length}{' '}
                      linked products
                    </small>
                  </span>
                  {manage && (
                    <button
                      className="btn secondary"
                      onClick={() => open('trade-design', r)}
                    >
                      Review original BOM
                    </button>
                  )}
                  {manage && !products.some((p) => p.recipeId === r.id) && (
                    <button
                      className="btn secondary"
                      onClick={() =>
                        open('trade-product', {
                          id: crypto.randomUUID(),
                          name: r.name,
                          description: r.description,
                          image: r.image,
                          imageAssetId: r.imageAssetId,
                          recipeId: r.id,
                          legacyDesignId: r.id,
                          workflow: 'handmade',
                          price: '',
                        })
                      }
                    >
                      Create product from design
                    </button>
                  )}
                </div>
              ))}
          </details>
        )}
      {tab === 'Production' && manage && (
        <section className="panel">
          <h3>Start a production run</h3>
          <div className="button-row">
            {products
              .filter((p) => !p.archived)
              .map((p) => (
                <button
                  key={p.id}
                  className="btn secondary"
                  onClick={() => open('production', p)}
                >
                  {p.name}
                  {p.variant ? ` · ${p.variant}` : ''}
                </button>
              ))}
          </div>
          {!products.length && (
            <p>Create a handmade product and bill of materials first.</p>
          )}
        </section>
      )}
      {['Overview', 'Production'].includes(tab) && (
        <section className="panel">
          <h3>
            {tab === 'Overview' ? 'Recent production' : 'Production runs'}
          </h3>
          <p>
            Plan from a saved BOM, review shortages, record actual use and
            sellable output, then complete. Correct a completed run by reversing
            it and creating a new run.
          </p>
          {(tab === 'Overview' ? runs.slice(-5) : runs).map((r) => (
            <div className="handmade-run" key={r.id}>
              <span>
                <strong>{r.name}</strong> · {r.date} · {r.status}
                {w.ledger.some((l) => l.id === 'production-reversal-' + r.id) &&
                  ' · Reversed'}
                <small>
                  {r.status === 'completed'
                    ? `${r.actualYield} finished units · ${money(r.historicalCost)} recorded production cost`
                    : `${r.quantity || r.yield} planned units`}
                </small>
              </span>
              <button
                className="btn secondary"
                onClick={() => open('batch-detail', r)}
              >
                Review run
              </button>
            </div>
          ))}
          {!runs.length && (
            <p>No production runs yet. Start from a handmade product above.</p>
          )}
        </section>
      )}
      <details className="panel">
        <summary>Costing method & accounting basis</summary>
        <p>
          BOM costs are planning estimates at current weighted-average material
          prices, including the entered scrap allowance, labor and allocated
          production overhead. Actual completion records consumed stock costs,
          actual labor minutes, configured labor rate and overhead, divided by
          actual sellable output. Scrap reduces yield; it does not enter
          finished stock. Enter zero explicitly for labor or overhead that you
          exclude.
        </p>
        <p>
          Finished stock uses perpetual weighted-average valuation. Purchases
          are inventory assets; production transfers materials into finished
          inventory and capitalizes configured allocations. COGS is recorded
          once when finished units are sold, using the stock average at sale
          time. Historical runs and sales keep their cost snapshots. The
          existing ledger method is retained. Payment processing, outbound
          shipping and other selling expenses remain separate. Refunds use the
          existing sales workflow with an explicit physical-restock choice;
          restocking reverses the original sale cost. A financial refund alone
          does not restock inventory.
        </p>
        <p>
          Each variant is a separate catalog product with its own SKU, BOM and
          finished balance; the optional variant group joins related products.
          Production reversal is a whole-run correction and requires available
          output without downstream stock consumption. Legacy records retain
          their IDs, photos, balances, sale links and designs; no historical
          production or costs are invented.
        </p>
      </details>
      {mode && editing && (
        <MaterialDialog
          item={editing}
          receipt={mode === 'receive'}
          w={w}
          onSettings={categorySettings}
          mutate={mutate}
          close={() => setMode('')}
        />
      )}
    </div>
  )
}

function MaterialDialog({
  item,
  receipt,
  w,
  onSettings,
  mutate,
  close,
}: {
  item: Item
  receipt: boolean
  onSettings: (patch: Partial<Item>) => void
  w: Workspace
  mutate: Mutate
  close: () => void
}) {
  const [d, setD] = useState<Item>({
    purchaseQuantity: '',
    purchaseUnit: item.unit,
    usagePerPurchase: 1,
    purchaseCost: '',
    date: new Date().toISOString().slice(0, 10),
    ...item,
    operationId: crypto.randomUUID(),
  })
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const field = (
    label: string,
    key: string,
    type = 'text',
    required = false,
  ) => (
    <label>
      {label}
      <input
        type={type}
        step={type === 'number' ? 'any' : undefined}
        value={d[key] ?? ''}
        required={required}
        onChange={(e) => setD({ ...d, [key]: e.target.value })}
      />
    </label>
  )
  const unit = (label: string, key: string) => (
    <label>
      {label}
      <select
        value={d[key]}
        onChange={(e) => setD({ ...d, [key]: e.target.value })}
      >
        {handmadeUnits.map((u) => (
          <option key={u}>{u}</option>
        ))}
      </select>
    </label>
  )
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && close()}>
      <DialogContent className="app-dialog">
        <DialogHeader>
          <DialogTitle>
            {receipt ? `Receive ${item.name}` : 'Material details & history'}
          </DialogTitle>
          <DialogDescription>
            {receipt
              ? 'Enter the actual purchase and explicitly confirm its usable contents. No density or package equivalence is assumed.'
              : 'Dedicated handmade stock; food-only fields are not required.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="app-form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (saving.current) return
            saving.current = true
            setBusy(true)
            try {
              await mutate(
                receipt ? 'handmadeMaterialReceive' : 'handmadeMaterialSave',
                'ingredients',
                { ...d, usedAs: 'material' },
              )
              close()
            } catch (e) {
              setError((e as Error).message)
            } finally {
              saving.current = false
              setBusy(false)
            }
          }}
        >
          <fieldset disabled={busy}>
            <div className="form-grid">
              {receipt ? (
                <>
                  {field('Purchase date', 'date', 'date', true)}
                  {field(
                    'Purchase quantity',
                    'purchaseQuantity',
                    'number',
                    true,
                  )}
                  {unit('Purchase unit', 'purchaseUnit')}
                  {field(
                    `Usable ${item.unit} per purchase unit (explicit conversion)`,
                    'usagePerPurchase',
                    'number',
                    true,
                  )}
                  {field(
                    'Actual total purchase cost',
                    'purchaseCost',
                    'number',
                    true,
                  )}
                  {field('Supplier reference (optional)', 'supplierReference')}
                  <p>
                    {Number(d.purchaseQuantity || 0) *
                      Number(d.usagePerPurchase || 0)}{' '}
                    {item.unit} received. This purchase adds inventory; it is
                    not COGS.
                  </p>
                </>
              ) : (
                <>
                  {field('Material name', 'name', 'text', true)}
                  <ScopedCategorySelect
                    workspace={w}
                    scope="handmade-materials"
                    item={d}
                    canManage
                    onSettings={onSettings}
                    onChange={(key, value) =>
                      setD((old) => ({ ...old, [key]: value }))
                    }
                  />
                  {field('Supplier (optional)', 'supplier')}
                  {field('SKU / internal reference', 'sku')}
                  {unit('Stock / usage unit', 'unit')}
                  {field('Reorder threshold', 'threshold', 'number')}
                  {field('Notes', 'notes')}
                </>
              )}
            </div>
          </fieldset>
          {!receipt && (
            <details>
              <summary>
                Purchase & cost history · {item.quantity || 0} {item.unit} on
                hand
              </summary>
              {w.ledger
                .filter((l) => l.ingredientId === item.id)
                .map((l) => (
                  <p key={l.id}>
                    {l.date} · {l.type} · {l.quantity} {l.unit} ·{' '}
                    {money(l.amount)}
                    {l.unitCost != null && ` · ${money(l.unitCost)}/unit`}
                    {l.purchaseQuantity &&
                      ` · ${l.purchaseQuantity} ${l.purchaseUnit} × ${l.usagePerPurchase ?? 'recorded contents'}`}
                  </p>
                ))}
            </details>
          )}
          {error && <p role="alert">{error}</p>}
          <button className="btn" disabled={busy}>
            {busy ? 'Saving…' : receipt ? 'Receive purchase' : 'Save material'}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function HandmadeProductEditor({
  item,
  workspace: w,
  role,
  mutate,
  onWorkspace,
  close,
  onDirty,
  inline = false,
  initialTab = 'product',
}: {
  item: Item | null
  workspace: Workspace
  role: string
  mutate: (
    action: string,
    table: string,
    data: Record<string, unknown>,
  ) => Promise<void>
  onWorkspace: (w: Workspace) => void
  close: () => void
  onDirty: (dirty: boolean) => void
  inline?: boolean
  initialTab?: string
}) {
  const [activeTab, setActiveTab] = useState(
    ['product', 'bom', 'costing'].includes(initialTab) ? initialTab : 'product',
  )
  const [dirty, setDirty] = useState(false)
  const dismiss = () => {
    if (
      !busy &&
      (!dirty || window.confirm('Discard unsaved changes to this product?'))
    ) {
      onDirty(false)
      close()
    }
  }
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const [d, setD] = useState<Item>(() => ({
    id: crypto.randomUUID(),
    name: '',
    price: '',
    workflow: 'handmade',
    ...item,
  }))
  const [bom, setBom] = useState<Item>(() => {
    const old = item && handmadeBom(item, w)
    return {
      id: crypto.randomUUID(),
      name: 'Bill of materials',
      output: 1,
      laborMinutes: 0,
      laborRate: w.settings[0]?.laborRate || 0,
      overhead: 0,
      scrapPercent: 0,
      lines: [],
      ...old,
    }
  })
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const manage = ['Owner', 'Manager'].includes(role)
  const change = (k: string, value: unknown) => {
    setDirty(true)
    onDirty(true)
    setD((v) => ({ ...v, [k]: value }))
  }
  const changeBom = (k: string, value: unknown) => {
    setDirty(true)
    onDirty(true)
    setBom((v) => ({ ...v, [k]: value }))
  }
  const field = (label: string, k: string, type = 'text', b = false) => (
    <label>
      {label}
      <input
        type={type}
        step={type === 'number' ? 'any' : undefined}
        min={type === 'number' ? (k === 'output' ? 1 : 0) : undefined}
        max={k === 'scrapPercent' ? 100 : undefined}
        required={[
          'name',
          'price',
          'output',
          'laborMinutes',
          'laborRate',
          'overhead',
          'scrapPercent',
        ].includes(k)}
        value={(b ? bom : d)[k] ?? ''}
        onChange={(e) =>
          b ? changeBom(k, e.target.value) : change(k, e.target.value)
        }
      />
    </label>
  )
  let c: ReturnType<typeof handmadeEstimate> | undefined,
    costError = ''
  try {
    c = handmadeEstimate({ ...d, bom }, w)
  } catch (e) {
    costError = (e as Error).message
  }
  const inputs = w.ingredients.filter((i) =>
    ['material', 'packaging'].includes(i.usedAs),
  )
  const lines = bom.lines as Item[]
  const updateLine = (index: number, patch: Partial<Item>) =>
    changeBom(
      'lines',
      lines.map((l, n) => (n === index ? { ...l, ...patch } : l)),
    )
  const content = (
    <div className="handmade-editor">
      <h2>
        {item ? 'Edit handmade product & BOM' : 'Create handmade product & BOM'}
      </h2>
      <p className="muted">
        Save updates the product and BOM together. Inventory and completed runs
        stay unchanged.
      </p>
      <form
        className="app-form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault()
          const invalid = invalidEditorTabs(e.currentTarget, 'product')
          if (invalid.length) {
            setActiveTab(invalid[0])
            setError('Review the highlighted fields before saving.')
            return
          }
          if (!c) {
            setActiveTab('bom')
            setError(costError)
            return
          }
          if (saving.current) return
          saving.current = true
          setBusy(true)
          setError('')
          try {
            await mutate('save', 'products', {
              ...d,
              bom: { ...bom, legacy: undefined },
              workflow: 'handmade',
            })
            setDirty(false)
            onDirty(false)
            close()
          } catch (e) {
            setError((e as Error).message)
          } finally {
            saving.current = false
            setBusy(false)
          }
        }}
      >
        <fieldset disabled={busy || !manage}>
          <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
            <Tabs.List
              className="add-item-tabs product-editor-tabs"
              aria-label="Product sections"
            >
              {[
                ['product', 'Product'],
                ['bom', 'Bill of Materials'],
                ['costing', 'Labor & Costing'],
              ].map(([id, label]) => (
                <Tabs.Trigger key={id} value={id} type="button">
                  {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Tabs.Content
              value="product"
              forceMount
              hidden={activeTab !== 'product'}
              data-product-tab="product"
              className="product-editor-panel"
            >
              <h3>Product details</h3>
              <div className="form-grid">
                {field('Product name', 'name')}
                {field('Selling price', 'price', 'number')}
                {field('SKU', 'sku')}
                {field('Variant group (optional)', 'variantGroup')}
                {field('Variant / size / color (optional)', 'variant')}
                <label>
                  Status
                  <select
                    value={d.archived ? 'archived' : 'active'}
                    onChange={(e) =>
                      change('archived', e.target.value === 'archived')
                    }
                  >
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
              </div>
              <label>
                Description
                <textarea
                  value={d.description || ''}
                  onChange={(e) => change('description', e.target.value)}
                />
              </label>
              <ProductCategorySelector
                business={w.settings[0]}
                product={d}
                canManage={manage}
                onChange={change}
                onConfig={(patch) =>
                  onWorkspace({
                    ...w,
                    settings: w.settings.map((s, i) =>
                      i === 0 ? { ...s, ...patch } : s,
                    ),
                  })
                }
                openTaxSettings={() =>
                  window.open(
                    '/oven#Settings/Taxes',
                    '_blank',
                    'noopener,noreferrer',
                  )
                }
              />
              <ItemImagesPanel
                value={d}
                assets={w.graphic_assets || []}
                labelArtwork={false}
                canUpload={manage}
                disabled={busy}
                onChange={change}
                onWorkspace={onWorkspace}
                onBusy={setBusy}
              />
            </Tabs.Content>
            <Tabs.Content
              value="bom"
              forceMount
              hidden={activeTab !== 'bom'}
              data-product-tab="bom"
              className="product-editor-panel"
            >
              <h3>Bill of materials</h3>
              {!item?.bom && item?.recipeId && (
                <p>
                  Legacy design retained. Saving creates a product-owned BOM;
                  existing production and sale links stay intact.
                </p>
              )}
              <div className="form-grid">
                {field(
                  'Finished units per production run',
                  'output',
                  'number',
                  true,
                )}
                {field(
                  'Expected material scrap allowance (%)',
                  'scrapPercent',
                  'number',
                  true,
                )}
              </div>
              <div className="handmade-bom-head" aria-hidden="true">
                <span>Material / packaging</span>
                <span>Quantity</span>
                <span>Unit</span>
                <span>Unit cost</span>
                <span>Extended</span>
                <span />
              </div>
              {lines.map((l, index) => (
                <div className="handmade-bom-line" key={index}>
                  <label>
                    Material or shared packaging
                    <select
                      required
                      value={l.ingredientId}
                      onChange={(e) => {
                        const i = inputs.find((i) => i.id === e.target.value)
                        updateLine(index, {
                          ingredientId: e.target.value,
                          unit: i?.unit || 'each',
                        })
                      }}
                    >
                      <option value="">Choose component</option>
                      {inputs.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                          {i.usedAs === 'packaging'
                            ? ' · Shared packaging'
                            : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Quantity
                    <input
                      required
                      type="number"
                      min="0.000001"
                      step="any"
                      value={l.quantity}
                      onChange={(e) =>
                        updateLine(index, { quantity: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Unit
                    <select
                      value={l.unit}
                      onChange={(e) =>
                        updateLine(index, { unit: e.target.value })
                      }
                    >
                      {[...new Set([...handmadeUnits, l.unit])].map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </label>
                  <span className="handmade-calculated">
                    <small>Stock unit cost</small>
                    {(() => {
                      const i = inputs.find((i) => i.id === l.ingredientId)
                      return i && !i.needsCostSetup && i.cost != null
                        ? money(i.cost) + '/' + i.unit
                        : 'Cost missing'
                    })()}
                  </span>
                  <span className="handmade-calculated">
                    <small>Extended cost</small>
                    {c?.lines[index]
                      ? money(c.lines[index].cost)
                      : 'Needs review'}
                  </span>
                  <button
                    type="button"
                    className="btn secondary"
                    aria-label={`Remove BOM line ${index + 1}`}
                    onClick={() =>
                      changeBom(
                        'lines',
                        lines.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn secondary"
                onClick={() =>
                  changeBom('lines', [
                    ...lines,
                    { ingredientId: '', quantity: 1, unit: 'each' },
                  ])
                }
              >
                Add material
              </button>
              <label>
                Production instructions & notes
                <textarea
                  value={bom.instructions || ''}
                  onChange={(e) => changeBom('instructions', e.target.value)}
                />
              </label>
            </Tabs.Content>
            <Tabs.Content
              value="costing"
              forceMount
              hidden={activeTab !== 'costing'}
              data-product-tab="costing"
              className="product-editor-panel"
            >
              <h3>Labor & production overhead</h3>
              <div className="form-grid">
                {field(
                  'Direct labor minutes per run',
                  'laborMinutes',
                  'number',
                  true,
                )}
                {field('Direct labor hourly rate', 'laborRate', 'number', true)}
                {field(
                  'Allocated production overhead per run',
                  'overhead',
                  'number',
                  true,
                )}
              </div>
              <p>
                Enter zero explicitly for excluded labor or overhead. Selling
                expenses, processing fees and outbound shipping are excluded.
              </p>
            </Tabs.Content>
          </Tabs.Root>
        </fieldset>
        <section className="calculation-box">
          <h3>Estimated production cost</h3>
          {c ? (
            <>
              <HandmadeCostSummary cost={c} />
              <p>
                {Number(bom.laborMinutes) === 0 || Number(bom.laborRate) === 0
                  ? 'Labor excluded. '
                  : 'Configured labor included. '}
                {Number(bom.overhead) === 0
                  ? 'Overhead excluded.'
                  : 'Configured overhead included.'}
              </p>
              <HandmadeMargin product={d} unitCost={c.unit} w={w} />
            </>
          ) : (
            <p>Cost incomplete: {costError}</p>
          )}
        </section>
        {error && <p role="alert">{error}</p>}
        <footer className="product-editor-actions">
          <div className="product-editor-buttons">
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={dismiss}
            >
              Cancel
            </button>
            <button className="btn" disabled={busy || !manage}>
              {busy ? 'Saving…' : 'Save product & bill of materials'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  )
  return inline ? (
    <section className="panel handmade-edit-page">{content}</section>
  ) : (
    <Dialog open onOpenChange={(v) => !v && dismiss()}>
      <DialogContent className="app-dialog wide-dialog">
        <DialogHeader>
          <DialogTitle>Handmade product</DialogTitle>
          <DialogDescription>
            Product details, bill of materials and estimated costs.
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  )
}

import { profitability } from '../lib/domain'
function HandmadeMargin({
  product,
  unitCost,
  w,
}: {
  product: Item
  unitCost: number
  w: Workspace
}) {
  try {
    if (product.price == null || product.price === '')
      throw new Error('Price missing')
    const p = profitability(product, unitCost, w.settings[0])
    return (
      <p>
        Selling price {money(product.price)} · Estimated gross profit{' '}
        {money(p.profit)}/unit · Gross margin {p.margin.toFixed(1)}%. Before
        selling expenses, excluding tax.
      </p>
    )
  } catch {
    return (
      <p>
        {product.price == null || product.price === ''
          ? 'Add a selling price to calculate margin.'
          : 'Configure category tax treatment to calculate margin.'}
      </p>
    )
  }
}

function HandmadeProductDetail({
  product: p,
  w,
  manage,
  open,
  edit,
}: {
  product: Item
  w: Workspace
  manage: boolean
  open: Props['open']
  edit: (tab: string) => void
}) {
  const [tab, setTab] = useState('Overview')
  let cost: ReturnType<typeof handmadeEstimate> | undefined,
    reason = ''
  try {
    cost = handmadeEstimate(p, w)
  } catch (e) {
    reason = (e as Error).message
  }
  const bom = handmadeBom(p, w)
  const runs = w.batches.filter((r) => r.productId === p.id)
  const movements = w.ledger.filter((r) => r.productId === p.id)
  const sales = w.sales.filter(
    (r) =>
      r.productId === p.id || r.lines?.some((l: Item) => l.productId === p.id),
  )
  return (
    <>
      <ItemDetailLayout
        item={p}
        assets={w.graphic_assets}
        kind="product"
        photoDetails={
          <>
            <p className="table-note">
              {p.description || 'No description added.'}
            </p>
            <p className="table-note">
              {[
                p.variantGroup,
                p.variant,
                p.sku,
                productCategoryName(p, w.settings[0]),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <span className={`status ${p.archived ? 'amber' : 'green'}`}>
              {p.archived ? 'Archived' : 'Active'}
            </span>
            <div className="button-row product-detail-actions">
              {manage && (
                <>
                  <button className="btn" onClick={() => edit('product')}>
                    Edit product
                  </button>
                  <button className="btn secondary" onClick={() => edit('bom')}>
                    Edit BOM
                  </button>
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="btn secondary"
                    aria-label="More product actions"
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onSelect={() =>
                      open('sale', {
                        id: crypto.randomUUID(),
                        name: p.name,
                        productId: p.id,
                        quantity: 1,
                      })
                    }
                  >
                    Record sale
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => open('label-preview', p)}>
                    Preview label
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => open('label-print', p)}>
                    Print label
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p className="table-note">
              {p.quantity || 0} finished units ·{' '}
              {p.stockCostKnown
                ? `${money(p.cost)} recorded inventory cost / unit`
                : 'Finished inventory valuation needs review.'}
            </p>
          </>
        }
      >
        {manage && !p.archived && (
          <div className="button-row">
            <button className="btn" onClick={() => open('production', p)}>
              Start production run
            </button>
          </div>
        )}
        <HandmadeCostCards product={p} cost={cost} w={w} />
        {(!p.bom || reason) && (
          <details className="calculation-box">
            <summary>
              {!p.bom
                ? 'Legacy BOM needs review.'
                : 'Estimated cost incomplete'}
            </summary>
            {reason && <p>{reason}</p>}
            {!p.bom && <p>Save a product-owned BOM before new production.</p>}
          </details>
        )}
      </ItemDetailLayout>
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List
          className="section-tabs"
          aria-label="Handmade product details"
        >
          {[
            'Overview',
            'Bill of Materials & Costing',
            'Production History',
            'Inventory & Sales',
          ].map((t) => (
            <Tabs.Trigger
              className="btn secondary"
              type="button"
              key={t}
              value={t}
            >
              {t}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content
          key={tab}
          value={tab}
          className="handmade-detail-panel"
          aria-label={tab}
        >
          <h3>{tab}</h3>
          {tab === 'Overview' && (
            <>
              <p>{p.description || 'No description added.'}</p>
              <p>
                {bom?.output || 'Unconfigured'} finished units per production
                run
                {p.variant ? ` · ${p.variant}` : ''}
              </p>
            </>
          )}
          {tab === 'Bill of Materials & Costing' && (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Material / packaging</th>
                      <th>Quantity</th>
                      <th>Unit</th>
                      <th>Extended cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bom?.lines?.map((l: Item, i: number) => (
                      <tr key={i}>
                        <td>
                          {w.ingredients.find((m) => m.id === l.ingredientId)
                            ?.name || 'Unavailable material'}
                        </td>
                        <td>{l.quantity}</td>
                        <td>{l.unit}</td>
                        <td>
                          {cost?.lines[i]
                            ? money(cost.lines[i].cost)
                            : 'Needs review'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <HandmadeCostSummary cost={cost} />
              <p>Scrap allowance: {bom?.scrapPercent ?? 'Not configured'}%</p>
              <p>{bom?.instructions || 'No production instructions added.'}</p>
              <details>
                <summary>Estimate basis</summary>
                <p>
                  Current material costs include the configured scrap allowance.
                  Labor and overhead use the saved BOM allocations. Zero
                  allocations exclude those costs. Selling expenses are
                  excluded. Completed production retains its recorded cost
                  snapshot.
                </p>
              </details>
            </>
          )}
          {tab === 'Production History' && (
            <>
              {runs.length ? (
                runs.map((r) => (
                  <div className="handmade-run" key={r.id}>
                    <span>
                      <strong>{r.name}</strong>
                      <small>
                        {r.date} · {r.status} ·{' '}
                        {r.status === 'completed'
                          ? `${r.actualYield} finished units · ${money(r.historicalCost)} recorded cost`
                          : `${r.quantity || r.yield} planned units`}
                      </small>
                    </span>
                    <button
                      className="btn secondary"
                      onClick={() => open('batch-detail', r)}
                    >
                      Review run
                    </button>
                  </div>
                ))
              ) : (
                <p>No production runs recorded for this product.</p>
              )}
            </>
          )}
          {tab === 'Inventory & Sales' && (
            <>
              <p>
                {p.quantity || 0} finished units ·{' '}
                {p.stockCostKnown
                  ? `${money(Number(p.quantity || 0) * Number(p.cost))} recorded inventory value`
                  : 'Inventory valuation needs review'}
              </p>
              <h4>Sales</h4>
              {sales.length ? (
                sales.map((r) => (
                  <p key={r.id}>
                    {r.date} · {r.quantity} units · {money(r.total ?? r.amount)}
                  </p>
                ))
              ) : (
                <p>No sales recorded for this product.</p>
              )}
              <h4>Stock movements</h4>
              {movements.length ? (
                movements.map((r) => (
                  <p key={r.id}>
                    {r.date} · {r.type} · {r.quantity} units
                  </p>
                ))
              ) : (
                <p>No product stock movements recorded.</p>
              )}
              <details>
                <summary>Inventory costing</summary>
                <p>
                  Finished goods retain perpetual weighted-average valuation.
                  COGS is recorded when units are sold. Editing a product or BOM
                  does not move stock or rewrite historical costs.
                </p>
              </details>
            </>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </>
  )
}

/** Uses the food popup's cost-card palette; amounts remain BOM estimates. */
function HandmadeCostCards({
  product,
  cost,
  w,
}: {
  product: Item
  cost?: ReturnType<typeof handmadeEstimate>
  w: Workspace
}) {
  let pricing: ReturnType<typeof profitability> | undefined
  let pricingReason = ''
  const missingPrice =
    product.price == null || String(product.price).trim() === ''
  if (missingPrice) pricingReason = 'Add a selling price.'
  else if (!cost) pricingReason = 'Complete BOM costs.'
  else {
    try {
      pricing = profitability(product, cost.unit, w.settings[0])
    } catch (e) {
      pricingReason = (e as Error).message
    }
  }
  const target = Number(product.targetMargin ?? 65)
  return (
    <div className="pricing-summary cost-summary">
      <div
        className="cost-card-grid cost-breakdown-grid"
        aria-label="Estimated cost breakdown per production run"
      >
        <CostCard
          label="Materials"
          value={cost ? costMoney(cost.materials) : 'Incomplete'}
          note="Estimated per run · includes scrap"
          tone="lavender"
        />
        <CostCard
          label="Packaging"
          value={cost ? costMoney(cost.packaging) : 'Incomplete'}
          note="Estimated per run"
          tone="blue"
        />
        <CostCard
          label="Direct labor"
          value={cost ? costMoney(cost.labor) : 'Incomplete'}
          note={
            cost?.labor === 0
              ? 'Excluded · saved zero allocation'
              : 'Estimated per run'
          }
          tone="peach"
        />
        <CostCard
          label="Allocated overhead"
          value={cost ? costMoney(cost.overhead) : 'Incomplete'}
          note={
            cost?.overhead === 0
              ? 'Excluded · saved zero allocation'
              : 'Estimated per run'
          }
          tone="neutral"
        />
      </div>
      <div className="detail-stats cost-card-grid">
        <CostCard
          label="Cost per finished unit"
          value={cost ? costMoney(cost.unit) : 'Incomplete'}
          note="Estimated from current BOM"
        />
        <CostCard
          label="Selling price"
          value={missingPrice ? 'Price missing' : money(product.price)}
          note="Saved selling price"
          tone="blue"
        />
        <CostCard
          label="Estimated profit / unit"
          value={pricing ? money(pricing.profit) : 'Incomplete'}
          note={pricing ? 'Revenue less cost; excludes tax' : pricingReason}
          tone="green"
        />
      </div>
      <div className="cost-card-grid">
        <CostCard
          label="Estimated margin"
          value={pricing ? `${pricing.margin.toFixed(2)}%` : 'Incomplete'}
          note={pricing ? `Target margin: ${target}%` : pricingReason}
          tone={pricing && pricing.margin >= target ? 'green' : 'peach'}
        />
        <CostCard
          label="Total production cost"
          value={cost ? costMoney(cost.total) : 'Incomplete'}
          note="Estimated per production run"
        />
        <CostCard
          label="Finished stock"
          value={`${product.quantity || 0} units`}
          note="Recorded finished inventory"
          tone="neutral"
        />
      </div>
      <details className="calculation-box">
        <summary>How this is calculated</summary>
        <p>
          Materials (including scrap), packaging, direct labor and allocated
          production overhead form the estimated run cost, divided by{' '}
          {handmadeBom(product, w)?.output || 'the configured'} finished units.
          Zero labor or overhead allocations exclude those costs. Selling
          expenses are excluded.
        </p>
        <p>
          Profit uses revenue excluding configured tax less estimated unit cost.
          Margin is profit divided by revenue. Recorded production snapshots,
          inventory valuation and sales COGS remain separate from these
          estimates.
        </p>
      </details>
    </div>
  )
}

function HandmadeCostSummary({
  cost,
}: {
  cost?: ReturnType<typeof handmadeEstimate>
}) {
  return (
    <dl className="handmade-facts">
      {[
        ['Materials', cost?.materials],
        ['Packaging', cost?.packaging],
        ['Labor', cost?.labor],
        ['Overhead', cost?.overhead],
        ['Total production cost', cost?.total],
        ['Cost per finished unit', cost?.unit],
      ].map(([label, value]) => (
        <div key={label as string}>
          <dt>{label}</dt>
          <dd>{value == null ? 'Incomplete' : money(Number(value))}</dd>
        </div>
      ))}
    </dl>
  )
}
