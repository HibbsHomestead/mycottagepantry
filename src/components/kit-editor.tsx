import { ProductDescriptionField } from './product-description-field'
import { ProductIngredients } from './product-ingredients'
import { ProductPriceTaxField } from './business-price-tax'
import { ItemRemoveButton } from './item-remove-button'
import { ItemDeleteButton } from './item-deletion'
import { useState } from 'react'
import { ItemEditorShell } from './item-editor-shell'
import { ProductArtworkFields } from './product-artwork-fields'
import {
  basketComponentCosts,
  basketAssemblyCosts,
  isMixedPack,
  packagingLines,
  effectiveRecipeLines,
  money,
  type Item,
} from '@/lib/domain'
import type { ProductEditor } from './product-editor'
import { kitEstimate } from '@/lib/kit-estimate'
import { PackagingCostTotal, PackagingLineCost } from './financial-editors'
import './kit-components.css'

type Props = Parameters<typeof ProductEditor>[0] & {
  mixedPack?: boolean
  openProduct: (item: Item) => void
  onSaved?: (id: string) => void
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
  mixedPack,
}: Props) {
  const [draft, setDraft] = useState<Item>(() =>
    item
      ? { ...item }
      : {
          id: crypto.randomUUID(),
          name: '',
          workflow: 'kit',
          ...(mixedPack ? { assemblyType: 'mixed-pack' } : {}),
          status: 'draft',
          kitComponents: [],
          packagingLines: [],
          price: '',
          priceTaxMode: 'inherit',
          assemblyMinutes: 0,
          assemblyRate: 0,
        },
  )
  const [tab, setTab] = useState('contents')
  const [busy, setBusy] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [error, setError] = useState('')
  const [basis, setBasis] = useState('unpackaged')
  const change = (key: string, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }))
    onDirty(true)
  }
  const components: Item[] = draft.kitComponents || []
  const packaging: Item[] = draft.packagingLines || []
  const mixed = isMixedPack(draft)
  const subject = mixed ? 'mixed pack' : 'basket'
  const contentCount = components.reduce((total, row) => total + Number(row.quantity || 0), 0)
  const sameUnit = components[0]?.contentUnit
  const countUnit = sameUnit && components.every((line) => line.contentUnit === sameUnit)
    ? (contentCount === 1 || sameUnit.endsWith('s') ? sameUnit : `${sameUnit}s`)
    : 'items'
  const packagingSummary = packaging.filter((line) => !draft.mixedLabelStockId || line.ingredientId !== draft.mixedLabelStockId)
    .map((line) => `${line.quantity} ${workspace.ingredients.find((item) => item.id === line.ingredientId)?.name || 'unavailable packaging'}`).join(' + ')
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
  const estimate = kitEstimate(draft, workspace)
  const componentCosts = basketComponentCosts(draft, workspace, { allowResaleEstimate: true })
  const assembly = basketAssemblyCosts(draft, workspace)
  const knownComponents = componentCosts.filter((row) => row.cost !== undefined)
  const contentsCost = knownComponents.reduce((total, row) => total + row.cost!, 0)
  const completeContentsCost = knownComponents.length === components.length
  const priceSet = Number.isFinite(estimate.price) && estimate.price >= 0
  const noContents = components.length === 0
  const costIssues = [
    noContents ? `Add contents to calculate the ${subject} cost.` : estimate.costError,
    ...componentCosts.map((row) => row.issue),
    assembly.packagingIssue,
    assembly.laborIssue,
  ]
  const pricingIssue = estimate.pricingError === `Selling price is not configured for this ${subject}.`
    ? ''
    : estimate.pricingError
  const guidance = [...new Set([
    ...costIssues,
    !priceSet && 'Set a selling price to calculate profit and margin.',
    pricingIssue,
  ].filter((issue): issue is string => Boolean(issue)))]
  const emptyEstimate = noContents && !priceSet && !item && !packaging.length && !assembly.labor && !assembly.overhead && !assembly.laborIssue
  const summary = emptyEstimate ? (
    <p>Add contents and set a selling price to calculate cost and margin.</p>
  ) : (
    <>
      {knownComponents.length > 0 && (
        <p>
          {completeContentsCost ? (mixed ? 'Contents cost' : 'Included packages') : 'Known contents subtotal'}: {money(contentsCost)}
        </p>
      )}
      {assembly.packagingCost !== undefined && (packaging.length > 0 || estimate.cost) && (
        <p>{mixed ? 'Outer packaging and labels' : 'Additional basket packaging'}: {money(assembly.packagingCost)}</p>
      )}
      {!assembly.laborIssue && assembly.labor !== undefined && (assembly.labor > 0 || estimate.cost) && (
        <p>Additional assembly: {money(assembly.labor)}</p>
      )}
      {mixed && !assembly.laborIssue && assembly.overhead > 0 && <p>Packing overhead: {money(assembly.overhead)}</p>}
      {estimate.cost && (
        <p><strong>Total / {subject}: {money(estimate.cost.perPackage)}</strong></p>
      )}
      <p>
        Selling price:{' '}
        {priceSet ? money(estimate.price) : 'Not set'}
      </p>
      {estimate.pricing && (
        <p>
          Profit excluding tax: {money(estimate.pricing.profit)} · Margin:{' '}
          {estimate.pricing.margin.toFixed(1)}%
        </p>
      )}
      {guidance.length > 0 && (
        <div role="status">
          {guidance.map((issue) => <p key={issue}>{issue}</p>)}
        </div>
      )}
    </>
  )
  const contents = (
    <>
      <label className="field">
        <span>{mixed ? 'Mixed pack name' : 'Basket name'}</span>
        <input
          required
          value={draft.name}
          onChange={(e) => change('name', e.target.value)}
        />
      </label>
      <ProductDescriptionField product={draft} workspace={workspace} change={change} field="description" disabled={!['Owner', 'Manager'].includes(role)} />
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
        Archived / inactive {subject}
      </label>
      <h3>{mixed ? 'Multiple products / flavors in one package' : 'Included products'}</h3>
      {mixed && (
        <div className="calculation-box">
          <p><strong>Contents:</strong> {contentCount} {countUnit} total</p>
          <p><strong>Packaging:</strong> {packagingSummary || 'Not configured'}</p>
          <label className="field"><span>Expected contents count (optional)</span>
            <input type="number" min="1" step="1" value={draft.expectedContents ?? ''}
              onChange={(event) => change('expectedContents', event.target.value)} />
          </label>
          {draft.expectedContents && Number(draft.expectedContents) !== contentCount && (
            <p role="status" className="warning-text">Contents count mismatch: {contentCount} selected; expected {draft.expectedContents}.</p>
          )}
        </div>
      )}
      <p className="form-hint">
        {mixed
          ? 'Choose a verified unpackaged recipe output or an existing finished package. Only finished packages include their own wrappers and labels.'
          : 'Quantities count whole selling packages.'}
      </p>
      {components.map((line, index) => {
        const p = workspace.products.find((p) => p.id === line.productId)
        const resolved = componentCosts[index]
        const contribution = resolved?.cost === undefined ? 'Cost unavailable' : money(resolved.cost)
        const costIssue = resolved?.issue
        const sourceData = componentSources(p, workspace)
        return (
          <section className="kit-editor-component" key={line.productId}>
            <div className="kit-component-row">
              <div className="kit-component-name">
                {p ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => openProduct(p)}
                  >
                    {p.name}
                  </button>
                ) : (
                  <strong>Unavailable product {line.productId}</strong>
                )}
                {p?.archived && <small>Archived component</small>}
                {mixed && <small>{line.basis === 'unpackaged' ? `Unpackaged · ${line.contentUnit}` : 'Finished package'}{p?.recipeId ? ` · ${workspace.recipes.find((recipe) => recipe.id === p.recipeId)?.name || 'Recipe unavailable'}` : ''}{p?.variant ? ` · ${p.variant}` : ''}</small>}
              </div>
              <label className="field kit-component-quantity">
                <span>Quantity</span>
                <input
                  aria-label={`${line.basis === 'unpackaged' ? 'Unpackaged' : 'Whole selling packages'} quantity · ${p?.name || line.productId}`}
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
              <div className="kit-component-cost">
                <span>Component cost</span>
                <output
                  aria-label={`Extended component cost · ${p?.name || line.productId}`}
                >
                  {contribution}
                </output>
              </div>
              <ItemRemoveButton
                label={`Remove ${p?.name || line.productId}`}
                onClick={() =>
                  change(
                    'kitComponents',
                    components.filter((_, i) => i !== index),
                  )
                }
              />
            </div>
            {(costIssue || sourceData.issue) && (
              <p className="kit-component-warning warning-text" role="status">
                {costIssue || sourceData.issue}{' '}
                {p && 'Open product details to review its setup.'}
              </p>
            )}
            <details className="kit-component-details">
              <summary>Display component details</summary>
              <div className="kit-component-explanation">
                <h4>Quantity basis</h4>
                <p>
                  {line.basis === 'package'
                    ? 'Whole selling packages'
                    : `${line.contentUnit || 'Unit unavailable'} · Unpackaged recipe output`}
                </p>
                <p>
                  {p?.sellingUnit || 'Selling package'}
                  {p?.unitsPerPackage
                    ? ` · ${p.unitsPerPackage} ${p.contentUnit || workspace.recipes.find((r) => r.id === p.recipeId)?.yieldUnit || 'contents'} per package`
                    : ' · Contents per package not configured'}
                </p>
                <h4>Component cost basis</h4>
                <p>
                  {contribution} {resolved?.source && `· ${resolved.source}`}
                </p>
                {costIssue && <p className="warning-text">{costIssue}</p>}
                <p>
                  {line.basis === 'unpackaged' ? 'Includes the flavor’s production labor and overhead, without individual packaging or labels.' : p?.workflow === 'resale'
                    ? 'Includes recorded received-item cost. Production labor and packaging are not added again.'
                    : 'Includes component production labor, overhead and existing packaging. These costs are not added again.'}
                </p>
                <h4>Attached component packaging</h4>
                <p>
                  {p && packagingLines(p).length
                    ? packagingLines(p)
                        .map(
                          (l: Item) =>
                            `${l.quantity} ${l.unit || 'each'} ${workspace.ingredients.find((i) => i.id === l.ingredientId)?.name || 'Unavailable packaging'}`,
                        )
                        .join(', ')
                    : p?.workflow === 'resale'
                      ? 'No attached component packaging configured.'
                      : 'No separate selling packaging configured. Production packaging remains included.'}
                </p>
                <ComponentSources data={sourceData} />
                <p>
                  Ingredient/allergen information belongs to this component.
                  Review its source statement and missing data; this is not a
                  verified basket label.
                </p>
              </div>
            </details>
          </section>
        )
      })}
      {mixed && <label className="field"><span>Stock basis for the next component</span>
        <select value={basis} onChange={(event) => setBasis(event.target.value)}>
          <option value="unpackaged">Unpackaged output units</option>
          <option value="package">Existing finished packages</option>
        </select>
      </label>}
      <label className="field">
        <span>{mixed ? 'Add source product / recipe variant' : 'Add existing product'}</span>
        <select
          value=""
          onChange={(event) => {
            const source = workspace.products.find((product) => product.id === event.target.value)
            if (!source) return
            change('kitComponents', [...components, source.unpackagedOutput === true
              ? { productId: source.id, quantity: 1, basis: 'unpackaged', contentUnit: source.contentUnit }
              : { productId: source.id, quantity: 1, basis: 'package' }])
          }}
        >
          <option value="">Choose product…</option>
          {workspace.products
            .filter(
              (p) =>
                p.workflow !== 'kit' &&
                !p.archived &&
                (p.unpackagedOutput === true) === (mixed && basis === 'unpackaged') &&
                !components.some((c) => c.productId === p.id),
            )
            .map((p) => (
              <option key={p.id} value={p.id}>
                {[p.name, ...(mixed ? [p.variant, p.sku] : [])].filter(Boolean).join(' · ')}
              </option>
            ))}
        </select>
      </label>
      <p className="form-hint">
        {mixed ? 'For a loose flavor that is not listed, create a food product marked Unpackaged production output. Link its existing recipe, verify its yield unit and leave individual packaging empty. Saving this pack does not move stock; use Production to link component runs and post finished packs.'
          : 'Saving does not move stock. Use Assemble to plan missing components and post finished baskets. Basket sales remain unavailable.'}
      </p>
    </>
  )
  const pricing = (
    <>
      <h3>{mixed ? 'Outer packaging and label stock' : 'Additional basket packaging'}</h3>
      {packaging.map((line, index) => (
        <div className="calculation-box basket-packaging-row" key={line.ingredientId}>
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
          <PackagingLineCost line={line} ingredients={workspace.ingredients} basket />
          <ItemRemoveButton
            label="Remove packaging"
            onClick={() =>
              change(
                'packagingLines',
                packaging.filter((_, i) => i !== index),
              )
            }
          />
        </div>
      ))}
      <label className="field">
        <span>{mixed ? 'Add outer packaging or label stock' : 'Add basket packaging'}</span>
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
      <PackagingCostTotal lines={packaging} ingredients={workspace.ingredients} basket label={mixed ? 'Total outer packaging and labels per mixed pack' : undefined} />
      {mixed && <>
        <p className="form-hint">Add containers and label materials above with their quantities per finished pack. Use the expected count on Contents &amp; details rather than the container name.</p>
        <label className="field"><span>Assortment label template</span>
          <select value={draft.mixedLabelTemplateId || ''} onChange={(event) => change('mixedLabelTemplateId', event.target.value)}>
            <option value="">Choose in Labels later</option>
            {(workspace.label_templates || []).filter((entry) => !entry.deletedAt && !entry.round && entry.format !== 'front-back').map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Label material from packaging above</span>
          <select value={draft.mixedLabelStockId || ''} onChange={(event) => change('mixedLabelStockId', event.target.value)}>
            <option value="">No designated label stock</option>
            {packaging.map((line) => <option key={line.ingredientId} value={line.ingredientId}>{workspace.ingredients.find((entry) => entry.id === line.ingredientId)?.name || line.ingredientId}</option>)}
          </select>
        </label>
        <h3>Contents cost breakdown</h3>
        <ul>{componentCosts.map((row) => <li key={row.productId}>{row.quantity} × {row.name}: {row.cost == null ? 'Cost unavailable' : money(row.cost)}</li>)}</ul>
      </>}
      {[
        ['assemblyMinutes', 'Additional assembly minutes'],
        ['assemblyRate', 'Assembly hourly rate'],
        ...(mixed ? [['assemblyOverhead', 'Additional packing overhead per pack ($)']] : []),
        ['price', mixed ? 'Mixed pack selling price' : 'Basket selling price'],
      ].map(([key, label]) => (
        <label className="field" key={key}>
          <span>{label}</span>
          <input
            type="number"
            min="0"
            step="any"
            required={key !== 'assemblyOverhead'}
            value={draft[key] ?? ''}
            onChange={(e) => change(key, e.target.value)}
          />
        </label>
      ))}
      <ProductPriceTaxField product={draft} business={workspace.settings[0]} change={change} disabled={busy} />
    </>
  )
  return (
    <ItemEditorShell
      notice={item && workspace.products.some(p => p.id === item.id) && <ItemDeleteButton table="products" item={item} draft />}
      dialogClassName="basket-editor-dialog"
      title={item ? `${mixed ? 'Mixed pack' : 'Basket'} · ${item.name}` : `Create ${subject}`}
      description="Fixed contents, one selling price. Current estimates follow current component costs."
      tabs={[
        { id: 'contents', label: 'Contents & details', content: contents },
        {
          id: 'ingredients',
          label: 'Ingredients & allergens',
          content: <ProductIngredients workspace={workspace} product={draft} isDraft />,
        },
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
      submitLabel={`Save ${subject}`}
      error={error}
      cancel={close}
      onSubmit={async () => {
        if (busy) return
        setBusy(true)
        setError('')
        try {
          await mutate('save', 'products', draft)
          onDirty(false)
          if (onSaved) onSaved(draft.id)
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

function componentSources(
  product: Item | undefined,
  workspace: Props['workspace'],
) {
  let sources: Item[] = []
  let issue = ''
  try {
    const recipe = workspace.recipes.find((r) => r.id === product?.recipeId)
    if (!recipe)
      issue =
        'No recipe ingredient provenance is configured for this component. Review its supplier statement separately.'
    else
      sources = effectiveRecipeLines(recipe, workspace.recipes).map(
        (line: Item) => {
          const ingredient = workspace.ingredients.find(
            (i) => i.id === line.ingredientId,
          )
          if (!ingredient)
            issue =
              'Ingredient source unavailable. Open product details to review its recipe ingredients.'
          return (
            ingredient || {
              id: line.ingredientId,
              name: 'Unavailable ingredient source',
            }
          )
        },
      )
  } catch (e) {
    issue = (e as Error).message
  }
  return { sources, issue }
}

function ComponentSources({
  data: { sources, issue },
}: {
  data: ReturnType<typeof componentSources>
}) {
  return (
    <div>
      <h4>Ingredient &amp; allergen sources</h4>
      <p>Source review only; this is not a verified basket label.</p>
      {issue && <p className="warning-text">{issue}</p>}
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
    </div>
  )
}
