import { useState } from 'react'
import { ItemEditorShell } from './item-editor-shell'
import { ProductArtworkFields } from './product-artwork-fields'
import {
  productCosting,
  profitability,
  packagingLines,
  effectiveRecipeLines,
  money,
  type Item,
} from '@/lib/domain'
import type { ProductEditor } from './product-editor'

type Props = Parameters<typeof ProductEditor>[0] & {
  onSaved?: () => void
  openProduct: (item: Item) => void
}
export function KitEditor({
  item,
  workspace,
  role,
  mutate,
  onWorkspace,
  close,
  onDirty,
  openProduct,
  onSaved,
}: Props) {
  const [draft, setDraft] = useState<Item>(() =>
    item
      ? { ...item }
      : {
          id: crypto.randomUUID(),
          name: '',
          workflow: 'kit',
          status: 'draft',
          kitComponents: [],
          packagingLines: [],
          price: '',
          assemblyMinutes: 0,
          assemblyRate: 0,
        },
  )
  const [tab, setTab] = useState('contents')
  const [busy, setBusy] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [error, setError] = useState('')
  const change = (key: string, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }))
    onDirty(true)
  }
  const components: Item[] = draft.kitComponents || []
  const packaging: Item[] = draft.packagingLines || []
  const updateLine = (
    key: string,
    rows: Item[],
    index: number,
    field: string,
    value: unknown,
  ) =>
    change(
      key,
      rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    )
  let estimate:
    | {
        cost: ReturnType<typeof productCosting>
        pricing: ReturnType<typeof profitability>
      }
    | undefined
  let estimateError = ''
  try {
    const cost = productCosting(draft, workspace)
    estimate = {
      cost,
      pricing: profitability(draft, cost.perPackage, workspace.settings[0]),
    }
  } catch (e) {
    estimateError = (e as Error).message
  }
  const summary = estimate ? (
    <>
      <p>Included packages: {money(estimate.cost.ingredient)}</p>
      <p>Kit packaging: {money(estimate.cost.packagingCost)}</p>
      <p>Additional assembly: {money(estimate.cost.labor)}</p>
      <p>
        <strong>Total / sellable kit: {money(estimate.cost.perPackage)}</strong>
      </p>
      <p>Selling price: {money(Number(draft.price))}</p>
      <p>
        Profit excluding tax: {money(estimate.pricing.profit)} · Margin:{' '}
        {estimate.pricing.margin.toFixed(1)}%
      </p>
    </>
  ) : (
    <p role="status">
      Estimate incomplete: {draft.name || 'This kit'}: {estimateError}
      {estimateError.includes('category') ||
      estimateError.includes('Tax treatment')
        ? ' Review this kit’s Category in Contents & details, then its classification and tax treatment in Products → Categories.'
        : ' Review the referenced component or kit packaging configuration.'}
      <button
        type="button"
        className="text-button"
        onClick={() => setTab('contents')}
      >
        Review contents &amp; details
      </button>
    </p>
  )
  const contents = (
    <>
      <label className="field">
        <span>Kit name</span>
        <input
          required
          value={draft.name}
          onChange={(e) => change('name', e.target.value)}
        />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea
          value={draft.description || ''}
          onChange={(e) => change('description', e.target.value)}
        />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Category</span>
          <select
            value={draft.productCategoryId || ''}
            onChange={(e) => change('productCategoryId', e.target.value)}
          >
            <option value="">Unassigned</option>
            {(workspace.settings[0]?.productCategories || [])
              .filter(
                (c: Item) =>
                  c.active !== false || c.id === draft.productCategoryId,
              )
              .map((c: Item) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select
            value={draft.status}
            onChange={(e) => change('status', e.target.value)}
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
          </select>
        </label>
      </div>
      <label>
        <input
          type="checkbox"
          checked={draft.archived === true}
          onChange={(e) => change('archived', e.target.checked)}
        />{' '}
        Archived / inactive kit
      </label>
      <h3>Included products</h3>
      <p className="form-hint">
        Whole selling packages include existing production labor, overhead and
        attached packaging. Individual unpackaged contents are unavailable
        because a separate unpackaged cost basis is not configured.
      </p>
      {components.map((line, index) => {
        const p = workspace.products.find((p) => p.id === line.productId)
        let contribution = 'Cost unavailable'
        try {
          if (p)
            contribution = money(
              productCosting(
                {
                  ...draft,
                  kitComponents: [line],
                  packagingLines: [],
                  assemblyMinutes: 0,
                },
                workspace,
              ).perPackage,
            )
        } catch {
          /* Incomplete sources remain visible. */
        }
        return (
          <section className="calculation-box" key={line.productId}>
            <button
              type="button"
              className="text-button"
              onClick={() => p && openProduct(p)}
            >
              {p?.name || `Unavailable product ${line.productId}`}
            </button>
            {p?.archived && <small> Archived component</small>}
            <p>
              {p?.sellingUnit || 'Selling package'}
              {p?.unitsPerPackage
                ? ` · ${p.unitsPerPackage} ${p.contentUnit || workspace.recipes.find((r) => r.id === p.recipeId)?.yieldUnit || 'contents'} per package`
                : ' · Contents per package not configured'}
            </p>
            <label className="field">
              <span>Whole selling packages</span>
              <input
                type="number"
                min="1"
                step="1"
                required
                value={line.quantity}
                onChange={(e) =>
                  updateLine(
                    'kitComponents',
                    components,
                    index,
                    'quantity',
                    e.target.value,
                  )
                }
              />
            </label>
            <p>{contribution} · Complete component package cost</p>
            <p className="form-hint">
              {p?.workflow === 'resale'
                ? 'Includes recorded received-item cost. Production labor and packaging are not added again.'
                : `Includes component production labor, overhead and existing packaging. Attached selling packaging: ${
                    p && packagingLines(p).length
                      ? packagingLines(p)
                          .map(
                            (l: Item) =>
                              `${l.quantity} ${l.unit || 'each'} ${workspace.ingredients.find((i) => i.id === l.ingredientId)?.name || 'Unavailable packaging'}`,
                          )
                          .join(', ')
                      : 'No separate selling packaging configured. Production packaging remains included.'
                  }`}
            </p>
            <ComponentSources product={p} workspace={workspace} />

            <p className="form-hint">
              Ingredient/allergen information belongs to this component. Review
              its source statement and missing data; this is not a verified kit
              label.
            </p>
            <button
              type="button"
              className="btn secondary"
              onClick={() =>
                change(
                  'kitComponents',
                  components.filter((_, i) => i !== index),
                )
              }
            >
              Remove component
            </button>
          </section>
        )
      })}
      <label className="field">
        <span>Add existing product</span>
        <select
          value=""
          onChange={(e) =>
            e.target.value &&
            change('kitComponents', [
              ...components,
              { productId: e.target.value, quantity: 1, basis: 'package' },
            ])
          }
        >
          <option value="">Choose product…</option>
          {workspace.products
            .filter(
              (p) =>
                p.workflow !== 'kit' &&
                !p.archived &&
                !components.some((c) => c.productId === p.id),
            )
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      <p className="form-hint">
        Definition only: saving, activating and previewing do not move or
        reserve stock. Kit fulfillment, preassembly and sales are unavailable;
        produce components separately.
      </p>
    </>
  )
  const pricing = (
    <>
      <h3>Kit-specific packaging</h3>
      {packaging.map((line, index) => (
        <div className="calculation-box" key={line.ingredientId}>
          <p>
            {workspace.ingredients.find((i) => i.id === line.ingredientId)
              ?.name || line.ingredientId}
          </p>
          <label className="field">
            <span>Quantity ({line.unit})</span>
            <input
              required
              type="number"
              min="0.000001"
              step="any"
              value={line.quantity}
              onChange={(e) =>
                updateLine(
                  'packagingLines',
                  packaging,
                  index,
                  'quantity',
                  e.target.value,
                )
              }
            />
          </label>
          <button
            type="button"
            className="btn secondary"
            onClick={() =>
              change(
                'packagingLines',
                packaging.filter((_, i) => i !== index),
              )
            }
          >
            Remove packaging
          </button>
        </div>
      ))}
      <label className="field">
        <span>Add kit packaging</span>
        <select
          value=""
          onChange={(e) => {
            const p = workspace.ingredients.find((i) => i.id === e.target.value)
            if (p)
              change('packagingLines', [
                ...packaging,
                { ingredientId: p.id, unit: p.unit, quantity: 1 },
              ])
          }}
        >
          <option value="">Choose packaging…</option>
          {workspace.ingredients
            .filter(
              (i) =>
                i.usedAs === 'packaging' &&
                !i.archived &&
                !packaging.some((p) => p.ingredientId === i.id),
            )
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
        </select>
      </label>
      {[
        ['assemblyMinutes', 'Additional assembly minutes'],
        ['assemblyRate', 'Assembly hourly rate'],
        ['price', 'Kit selling price'],
      ].map(([key, label]) => (
        <label className="field" key={key}>
          <span>{label}</span>
          <input
            type="number"
            min="0"
            step="any"
            required
            value={draft[key]}
            onChange={(e) => change(key, e.target.value)}
          />
        </label>
      ))}
      {summary}
    </>
  )
  return (
    <ItemEditorShell
      title={item ? `Kit · ${item.name}` : 'Create kit'}
      description="Fixed contents, one selling price. Current estimates follow current component costs."
      tabs={[
        { id: 'contents', label: 'Contents & details', content: contents },
        { id: 'cost', label: 'Packaging & cost', content: pricing },
        {
          id: 'photo',
          label: 'Photo',
          content: (
            <ProductArtworkFields
              assets={workspace.graphic_assets || []}
              value={draft}
              onChange={change}
              onWorkspace={onWorkspace}
              canUpload={['Owner', 'Manager'].includes(role)}
              onBusy={setUploadBusy}
              only={['imageAssetId']}
            />
          ),
        },
      ]}
      tab={tab}
      onTab={setTab}
      errorTabs={[]}
      summary={summary}
      summaryTab="cost"
      disabled={busy || uploadBusy || !['Owner', 'Manager'].includes(role)}
      busy={busy}
      submitDisabled={
        busy || uploadBusy || !['Owner', 'Manager'].includes(role)
      }
      submitLabel="Save kit"
      error={error}
      cancel={close}
      onSubmit={async () => {
        if (busy) return
        setBusy(true)
        setError('')
        try {
          await mutate('save', 'products', draft)
          onDirty(false)
          if (onSaved) onSaved()
          else close()
        } catch (e) {
          setError((e as Error).message)
        } finally {
          setBusy(false)
        }
      }}
    />
  )
}

function ComponentSources({
  product,
  workspace,
}: {
  product: Item | undefined
  workspace: Props['workspace']
}) {
  let sources: Item[] = []
  let issue = ''
  try {
    const recipe = workspace.recipes.find((r) => r.id === product?.recipeId)
    if (!recipe)
      issue =
        'No recipe ingredient provenance is configured for this component. Review its supplier statement separately.'
    else
      sources = effectiveRecipeLines(recipe, workspace.recipes).map(
        (line: Item) =>
          workspace.ingredients.find((i) => i.id === line.ingredientId) || {
            id: line.ingredientId,
            name: 'Unavailable ingredient source',
          },
      )
  } catch (e) {
    issue = (e as Error).message
  }
  return (
    <details>
      <summary>Component ingredient / allergen sources</summary>
      <p>Source review only; this is not a verified kit label.</p>
      {issue && <p>{issue}</p>}
      <ul>
        {sources.map((i, index) => (
          <li key={`${i.id}-${index}`}>
            {i.name} · Supplier statement: {i.subingredients || 'Missing'} ·
            Declared allergens:{' '}
            {(i.allergens || []).join(', ') ||
              'Not recorded; absence is not an allergen-free claim'}{' '}
            ·{' '}
            {i.reviewed ? 'Source marked reviewed' : 'Source review incomplete'}
          </li>
        ))}
      </ul>
    </details>
  )
}
