import { useRef, useState } from 'react'
import { ChevronDown, MoreHorizontal, Plus } from 'lucide-react'
import {
  costBreakdown,
  convert,
  money,
  packagingLines,
  type Item,
  type Workspace,
} from '@/lib/domain'
import { singularYield } from '@/lib/product-recipe-links'
import { precise } from '@/lib/ingredients'
import { PantryPhoto } from './pantry-photo'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu'
import './recipe-detail.css'
export function RecipeDetail({
  recipe: r,
  workspace: w,
  ready,
  canEdit,
  open,
  close,
  save,
}: {
  recipe: Item
  workspace: Workspace
  ready: boolean
  canEdit: boolean
  open: (kind: string, item?: Item) => void
  close: () => void
  save: (data: any) => Promise<void>
}) {
  const [stage, setStage] = useState<
      'details' | 'picker' | 'review' | 'unlink'
    >('details'),
    [search, setSearch] = useState(''),
    [chosen, setChosen] = useState<Item | null>(null),
    [quantity, setQuantity] = useState(''),
    [sellingUnit, setSellingUnit] = useState(''),
    [confirm, setConfirm] = useState(false),
    [replace, setReplace] = useState(false),
    [packaging, setPackaging] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const pending = useRef(false)
  const linked = w.products.filter((p) => p.recipeId === r.id)
  const product = w.products.find((p) => p.id === chosen?.id)
  const existing = w.recipes.find((x) => x.id === product?.recipeId)
  const pick = (p: Item) => {
    setChosen(p)
    setQuantity(p.recipeId === r.id ? String(p.unitsPerPackage) : '')
    setSellingUnit(p.sellingUnit || '')
    setConfirm(false)
    setReplace(false)
    setPackaging(false)
    setError('')
    setStage('review')
  }
  const start = () => {
    setSearch('')
    setStage('picker')
    setError('')
  }
  const create = () =>
    open('product', {
      id: '',
      name: r.name,
      recipeId: r.id,
      unitsPerPackage: 1,
      price: '',
      targetMargin: 65,
    })
  let cost: ReturnType<typeof costBreakdown> | undefined,
    warning = ''
  try {
    cost = costBreakdown(r, w.ingredients)
  } catch (e) {
    warning = (e as Error).message
  }
  const run = async (operation: 'link' | 'unlink') => {
    if (pending.current || !product) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await save({
        operation,
        productId: product.id,
        recipeId: r.id,
        expectedRecipeId: product.recipeId || '',
        outputQuantity: quantity,
        outputUnit: r.yieldUnit,
        sellingUnit,
        confirm: true,
        mappingConfirmed: confirm,
        replaceConfirmed: replace,
        packagingConfirmed: packaging,
      })
      setStage('details')
      setChosen(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const duplicatePackaging =
    !!product &&
    Number(r.packagingCost) > 0 &&
    packagingLines(product).length > 0
  return (
    <>
      <div className="recipe-detail-body">
        {error && (
          <p className="warning-text" role="alert">
            {error}
          </p>
        )}
        {stage === 'details' ? (
          <>
            <div className="recipe-meta">
              {r.laborMinutes != null && (
                <span>Costing labor {r.laborMinutes} min</span>
              )}
              {r.prepMinutes != null && <span>Prep {r.prepMinutes} min</span>}
              {r.cookMinutes != null && <span>Cook {r.cookMinutes} min</span>}
            </div>
            <dl className="recipe-summary">
              <div>
                <dt>Recipe yield</dt>
                <dd>
                  {r.yield
                    ? `${precise(r.yield)} ${r.yieldUnit || 'items'}`
                    : 'Not recorded'}
                </dd>
              </div>
              <div>
                <dt>Total batch cost</dt>
                <dd>{cost ? money(cost.total) : 'Unavailable'}</dd>
              </div>
              <div>
                <dt>Cost per {singularYield(r.yieldUnit)}</dt>
                <dd>{cost ? money(cost.perItem) : 'Unavailable'}</dd>
              </div>
            </dl>
            {warning && (
              <p className="warning-text" role="alert">
                Cost incomplete: {warning} Open Cost breakdown to review
                conversions.
              </p>
            )}
            <details className="recipe-breakdown">
              <summary>Cost breakdown</summary>
              {cost && (
                <>
                  <dl>
                    {[
                      ['Ingredients', cost.ingredient],
                      ['Packaging', cost.packagingCost],
                      ['Labor', cost.labor],
                      ['Overhead', cost.overhead],
                      ['Waste allowance', cost.waste],
                      ['Total batch cost', cost.total],
                      [`Cost per ${singularYield(r.yieldUnit)}`, cost.perItem],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{money(Number(value))}</dd>
                      </div>
                    ))}
                  </dl>
                  <p>
                    Labor: {cost.laborMinutes} minutes ÷ 60 × {cost.laborRate}.
                    Imported prep/cook times are separate from paid labor.
                    Overhead uses the {r.overheadMode || 'batch'} method. Waste
                    is{' '}
                    {r.wasteMode === 'actual'
                      ? 'the recorded additional waste cost'
                      : `${r.wastePercent || 0}% of ingredients, packaging, labor and overhead`}
                    . Total batch cost ÷ {cost.actualYield} ={' '}
                    {cost.perItem.toFixed(6)} per {singularYield(r.yieldUnit)}.
                  </p>
                </>
              )}
              {(r.lines || []).map((l: any, index: number) => {
                const i = w.ingredients.find((i) => i.id === l.ingredientId)
                let text = 'Ingredient unavailable',
                  needs = false
                if (i)
                  try {
                    const normalized = convert(
                      l.quantity,
                      l.unit,
                      i.unit,
                      i.conversions,
                    )
                    text = `${precise(l.quantity)} ${l.unit} = ${precise(normalized)} ${i.unit} × ${precise(i.currentCost ?? i.cost)} = ${money(normalized * (i.currentCost ?? i.cost))}`
                  } catch (e) {
                    text = (e as Error).message
                    needs = true
                  }
                return (
                  <div key={index}>
                    <p>
                      {i?.name}: {text}
                    </p>
                    {needs && i && (
                      <button
                        className="text-button"
                        onClick={() => open('ingredient-detail', i)}
                      >
                        Review ingredient conversion
                      </button>
                    )}
                  </div>
                )
              })}
            </details>
            <section aria-label="Ingredients">
              <h3>Ingredients</h3>
              <table className="recipe-ingredients">
                <thead>
                  <tr>
                    <th>Ingredient</th>
                    <th>Quantity</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(r.lines || []).map((l: any, index: number) => {
                    const i = w.ingredients.find((i) => i.id === l.ingredientId)
                    let amount: number | undefined,
                      issue = ''
                    try {
                      if (
                        !i ||
                        i.needsCostSetup ||
                        !Number.isFinite(i.currentCost ?? i.cost)
                      )
                        throw new Error('Cost needs setup')
                      amount =
                        convert(l.quantity, l.unit, i.unit, i.conversions) *
                        (i.currentCost ?? i.cost)
                    } catch (e) {
                      issue = (e as Error).message
                    }
                    return (
                      <tr key={index}>
                        <td>
                          {i ? (
                            <button
                              className="text-button"
                              onClick={() => open('ingredient-detail', i)}
                            >
                              {i.name}
                            </button>
                          ) : (
                            l.originalText || 'Unresolved ingredient'
                          )}
                          {l.group && <small>{l.group}</small>}
                          {l.preparation && <small>{l.preparation}</small>}
                          {issue && (
                            <small className="warning-text">{issue}</small>
                          )}
                        </td>
                        <td>
                          {precise(l.quantity)} {l.unit}
                        </td>
                        <td>
                          {amount == null ? 'Needs setup' : money(amount)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
            <section className="recipe-method">
              <h3>Method</h3>
              {Array.isArray(r.instructions) ? (
                <ol>
                  {r.instructions.map((step: any, index: number) => (
                    <li key={index}>
                      {typeof step === 'string' ? step : step.text}
                    </li>
                  ))}
                </ol>
              ) : r.instructions ? (
                <div className="recipe-method-blocks">
                  {String(r.instructions)
                    .split(/\n\s*\n/)
                    .map((block, index) =>
                      block.trim().endsWith(':') &&
                      block.trim().length <= 200 &&
                      !block.trim().includes('\n') ? (
                        <h4 key={index}>{block}</h4>
                      ) : (
                        <p key={index}>{block}</p>
                      ),
                    )}
                </div>
              ) : (
                <p>No instructions added yet.</p>
              )}
            </section>
            {!!r.optionalAdditions?.length && (
              <section
                className="recipe-method"
                aria-label="Optional additions"
              >
                <h3>Optional additions</h3>
                <p>Excluded from required ingredient costing.</p>
                <ul>
                  {r.optionalAdditions.map((line: any, index: number) => (
                    <li key={index}>
                      {typeof line === 'string' ? line : line.original}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="recipe-links" aria-label="Linked products">
              <div className="recipe-links-heading">
                <h3>Linked products</h3>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="btn secondary recipe-add-product"
                      disabled={!ready || !canEdit}
                    >
                      <Plus size={14} aria-hidden="true" /> Add product
                      <ChevronDown size={14} aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={start}>
                      Link existing product
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={create}>
                      Create new product
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {!ready ? (
                <p role="status">Loading products…</p>
              ) : linked.length ? (
                linked.map((p) => (
                  <div className="linked-product" key={p.id}>
                    <div>
                      <button
                        className="linked-product-name"
                        onClick={() => open('product-detail', p)}
                      >
                        {p.name}
                      </button>
                      {p.sku && <small>SKU {p.sku}</small>}
                      <small>
                        {precise(p.unitsPerPackage)}{' '}
                        {Number(p.unitsPerPackage) === 1
                          ? singularYield(r.yieldUnit)
                          : r.yieldUnit}{' '}
                        per {p.sellingUnit || 'sellable package'}
                      </small>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="btn secondary linked-product-options"
                          aria-label={`Options for ${p.name}`}
                          disabled={!canEdit}
                        >
                          <MoreHorizontal size={18} aria-hidden="true" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => pick(p)}>
                          Manage link
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            setChosen(p)
                            setStage('unlink')
                          }}
                        >
                          Unlink
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))
              ) : (
                <p>No products linked yet.</p>
              )}
            </section>
            {(r.importProvenance || r.notes || r.sourceUrl) && (
              <details className="recipe-breakdown">
                <summary>Notes & source</summary>
                {r.notes && <p>{r.notes}</p>}
                {(r.sourceAttribution || []).map(
                  (text: string, index: number) => (
                    <p key={index}>{text}</p>
                  ),
                )}
                {(r.sourceUrl || r.importProvenance?.sourceUrl) && (
                  <p>
                    <a
                      href={r.sourceUrl || r.importProvenance.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open original recipe URL
                    </a>
                  </p>
                )}
                {r.importProvenance && (
                  <p>
                    Imported from{' '}
                    {r.importProvenance.sourceApp || 'recipe source'}
                    {r.author ? ` · ${r.author}` : ''}.{' '}
                    <a
                      href={
                        '/api/workspace?recipeImportFile=' +
                        encodeURIComponent(r.importProvenance.importId) +
                        '&download=1'
                      }
                    >
                      Download original recipe source
                    </a>
                  </p>
                )}
              </details>
            )}
          </>
        ) : stage === 'picker' ? (
          <section>
            <h3>Link existing product</h3>
            <p>
              Choose a product in this oven. Each product has one source recipe;
              this recipe may supply several products.
            </p>
            <label className="field">
              <span>Search products by name or SKU</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {!ready ? (
              <p role="status">Loading oven products…</p>
            ) : (
              <div className="product-link-results">
                {w.products
                  .filter(
                    (p) =>
                      !p.archived &&
                      p.status !== 'archived' &&
                      `${p.name} ${p.sku || ''}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  )
                  .map((p) => (
                    <button
                      className="product-link-result"
                      key={p.id}
                      onClick={() => pick(p)}
                    >
                      <PantryPhoto item={p} assets={w.graphic_assets} />
                      <span>
                        <strong>{p.name}</strong>
                        <small>
                          {p.sku ? `SKU ${p.sku} · ` : ''}
                          {w.recipes.find((r) => r.id === p.recipeId)?.name ||
                            'No recipe linked'}
                        </small>
                      </span>
                    </button>
                  ))}
                {!w.products.some(
                  (p) =>
                    !p.archived &&
                    p.status !== 'archived' &&
                    `${p.name} ${p.sku || ''}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                ) && (
                  <p>No matching active products. Try another name or SKU.</p>
                )}
              </div>
            )}
          </section>
        ) : stage === 'unlink' ? (
          <section>
            <h3>Unlink {product?.name}?</h3>
            <p>
              This removes only the connection to {r.name}. Current recipe-based
              product cost estimates become unavailable until another recipe is
              linked. Neither record is deleted. Prices, stock and historical
              production and sales costs are preserved.
            </p>
          </section>
        ) : product ? (
          <section className="product-link-review">
            <h3>Review recipe connection</h3>
            <p>
              <strong>{r.name}</strong> → <strong>{product.name}</strong>
            </p>
            <p>
              Recipe production yield: {r.yield} {r.yieldUnit}. Current source:{' '}
              {existing?.name || 'No recipe linked'}.
            </p>
            {existing && existing.id !== r.id && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => setReplace(e.target.checked)}
                />
                Replace {existing.name} as this product’s sole source recipe.
              </label>
            )}
            <label className="field">
              <span>Product selling unit (for example loaf, box or pack)</span>
              <input
                maxLength={80}
                value={sellingUnit}
                onChange={(e) => setSellingUnit(e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                Recipe output quantity per sellable product ({r.yieldUnit})
              </span>
              <input
                type="number"
                min="0.000001"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <p>
              One sellable {sellingUnit || 'product'} uses {quantity || '…'}{' '}
              {r.yieldUnit} of recipe output. Enter a measured mapping for
              packs, slices or different measurement units; no conversion is
              guessed.
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
              />
              I verified this output-to-selling-unit mapping.
            </label>
            {duplicatePackaging && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={packaging}
                  onChange={(e) => setPackaging(e.target.checked)}
                />
                I verified that recipe batch packaging and this product’s
                packaging are distinct costs, not duplicate charges.
              </label>
            )}
            <p>
              Future estimates use the existing recipe costing and product
              packaging rules. Labor and overhead stay in recipe costs. Selling
              price ({money(product.price)}) and historical costs do not change.
            </p>
            {!cost && (
              <p className="warning-text">
                Cost incomplete — finish recipe cost setup before relying on
                product estimates.
              </p>
            )}
          </section>
        ) : (
          <p role="alert">
            This product is no longer available. Cancel and reload the oven.
          </p>
        )}
      </div>
      <footer className="recipe-detail-footer">
        {stage === 'details' ? (
          <>
            <button
              className="btn secondary recipe-footer-close"
              onClick={close}
            >
              Close
            </button>
            <button
              className="btn"
              disabled={!canEdit}
              onClick={() =>
                open('batch', {
                  id: '',
                  name: r.name,
                  recipeId: r.id,
                  count: 1,
                  date: new Date().toISOString().slice(0, 10),
                })
              }
            >
              Plan a batch
            </button>
            <button
              className="btn secondary"
              disabled={!canEdit}
              onClick={() => open('recipe', r)}
            >
              Edit Recipe
            </button>
          </>
        ) : (
          <>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => {
                setStage('details')
                setError('')
              }}
            >
              Cancel
            </button>
            {stage !== 'picker' && (
              <button
                className="btn"
                disabled={
                  busy ||
                  !canEdit ||
                  !product ||
                  (stage === 'review' &&
                    (!confirm ||
                      !sellingUnit.trim() ||
                      !(Number(quantity) > 0) ||
                      (existing && existing.id !== r.id && !replace) ||
                      (duplicatePackaging && !packaging)))
                }
                onClick={() => void run(stage === 'unlink' ? 'unlink' : 'link')}
              >
                {busy
                  ? 'Saving…'
                  : stage === 'unlink'
                    ? 'Confirm unlink'
                    : 'Confirm link'}
              </button>
            )}
          </>
        )}
      </footer>
    </>
  )
}
