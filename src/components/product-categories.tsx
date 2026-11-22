import { FormErrorNotice } from './form-error-notice'
import { Plus, Settings } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import {
  categoryScopes,
  productCategoryScope,
  productCategoryEligible,
  categoryOrder,
  type CategoryScope,
} from '@/lib/category-details'
import { SectionCategoryManager } from './section-categories'
import { useEffect, useId, useRef, useState } from 'react'
import {
  applicableTaxes,
  categoryTaxDescription,
  type Item,
  type TaxRate,
} from '@/lib/domain'
import {
  categoryTaxState,
  productCategoryName,
  classificationLabel,
  categoryImpact,
  normalizedCategoryName,
  type CategoryMappings,
  type ProductCategory,
} from '@/lib/product-categories'
import {
  categoryEndpoint,
  categoryConfigurationSchema,
  categoryTaxConfigurationSchema,
  readCategoryResponse,
  type CategoryConfiguration as Configuration,
} from '@/lib/product-category-response'
import './product-editor.css'

function useCategoryConfiguration(onConfig: (patch: Partial<Item>) => void) {
  const [data, setData] = useState<Configuration>(),
    [error, setError] = useState(''),
    [taxError, setTaxError] = useState(''),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0),
    [saving, setSaving] = useState(false)
  const callback = useRef(onConfig)
  useEffect(() => {
    callback.current = onConfig
  }, [onConfig])
  const accept = (raw: unknown) => {
    const core = categoryConfigurationSchema.safeParse(raw)
    if (!core.success)
      throw new Error(
        'Product categories could not be loaded. Please retry or contact support.',
      )
    const tax = categoryTaxConfigurationSchema.safeParse(raw)
    const next: Configuration = {
      ...core.data,
      ...(tax.success ? { tax: tax.data } : {}),
    }
    setData(next)
    setReady(true)
    setError('')
    setTaxError(
      tax.success
        ? ''
        : 'Tax settings could not be loaded. Please retry or contact support. Saved tax settings are unchanged; no tax rate is assumed.',
    )
    callback.current({
      productCategories: next.categories,
      categoryConfigRevision: next.revision,
      ...(tax.success ? { categoryTaxMappings: tax.data.mappings } : {}),
    })
    return next
  }
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(categoryEndpoint, {
          credentials: 'same-origin',
          signal: controller.signal,
        })
        const raw = await readCategoryResponse(response)
        if (!controller.signal.aborted) accept(raw)
      } catch (cause) {
        if (!controller.signal.aborted) {
          setReady(false)
          setError(
            `Could not load product categories. ${cause instanceof Error ? cause.message : 'The network request failed.'} Retry; your selection and edits are preserved.`,
          )
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [retry])
  const pending = useRef(false)
  async function save(payload: Record<string, unknown>) {
    if (pending.current || !data || !ready || loading) return
    if (payload.operation === 'saveMappings' && !data.tax) return
    pending.current = true
    setSaving(true)
    setError('')
    try {
      const response = await fetch(categoryEndpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, expectedRevision: data.revision }),
      })
      return accept(await readCategoryResponse(response))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  return {
    data,
    error,
    taxError,
    ready,
    taxReady: ready && !!data?.tax,
    loading,
    saving,
    save,
    reload: () => {
      setLoading(true)
      setReady(false)
      setRetry((r) => r + 1)
    },
  }
}
function LoadState({
  api,
}: {
  api: ReturnType<typeof useCategoryConfiguration>
}) {
  return (
    <>
      {api.loading && (
        <p role="status">Loading product categories and tax settings…</p>
      )}
      {!api.ready && (api.error || api.taxError) && (
        <div role="alert">
          {api.error && <p>{api.error}</p>}
          {api.taxError && <p>{api.taxError}</p>}
          <button
            type="button"
            className="text-button"
            onClick={api.reload}
            disabled={api.loading || api.saving}
          >
            Retry category list
          </button>
        </div>
      )}
      {!api.ready && (
        <p className="form-hint">
          Category changes require a successfully loaded category list. Your
          saved selection and open edits are kept.
        </p>
      )}
    </>
  )
}
function CategoryForm({
  api,
  category,
  initialName = '',
  scope,
  onSaved,
  onCancel,
}: {
  api: ReturnType<typeof useCategoryConfiguration>
  category?: ProductCategory
  initialName?: string
  scope?: CategoryScope
  onSaved: (data: Configuration) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(category?.name || initialName)
  const [classification, setClassification] = useState(
    category?.classification || '',
  )
  const [description, setDescription] = useState(category?.description || '')
  const [parentId, setParentId] = useState(category?.parentId || '')
  const [displayOrder, setDisplayOrder] = useState(category?.displayOrder ?? 0)
  const [section, setSection] = useState(category?.scope || scope || '')
  const [confirmed, setConfirmed] = useState(false)
  const changed =
    !!category && classification !== (category.classification || '')
  const affected = changed
    ? categoryImpact(
        api.data?.products || [],
        api.data?.categories || [],
        category.id,
      )
    : []
  return (
    <div
      className="category-edit-fields"
      role="group"
      aria-label="Category form"
    >
      <h3>{category ? `Edit ${category.name}` : 'Add Category'}</h3>
      <label className="field">
        <span>Category name</span>
        <input
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea
          rows={2}
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Section</span>
          <select
            value={section}
            disabled={!!scope || !!category?.scope}
            onChange={(e) => {
              setSection(e.target.value)
              setParentId('')
            }}
          >
            <option value="">Legacy section · review needed</option>
            {Object.entries(categoryScopes)
              .filter(([key]) => key.endsWith('products') || key === 'kits')
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Parent category</span>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">No parent</option>
            {(api.data?.categories || [])
              .filter(
                (c) =>
                  c.id !== category?.id &&
                  c.scope === section &&
                  c.active !== false,
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Display order</span>
          <input
            type="number"
            min={0}
            max={100000}
            value={displayOrder}
            onChange={(e) => setDisplayOrder(Number(e.target.value))}
          />
        </label>
      </div>
      <label className="field">
        <span>Classification</span>
        <select
          aria-label="Classification"
          value={classification}
          onChange={(e) => {
            setClassification(e.target.value)
            setConfirmed(false)
          }}
        >
          <option value="" disabled={!!category?.classification}>
            {category
              ? 'Not classified — review needed'
              : 'Choose Food or Non-food'}
          </option>
          <option value="food">Food</option>
          <option value="non_food">Non-food</option>
        </select>
      </label>
      {changed && (
        <div className="category-impact">
          <p>Products affected by this classification change:</p>
          {affected.length ? (
            <ul>
              {affected.map((p) => (
                <li key={p.id}>{p.name}</li>
              ))}
            </ul>
          ) : (
            <p>No linked products.</p>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Confirm classification change for {affected.length} linked products.
            Future category-based calculations change; existing product-level
            assignments and completed transaction taxes stay preserved.
          </label>
        </div>
      )}
      <FormErrorNotice message={api.error || api.taxError} />
      <div className="category-actions">
        <button
          type="button"
          className="btn primary"
          disabled={
            !api.ready ||
            api.loading ||
            api.saving ||
            !name.trim() ||
            (!category && (!classification || !section)) ||
            (changed && !confirmed)
          }
          onClick={async () => {
            const result = await api.save({
              operation: 'saveCategory',
              category: {
                ...(category ? { id: category.id } : {}),
                name,
                description,
                parentId: parentId || null,
                displayOrder,
                scope: section || undefined,
                classification: classification || null,
              },
              confirmAffected: confirmed ? affected.length : undefined,
            })
            if (result) onSaved(result)
          }}
        >
          {api.saving ? 'Saving…' : 'Save category'}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={api.saving}
          onClick={onCancel}
        >
          Cancel category edit
        </button>
      </div>
    </div>
  )
}

function LegacyCategoryReview({ products }: { products: Item[] }) {
  const legacy = products.filter((p) => !p.productCategoryId && p.category)
  if (!legacy.length) return null
  const names = [...new Set(legacy.map((p) => String(p.category)))]
  return (
    <details className="category-migration-review">
      <summary>
        {legacy.length} products have legacy category text awaiting owner review
      </summary>
      <p>
        These saved values have not been migrated to category records. No
        category values or tax assignments have been replaced. Review exact
        name-to-ID mappings and Food / Non-food classifications before approving
        a separate migration. Capitalization and whitespace conflicts need an
        owner decision.
      </p>
      <ul>
        {names.map((value) => (
          <li key={value}>
            {value}: {legacy.filter((p) => p.category === value).length}{' '}
            products
          </li>
        ))}
      </ul>
    </details>
  )
}

export function ProductCategoryManager({
  canManage,
  onConfig,
}: {
  canManage: boolean
  onConfig: (patch: Partial<Item>) => void
}) {
  const api = useCategoryConfiguration(onConfig)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ProductCategory | null | undefined>()
  const [archiving, setArchiving] = useState<ProductCategory>()
  const [notice, setNotice] = useState('')
  const categories = api.data?.categories || []
  const visible = categoryOrder(categories).filter((c) =>
    normalizedCategoryName(c.name).includes(normalizedCategoryName(search)),
  )
  const archived = categories.filter((c) => c.active === false).length
  const treatment = (category: ProductCategory) => {
    if (!api.taxReady) return 'Tax settings unavailable — retry required'
    return categoryTaxDescription(category, {
      id: 'category-tax-preview',
      name: 'Category tax preview',
      productCategories: categories,
      categoryTaxMappings: api.data?.tax?.mappings || {},
      taxRates: api.data?.tax?.rates || [],
    })
  }
  return (
    <section
      className="product-category-manager"
      aria-label="Product Categories"
    >
      <div className="toolbar category-list-toolbar">
        <label className="field">
          <span>Search categories</span>
          <input
            type="search"
            placeholder="Find a category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={!api.ready || api.loading}
          />
        </label>
        {canManage && (
          <button
            type="button"
            className="btn primary"
            disabled={!api.ready || api.loading || api.saving}
            onClick={() => {
              setEditing(null)
              setArchiving(undefined)
              setNotice('')
            }}
          >
            Add Category
          </button>
        )}
      </div>
      <LoadState api={api} />
      {notice && <p role="status">{notice}</p>}
      {editing !== undefined && (
        <CategoryForm
          key={editing?.id || 'new'}
          api={api}
          category={editing || undefined}
          onCancel={() => setEditing(undefined)}
          onSaved={() => {
            setNotice(
              editing
                ? 'Category updated. Product associations preserved.'
                : 'Category added.',
            )
            setEditing(undefined)
            setSearch('')
          }}
        />
      )}
      {api.data && (
        <>
          <p className="category-list-count">
            {!api.ready && 'Last loaded: '}
            {categories.length - archived} active categories
            {archived ? ` · ${archived} archived` : ''}. Saved in this Oven.
          </p>
          {!categories.length && !api.ready ? (
            <p>Category list unavailable. Retry before creating a category.</p>
          ) : !categories.length ? (
            <div className="panel category-empty">
              <h3>No product categories yet</h3>
              <p>
                Create categories to organize your products. Each category
                inherits the configured Food or Non-food tax treatment.
              </p>
              {canManage ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={!api.ready || api.loading || api.saving}
                  onClick={() => setEditing(null)}
                >
                  Add Your First Category
                </button>
              ) : (
                <p>An Owner or Manager can add categories.</p>
              )}
            </div>
          ) : !visible.length ? (
            <p>No categories match your search.</p>
          ) : (
            <ul className="product-category-list">
              {visible.map((category) => {
                const count = categoryImpact(
                  api.data!.products,
                  categories,
                  category.id,
                ).length
                return (
                  <li className="panel product-category-row" key={category.id}>
                    <div className="category-row-name">
                      <h3>{category.name}</h3>
                      {category.description && <p>{category.description}</p>}
                      <small>
                        {category.scope
                          ? categoryScopes[category.scope]
                          : 'Legacy section · review needed'}
                        {category.parentId
                          ? ` · Parent: ${categories.find((c) => c.id === category.parentId)?.name || 'Unavailable'}`
                          : ''}{' '}
                        · Order {category.displayOrder || 0}
                      </small>
                      <span>
                        {classificationLabel(category.classification)}
                        {category.active === false ? ' · Archived' : ''}
                      </span>
                    </div>
                    <div>
                      <small>Linked products</small>
                      <p>{count}</p>
                    </div>
                    <div className="category-row-tax">
                      <small>Inherited tax treatment</small>
                      <p>{treatment(category)}</p>
                    </div>
                    {canManage && (
                      <div className="category-actions">
                        <button
                          type="button"
                          className="text-button"
                          disabled={!api.ready || api.loading || api.saving}
                          onClick={() => {
                            setEditing(category)
                            setArchiving(undefined)
                          }}
                        >
                          Edit {category.name}
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          disabled={!api.ready || api.loading || api.saving}
                          onClick={() => {
                            setArchiving(category)
                            setEditing(undefined)
                          }}
                        >
                          {category.active === false ? 'Restore' : 'Archive'}{' '}
                          {category.name}
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {archiving && (
            <div
              className="category-edit-fields"
              role="group"
              aria-label="Confirm category status change"
            >
              <h3>
                {archiving.active === false ? 'Restore' : 'Archive'}{' '}
                {archiving.name}?
              </h3>
              <p>
                {archiving.active === false
                  ? 'This category becomes available in product dropdowns again.'
                  : 'This category is kept for reference and removed from new product selections. Existing assignments remain identifiable.'}{' '}
                No products or completed transactions are deleted or changed.
              </p>
              <div className="category-actions">
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!api.ready || api.loading || api.saving}
                  onClick={async () => {
                    const result = await api.save({
                      operation: 'setCategoryActive',
                      categoryId: archiving.id,
                      active: archiving.active === false,
                      confirm: true,
                    })
                    if (result) {
                      setNotice(
                        archiving.active === false
                          ? 'Category restored.'
                          : 'Category archived.',
                      )
                      setArchiving(undefined)
                    }
                  }}
                >
                  Confirm {archiving.active === false ? 'restore' : 'archive'}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={api.saving}
                  onClick={() => setArchiving(undefined)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <LegacyCategoryReview products={api.data.products} />
          <details className="category-tax-secondary">
            <summary>Tax Settings · Food / Non-food mappings</summary>
            <p>
              These mappings are separate from your category records. Existing
              configured rates and calculation rules are unchanged.
            </p>
            <CategoryTaxSettingsFields
              api={api}
              products={api.data.products}
              canManage={canManage}
              showLoadState={false}
            />
          </details>
        </>
      )}
    </section>
  )
}

export function ProductCategorySelector({
  product,
  business,
  canManage,
  onChange,
  onConfig,
  openTaxSettings,
  onBusyChange,
}: {
  product: Item
  business: Item
  canManage: boolean
  onChange: (key: string, value: string) => void
  onConfig: (patch: Partial<Item>) => void
  openTaxSettings: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const api = useCategoryConfiguration(onConfig)
  useEffect(() => {
    onBusyChange?.(api.saving)
  }, [api.saving, onBusyChange])
  const [manageDialog, setManageDialog] = useState(false)
  const [managing, setManaging] = useState(false),
    [editing, setEditing] = useState(false),
    [id, setId] = useState(''),
    [newName, setNewName] = useState('')
  const labelId = useId()
  const scope = productCategoryScope(product)
  const categories = categoryOrder<ProductCategory>(
    api.data?.categories || business.productCategories || [],
  ).filter((c) => c.scope === scope || c.id === product.productCategoryId)
  const selectedCategory = categories.find(
    (c) => c.id === product.productCategoryId,
  )
  const selectedIssue = !selectedCategory
    ? 'unavailable'
    : selectedCategory.active === false
      ? 'inactive'
      : selectedCategory.scope !== scope
        ? 'unscoped or in another section · review needed'
        : ''
  const begin = (category?: ProductCategory, name = '') => {
    setId(category?.id || '')
    setNewName(name)
    setEditing(true)
    setManaging(true)
  }
  return (
    <section
      className="product-category-editor product-category-compact"
      aria-label="Product category and inherited tax"
    >
      {manageDialog && (
        <SectionCategoryManager
          workspace={{
            settings: [business],
            products: api.data?.products || [],
            recipes: [],
            ingredients: [],
          }}
          scope={scope}
          onSettings={onConfig}
          close={() => {
            setManageDialog(false)
            api.reload()
          }}
        />
      )}
      {!managing && <LoadState api={api} />}
      <div className="category-field-label" id={labelId}>
        Product category
      </div>
      <div className="category-input-row">
        <CategoryCombobox
          labelledBy={labelId}
          categories={categories}
          scope={scope}
          value={product.productCategoryId || ''}
          legacyCategory={product.category}
          disabled={!api.ready || api.loading || api.saving}
          canAdd={canManage}
          onSelect={(value) => onChange('productCategoryId', value)}
          onAdd={(name) => begin(undefined, name)}
        />
        {canManage && (
          <span className="category-actions">
            <button
              type="button"
              className="text-button category-compact-action"
              disabled={!api.ready || api.loading || api.saving}
              aria-label="Add category"
              title="Add category"
              onClick={() => begin()}
            >
              <Plus size={18} />
              <span>Add</span>
            </button>
            <button
              type="button"
              className="text-button category-compact-action"
              aria-label="Manage categories"
              title="Manage categories"
              aria-expanded={manageDialog}
              disabled={!api.ready || api.loading}
              onClick={() => {
                setManageDialog(true)
              }}
            >
              <Settings size={18} />
              <span>Manage</span>
            </button>
          </span>
        )}{' '}
      </div>
      {categories.find((c) => c.id === product.productCategoryId)
        ?.description && (
        <p className="form-hint">
          {
            categories.find((c) => c.id === product.productCategoryId)
              ?.description
          }
        </p>
      )}
      {api.ready && selectedCategory && !selectedCategory.scope && (
        <p className="form-hint">
          Saved category predates section-specific categories and remains
          available.
        </p>
      )}
      {api.ready &&
        !categories.some(
          (c) => c.active !== false && productCategoryEligible(c, scope),
        ) && (
          <p className="form-hint">
            No active product categories configured for this section.
          </p>
        )}
      {api.ready && product.productCategoryId && selectedIssue && (
        <p role="status" className="form-hint">
          Your saved category is {selectedIssue}. Its assignment is preserved
          until you choose a replacement.
        </p>
      )}
      {api.taxReady ? (
        <ProductTaxSummary product={product} business={business} concise />
      ) : (
        <p className="form-hint">
          Inherited tax treatment is unavailable until tax settings load. Saved
          tax assignments are preserved.
        </p>
      )}
      <details className="category-tax-details">
        <summary>Tax details</summary>
        {api.taxReady && (
          <ProductTaxSummary product={product} business={business} />
        )}
        {canManage && (
          <button
            type="button"
            className="text-button"
            onClick={openTaxSettings}
          >
            Open tax settings in a new tab
          </button>
        )}
      </details>
      {managing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !api.saving) {
              setManaging(false)
              setEditing(false)
            }
          }}
        >
          <DialogContent className="app-dialog">
            <DialogTitle>Add product category</DialogTitle>
            <LoadState api={api} />
            <DialogDescription>
              Category changes save separately. Cancelling the product does not
              undo a saved category.
            </DialogDescription>
            {editing && (
              <CategoryForm
                key={id || 'new:' + newName}
                api={api}
                category={categories.find((c) => c.id === id)}
                initialName={newName}
                scope={scope}
                onCancel={() => {
                  setEditing(false)
                  setManaging(false)
                }}
                onSaved={(result) => {
                  if (!id && result.selectedId)
                    onChange('productCategoryId', result.selectedId)
                  setEditing(false)
                  setManaging(false)
                  setNewName('')
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}

/** One searchable selector: type to filter, arrow keys to move, Enter to choose. */
function CategoryCombobox({
  labelledBy,
  categories,
  value,
  legacyCategory,
  scope,
  disabled,
  canAdd,
  onSelect,
  onAdd,
}: {
  labelledBy: string
  categories: ProductCategory[]
  value: string
  legacyCategory?: string
  scope: CategoryScope
  disabled: boolean
  canAdd: boolean
  onSelect: (id: string) => void
  onAdd: (name: string) => void
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(0)
  const listId = useId()
  const saved = categories.find((c) => c.id === value)
  const empty =
    legacyCategory && !value
      ? `Legacy: ${legacyCategory} — review needed`
      : 'Not assigned'
  const label = (c: ProductCategory) =>
    `${c.name} · ${classificationLabel(c.classification)}`
  const current = saved
    ? `${label(saved)}${saved.active === false ? ' — inactive' : !productCategoryEligible(saved, scope) ? ' — another section' : ''}`
    : value
      ? 'Saved category unavailable'
      : empty
  const q = query.trim().toLowerCase()
  const options: { id: string; text: string; add?: boolean }[] = [
    ...(!q ? [{ id: '', text: empty }] : []),
    ...(value &&
    (!saved ||
      saved.active === false ||
      !productCategoryEligible(saved, scope)) &&
    !q
      ? [{ id: value, text: current }]
      : []),
    ...categories
      .filter(
        (c) =>
          c.active !== false &&
          productCategoryEligible(c, scope) &&
          (!q || c.name.toLowerCase().includes(q)),
      )
      .map((c) => ({ id: c.id, text: label(c) })),
  ]
  if (canAdd && q && !categories.some((c) => c.name.trim().toLowerCase() === q))
    options.push({
      id: '__add',
      text: `Add “${query.trim()}” as a category`,
      add: true,
    })
  const choose = (option?: (typeof options)[number]) => {
    if (!option || disabled) return
    if (option.add) onAdd(query.trim())
    else onSelect(option.id)
    setOpen(false)
    setQuery('')
  }
  const optionId = (index: number) => `${listId}-${index}`
  return (
    <div className="category-combobox">
      <input
        role="combobox"
        aria-labelledby={labelledBy}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && options[active] ? optionId(active) : undefined
        }
        autoComplete="off"
        placeholder="Search or choose a category"
        disabled={disabled}
        value={open ? query : current}
        onFocus={() => {
          setOpen(true)
          setQuery('')
          setActive(0)
        }}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false)
          setQuery('')
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((i) => Math.min(i + 1, options.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            // Choosing a category never submits the surrounding form.
            e.preventDefault()
            if (open) choose(options[active])
            else setOpen(true)
          } else if (e.key === 'Escape' && open) {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
            setQuery('')
          }
        }}
      />
      {open && (
        <ul role="listbox" id={listId} className="category-listbox">
          {options.map((option, index) => (
            <li
              key={option.id + index}
              id={optionId(index)}
              role="option"
              aria-selected={!option.add && option.id === value}
              data-active={index === active || undefined}
              className={option.add ? 'category-add-option' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(option)}
            >
              {option.text}
            </li>
          ))}
          {!options.length && (
            <li role="option" aria-disabled="true" aria-selected={false}>
              No matching categories
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function taxSummaryState(product: Item, business: Item) {
  const inherited = categoryTaxState(product, business)
  const legacy = product.taxSource !== 'category'
  let treatmentIssue = inherited.issue
  let proposedRates: TaxRate[] = []
  if (!treatmentIssue) {
    try {
      proposedRates = applicableTaxes(
        { ...product, taxSource: 'category' },
        business,
      )
    } catch (error) {
      treatmentIssue = (error as Error).message
    }
  }
  const currentRates: TaxRate[] = (business.taxRates || []).filter(
    (r: TaxRate) => product.taxRateIds?.includes(r.id),
  )
  const preserved =
    product.taxStatus === 'exempt'
      ? 'Tax exempt'
      : product.taxStatus === 'zero_rated'
        ? 'Zero-rated'
        : Array.isArray(product.taxRateIds)
          ? product.taxRateIds.length
            ? product.taxRateIds
                .map(
                  (id: string) =>
                    currentRates.find((r) => r.id === id)?.name ||
                    `Saved treatment unavailable (${id})`,
                )
                .join(', ')
            : 'No selected rates (not tax exempt)'
          : 'Existing business tax rules'
  let migrationConflict = ''
  if (legacy && !treatmentIssue) {
    try {
      const signature = (rates: TaxRate[]) =>
        JSON.stringify(
          rates
            .map((r) => ({
              id: r.id,
              ratePercent: r.ratePercent,
              jurisdiction: r.jurisdiction,
              behavior: r.behavior,
              order: r.order ?? 0,
              compound: !!r.compound,
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        )
      if (
        signature(applicableTaxes(product, business)) !==
        signature(proposedRates)
      )
        migrationConflict =
          'Tax conflict: the current assignment and proposed inheritance produce different applicable treatments or calculation behavior. Resolve this before migration.'
    } catch {
      migrationConflict =
        'Tax conflict: the current assignment could not be calculated. Review its saved treatments before migration.'
    }
  }
  const treatment =
    treatmentIssue ||
    proposedRates
      .map((r) => `${r.name} · ${r.jurisdiction} · ${r.ratePercent}%`)
      .join('; ')
  return {
    inherited,
    legacy,
    preserved,
    migrationConflict,
    treatment,
    treatmentIssue,
    proposedRates,
  }
}

export function ProductTaxSummary({
  product,
  business,
  concise = false,
}: {
  product: Item
  business: Item
  /** One read-only line for editors; full explanations stay in Tax details. */
  concise?: boolean
}) {
  const state = taxSummaryState(product, business)
  if (concise)
    return (
      <p className="category-summary-line" aria-live="polite">
        <span>
          {classificationLabel(state.inherited.category?.classification)}
        </span>
        {' · '}
        <span>
          {state.legacy
            ? `Saved tax kept: ${state.preserved}`
            : state.treatmentIssue
              ? 'Tax treatment not configured'
              : state.proposedRates.length
                ? state.proposedRates
                    .map((r) => `${r.name} ${r.ratePercent}%`)
                    .join(', ')
                : 'No tax applied'}
        </span>
        {(state.legacy || state.migrationConflict) && (
          <span className="warning-text"> · review in Tax details</span>
        )}
      </p>
    )
  return (
    <div className="category-tax-summary" aria-live="polite">
      <p>
        <strong>Category:</strong> {productCategoryName(product, business)}
      </p>
      <p>
        <strong>Classification:</strong>{' '}
        {classificationLabel(state.inherited.category?.classification)}
      </p>
      <p>
        <strong>
          {state.legacy
            ? 'Proposed inherited treatment'
            : 'Inherited tax treatment'}
          :
        </strong>{' '}
        {state.treatment}
      </p>
      {state.legacy && (
        <p className="warning-text">
          Existing assignment preserved: {state.preserved}. Owner-reviewed
          migration is required before switching this product to category-based
          tax. Selecting a category does not change its tax assignment.
        </p>
      )}
      {state.migrationConflict && (
        <p className="warning-text">{state.migrationConflict}</p>
      )}
    </div>
  )
}
export function CategoryTaxSettings({
  products,
  canManage,
  onConfig,
}: {
  business: Item
  products: Item[]
  canManage: boolean
  onConfig: (patch: Partial<Item>) => void
}) {
  const api = useCategoryConfiguration(onConfig)
  return (
    <CategoryTaxSettingsFields
      api={api}
      products={products}
      canManage={canManage}
    />
  )
}
function CategoryTaxSettingsFields({
  api,
  products,
  canManage,
  showLoadState = true,
}: {
  api: ReturnType<typeof useCategoryConfiguration>
  products: Item[]
  canManage: boolean
  showLoadState?: boolean
}) {
  const [draft, setDraft] = useState<CategoryMappings | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [saved, setSaved] = useState(false)
  const mappings = draft || api.data?.tax?.mappings || {}
  const categories = api.data?.categories || []
  const changedClasses = ['food', 'non_food'].filter(
    (key) =>
      JSON.stringify(
        [
          ...(api.data?.tax?.mappings[key as keyof CategoryMappings] || []),
        ].sort(),
      ) !==
      JSON.stringify(
        [...(mappings[key as keyof CategoryMappings] || [])].sort(),
      ),
  )
  const impacted = categoryImpact(
    api.data?.products || products,
    categories.filter((c) => changedClasses.includes(c.classification || '')),
  ).length
  const setMapping = (key: keyof CategoryMappings, values: string[]) => {
    setDraft({ ...mappings, [key]: values })
    setConfirmed(false)
    setSaved(false)
  }
  return (
    <section
      className="calculation-box category-tax-settings"
      aria-label="Category-based tax settings"
    >
      <h3>Food / Non-food tax treatment</h3>
      <p>
        Select configured rates for each classification. Multiple jurisdictions
        can apply. Rate scopes, effective dates, inclusive behavior, order and
        compounding still apply. An unassigned treatment is not tax exempt.
      </p>
      {showLoadState && <LoadState api={api} />}
      {(['food', 'non_food'] as const).map((key) => (
        <div className="category-mapping" key={key}>
          <h4>{classificationLabel(key)}</h4>
          {(mappings[key] || []).map((id) => {
            const rate = api.data?.tax?.rates.find((r) => r.id === id)
            return (
              <div className="category-management-row" key={id}>
                <span>
                  {rate
                    ? `${rate.name} · ${rate.jurisdiction} · ${rate.ratePercent}%${rate.active === false ? ' (inactive)' : ''}`
                    : 'Saved treatment unavailable'}
                </span>
                {canManage && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={!api.taxReady || api.loading || api.saving}
                    onClick={() =>
                      setMapping(
                        key,
                        (mappings[key] || []).filter((value) => value !== id),
                      )
                    }
                  >
                    Remove {rate?.name || 'unavailable treatment'}
                  </button>
                )}
              </div>
            )
          })}
          {!mappings[key]?.length && (
            <p>
              {api.taxReady
                ? api.data?.tax?.rates.some(
                    (r) =>
                      r.appliesTo === 'classification' &&
                      r.classification === key &&
                      r.active !== false,
                  )
                  ? 'Classification-scoped rules apply automatically, subject to scope and effective dates. No additional mapping selected.'
                  : 'Not configured — not tax exempt.'
                : 'Tax settings unavailable — retry required.'}
            </p>
          )}
          <label className="field">
            <span>{classificationLabel(key)} configured tax treatment</span>
            <select
              value=""
              disabled={
                !canManage || !api.taxReady || api.loading || api.saving
              }
              onChange={(e) =>
                e.target.value &&
                setMapping(key, [...(mappings[key] || []), e.target.value])
              }
            >
              <option value="">Select a configured treatment to add</option>
              {api.data?.tax?.rates
                .filter(
                  (r) => r.active !== false && !mappings[key]?.includes(r.id),
                )
                .map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.name} · {r.jurisdiction} · {r.ratePercent}%
                  </option>
                ))}
            </select>
          </label>
        </div>
      ))}
      {api.taxReady && !api.data?.tax?.rates.length && (
        <p>
          No tax treatments configured. Add and save rates in “Tax rates and
          jurisdictions” below, then retry this list.
        </p>
      )}
      {changedClasses.length > 0 && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Confirm mapping changes for {impacted} linked products. Only future
          category-based calculations change. Existing assignments and recorded
          taxes remain preserved.
        </label>
      )}
      <p>
        Classification does not change Packaging-specific ingredient controls.
      </p>
      <FormErrorNotice message={api.error || api.taxError} />
      <button
        type="button"
        className="btn secondary"
        disabled={
          !canManage ||
          !api.taxReady ||
          api.saving ||
          api.loading ||
          !draft ||
          (changedClasses.length > 0 && !confirmed)
        }
        onClick={async () => {
          const next = await api.save({
            operation: 'saveMappings',
            mappings,
            confirmAffected: confirmed ? impacted : undefined,
          })
          if (next) {
            setDraft(null)
            setConfirmed(false)
            setSaved(true)
          }
        }}
      >
        {api.saving ? 'Saving…' : 'Save category tax mappings'}
      </button>
      {saved && <p role="status">Category tax mappings saved.</p>}
    </section>
  )
}
