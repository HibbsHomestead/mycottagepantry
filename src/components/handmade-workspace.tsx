import { isFabric } from '../lib/fabric'
import { useRef, useState } from 'react'
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
import { PantryPhoto } from './pantry-photo'
import './handmade-workspace.css'

type Mutate = (action: string, table: string, data: Item) => Promise<unknown>
type Props = {
  workspace: Workspace
  role: string
  mutate: Mutate
  open: (kind: string, item?: Item) => void
  tab: string
  onWorkspace: (w: Workspace) => void
}
export function HandmadeWorkspace({
  workspace: w,
  role,
  mutate,
  open,
  tab,
}: Props) {
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
  return (
    <div className="handmade-workspace">
      <section className="handmade-intro">
        <div>
          <span className="eyebrow">THE MAKER’S WORKBENCH</span>
          <h2>{tab}</h2>
          <p>Materials in. Finished work out. Know what every piece costs.</p>
        </div>
        <div className="button-row">
          {manage && (
            <>
              <button className="btn secondary" onClick={() => editMaterial()}>
                Add material
              </button>
              <button className="btn" onClick={() => open('trade-product')}>
                Create handmade product
              </button>
            </>
          )}
        </div>
      </section>
      {tab === 'Overview' && (
        <>
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
              <strong>{products.filter((p) => !estimate(p)).length}</strong>
              <span>Products needing cost review</span>
            </div>
          </div>
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
                {materials.map((i) => (
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
        <section className="panel">
          <h3>
            {tab === 'Finished Inventory'
              ? 'Finished goods · recorded valuation'
              : 'Products & bills of materials'}
          </h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product / variant</th>
                  <th>Finished stock</th>
                  <th>Selling price</th>
                  <th>Estimated unit cost</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const c = estimate(p)
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="handmade-product">
                          <PantryPhoto
                            item={p}
                            assets={w.graphic_assets}
                            kind="product"
                          />
                          <span>
                            <strong>{p.name}</strong>
                            <small>
                              {p.variantGroup} {p.variant} · {p.sku}{' '}
                              {p.archived && ' · Archived'}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td>
                        {p.quantity || 0} units
                        <small>
                          {p.stockCostKnown
                            ? `${money(Number(p.quantity || 0) * Number(p.cost))} inventory value · ${money(p.cost)}/unit weighted average`
                            : 'Inventory cost needs review'}
                        </small>
                      </td>
                      <td>{money(p.price)}</td>
                      <td>
                        {c ? money(c.unit) : 'Cost incomplete'}
                        {c && (
                          <HandmadeMargin product={p} unitCost={c.unit} w={w} />
                        )}
                      </td>
                      <td>
                        <div className="button-row">
                          {manage && (
                            <button
                              className="btn secondary"
                              onClick={() => open('trade-product', p)}
                            >
                              Edit BOM
                            </button>
                          )}
                          {manage && !p.archived && (
                            <button
                              className="btn secondary"
                              onClick={() => open('production', p)}
                            >
                              Production run
                            </button>
                          )}
                          <button
                            className="btn secondary"
                            onClick={() =>
                              open('sale', {
                                id: crypto.randomUUID(),
                                name: p.name,
                                productId: p.id,
                                quantity: 1,
                              })
                            }
                          >
                            Record sale
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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
  mutate,
  close,
}: {
  item: Item
  receipt: boolean
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
                  {field('Category', 'materialCategory')}
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
}) {
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
    onDirty(true)
    setD((v) => ({ ...v, [k]: value }))
  }
  const changeBom = (k: string, value: unknown) => {
    onDirty(true)
    setBom((v) => ({ ...v, [k]: value }))
  }
  const field = (label: string, k: string, type = 'text', b = false) => (
    <label>
      {label}
      <input
        type={type}
        step={type === 'number' ? 'any' : undefined}
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
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) {
          onDirty(false)
          close()
        }
      }}
    >
      <DialogContent className="app-dialog wide-dialog handmade-editor">
        <DialogHeader>
          <DialogTitle>
            {item
              ? 'Edit handmade product & BOM'
              : 'Create handmade product & BOM'}
          </DialogTitle>
          <DialogDescription>
            Each product and variant has its own bill of materials and stock.
            Saving changes never rewrites completed runs or moves inventory.
          </DialogDescription>
        </DialogHeader>
        <form
          className="app-form"
          onSubmit={async (e) => {
            e.preventDefault()
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
              canUpload={manage}
              disabled={busy}
              onChange={change}
              onWorkspace={onWorkspace}
              onBusy={setBusy}
            />
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
                        {i.usedAs === 'packaging' ? ' · Shared packaging' : ''}
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
                <span>
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
              Add BOM component
            </button>
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
            <label>
              Production instructions & notes
              <textarea
                value={bom.instructions || ''}
                onChange={(e) => changeBom('instructions', e.target.value)}
              />
            </label>
          </fieldset>
          <section className="calculation-box">
            <h3>Estimated production cost</h3>
            {c ? (
              <>
                <p>
                  Materials {money(c.materials)} · Packaging{' '}
                  {money(c.packaging)} · Direct labor {money(c.labor)} ·
                  Overhead {money(c.overhead)}
                </p>
                <p>
                  Total run {money(c.total)} ·{' '}
                  <strong>{money(c.unit)} per sellable unit</strong>
                </p>
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
          <button className="btn" disabled={busy || !manage}>
            {busy ? 'Saving…' : 'Save product & bill of materials'}
          </button>
        </form>
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
    const p = profitability(product, unitCost, w.settings[0])
    return (
      <p>
        Selling price {money(product.price)} · Estimated gross profit{' '}
        {money(p.profit)}/unit · Gross margin {p.margin.toFixed(1)}% (profit ÷
        tax-exclusive revenue). Before selling expenses.
      </p>
    )
  } catch {
    return (
      <p>
        Estimated margin needs a selling price and configured category tax
        treatment.
      </p>
    )
  }
}
