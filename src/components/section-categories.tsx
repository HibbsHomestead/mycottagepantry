import { FormErrorNotice } from './form-error-notice'
import { SubmissionForm } from './submission-form'
import { TooltipProvider } from './ui/tooltip'
import { ActionTip } from './action-tip'
import { MoreHorizontal, Plus, Settings, RefreshCw } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu'
import { pantryCategoryConflict } from '@/lib/section-categories'
import { useEffect, useRef, useState } from 'react'
import { categoryTaxDescription, type Item, type Workspace } from '@/lib/domain'
import {
  categoryScopes,
  productCategoryScope,
  pantryCategoryScope,
  categoryOrder,
  type CategoryScope,
} from '@/lib/category-details'
import {
  assignedCategoryId,
  categoryEndpointFor,
  categorySettingsPatch,
  recordsInScope,
  sectionCategories,
  type SectionCategory,
} from '@/lib/section-categories'
import { recipeIconNames } from '@/lib/recipe-categories'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import './section-categories.css'

type Common = {
  workspace: Workspace
  scope: CategoryScope
  canManage: boolean
  onSettings: (patch: Partial<Item>) => void
}
export function SectionCategoryManager({
  workspace,
  scope,
  onSettings,
  close,
  create = false,
  onCreated,
}: Omit<Common, 'canManage'> & {
  close: () => void
  create?: boolean
  onCreated?: (category: SectionCategory) => void
}) {
  const [w, setW] = useState(workspace)
  const [editing, setEditing] = useState<Partial<SectionCategory> | null>(
    create ? { scope } : null,
  )
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [confirmed, setConfirmed] = useState(false)
  const pending = useRef(false)
  const endpoint = categoryEndpointFor(scope)
  const isProduct = scope.endsWith('products') || scope === 'kits'
  const accept = (data: any) => {
    if (!Array.isArray(data.categories) || !Number.isInteger(data.revision))
      throw new Error(
        'Category response unavailable. Reload categories; your edits are preserved.',
      )
    const patch = categorySettingsPatch(scope, data)
    setW((old) => ({
      ...old,
      settings: [{ ...old.settings[0], ...patch }, ...old.settings.slice(1)],
    }))
    onSettings(patch)
    setLoaded(true)
  }
  async function request(payload?: any) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const business = w.settings[0]
      const revision =
        scope === 'recipes'
          ? business.recipeCategoryRevision || 0
          : isProduct
            ? business.categoryConfigRevision || 0
            : business.pantryCategoryRevision || 0
      const res = await fetch(
        endpoint,
        payload
          ? {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload, expectedRevision: revision }),
            }
          : { credentials: 'same-origin' },
      )
      if (!(res.headers.get('content-type') || '').includes('application/json'))
        throw new Error(
          'Could not read categories. Check your connection and reload categories.',
        )
      const data = await res.json()
      if (!res.ok)
        throw new Error(data.error || 'Category changes could not be saved.')
      accept(data)
      if (payload?.operation === 'saveCategory') {
        const saved = data.categories.find(
          (c: SectionCategory) => c.id === data.selectedId,
        )
        if (!editing?.id && saved) {
          onCreated?.(saved)
          if (create) {
            close()
            return
          }
        }
        setEditing(null)
        setConfirmed(false)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  useEffect(() => {
    void request()
  }, [])
  const categories = sectionCategories(w, scope)
  const legacy: SectionCategory[] = isProduct
    ? (w.settings[0].productCategories || []).filter(
        (c: SectionCategory) => !c.scope,
      )
    : []
  const all = isProduct ? [...categories, ...legacy] : categories
  const change = (key: string, value: unknown) => {
    setEditing((e) => ({ ...e, [key]: value }))
    setConfirmed(false)
  }
  const affected = w.products.filter(
    (p) => p.productCategoryId === editing?.id,
  ).length
  const changesTax =
    isProduct &&
    !!editing?.id &&
    editing.classification !==
      (w.settings[0].productCategories || []).find(
        (c: SectionCategory) => c.id === editing.id,
      )?.classification
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && close()}>
      <DialogContent className="app-dialog wide-dialog section-category-dialog">
        <DialogHeader>
          <DialogTitle>
            {scope === 'recipes'
              ? create
                ? 'Add recipe category'
                : 'Manage recipe categories'
              : `${create ? 'Add category' : 'Manage categories'} · ${categoryScopes[scope]}`}
          </DialogTitle>
          <DialogDescription>
            Categories belong to this business and section. Archiving keeps
            assigned records and history. Category changes save separately;
            cancelling the item editor does not undo them.
          </DialogDescription>
        </DialogHeader>

        {!loaded && !error && <p role="status">Loading categories…</p>}
        {editing ? (
          <SubmissionForm
            className="app-form category-detail-form"
            onSubmit={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void request({
                operation: 'saveCategory',
                category: {
                  ...editing,
                  scope,
                  icon: editing.icon || 'other',
                  classification: editing.classification ?? null,
                },
                confirmAffected: changesTax && confirmed ? affected : undefined,
              })
            }}
          >
            <fieldset disabled={busy || !loaded}>
              <div className="form-grid">
                <label>
                  Category name
                  <input
                    required
                    maxLength={100}
                    value={editing.name || ''}
                    onChange={(e) => change('name', e.target.value)}
                  />
                </label>
                <label>
                  Section
                  <input value={categoryScopes[scope]} readOnly />
                </label>
                <label>
                  Parent category
                  <select
                    aria-label="Parent category"
                    value={editing.parentId || ''}
                    onChange={(e) => change('parentId', e.target.value || null)}
                  >
                    <option value="">No parent</option>
                    {categories
                      .filter((c) => c.id !== editing.id && c.active !== false)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Display order
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    step="1"
                    value={editing.displayOrder ?? 0}
                    onChange={(e) =>
                      change(
                        'displayOrder',
                        e.target.value === ''
                          ? undefined
                          : Number(e.target.value),
                      )
                    }
                  />
                </label>
              </div>
              <label>
                Description
                <textarea
                  maxLength={1000}
                  rows={2}
                  value={editing.description || ''}
                  onChange={(e) => change('description', e.target.value)}
                />
              </label>
              {scope === 'recipes' && (
                <label>
                  Category icon
                  <select
                    value={editing.icon || 'other'}
                    onChange={(e) => change('icon', e.target.value)}
                  >
                    {recipeIconNames.map((i) => (
                      <option key={i}>{i}</option>
                    ))}
                  </select>
                </label>
              )}
              {isProduct && (
                <>
                  <label>
                    Food / non-food classification
                    <select
                      required
                      aria-label="Classification"
                      value={editing.classification || ''}
                      onChange={(e) => change('classification', e.target.value)}
                    >
                      <option value="">Choose classification</option>
                      <option value="food">Food</option>
                      <option value="non_food">Non-food</option>
                    </select>
                  </label>
                  <p className="form-hint">
                    Classification uses classification-scoped rules and existing
                    category tax mappings. Section does not determine tax
                    treatment. Manage rate mappings in Products → Categories →
                    Tax Settings.
                  </p>
                  <p className="form-hint">
                    Inherited tax treatment:{' '}
                    {categoryTaxDescription(
                      {
                        ...editing,
                        id: editing.id || '',
                        name: editing.name || '',
                      },
                      w.settings[0],
                    )}
                  </p>
                  {changesTax && (
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      Confirm classification change for {affected} linked
                      products. Recorded taxes stay unchanged.
                    </label>
                  )}
                </>
              )}
            </fieldset>
            <div className="form-footer">
              {error && (
                <FormErrorNotice>
                  {error}
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => void request()}
                  >
                    Reload categories
                  </button>
                </FormErrorNotice>
              )}

              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => (create ? close() : setEditing(null))}
              >
                Cancel category edit
              </button>
              <button
                className="btn"
                disabled={busy || !loaded || (changesTax && !confirmed)}
              >
                {busy ? 'Saving…' : 'Save category'}
              </button>
            </div>
          </SubmissionForm>
        ) : (
          <>
            <div className="button-row">
              <button
                type="button"
                className="btn"
                disabled={busy || !loaded}
                onClick={() => setEditing({ scope })}
              >
                Add category
              </button>
            </div>
            <ul className="section-category-list">
              {categoryOrder(all).map((c) => {
                const count = recordsInScope(w, scope).filter(
                  (i) => assignedCategoryId(i, w, scope) === c.id,
                ).length
                const parent = all.find((p) => p.id === c.parentId)
                return (
                  <li key={c.id}>
                    <div>
                      <strong>
                        {parent ? `${parent.name} / ` : ''}
                        {c.name}
                      </strong>
                      <small>
                        {!c.scope && isProduct
                          ? 'Legacy section assignment · review needed'
                          : c.needsReview
                            ? 'Legacy label · review needed'
                            : categoryScopes[scope]}{' '}
                        · {c.active === false ? 'Archived' : 'Active'} · Order{' '}
                        {c.displayOrder || 0} · {count} assigned records
                      </small>
                      {c.description && <p>{c.description}</p>}
                    </div>
                    <div className="button-row">
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy || !loaded}
                        onClick={() => {
                          setEditing(c)
                          setConfirmed(false)
                        }}
                      >
                        Edit {c.name}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy || !loaded}
                        onClick={() =>
                          void request({
                            operation: 'setCategoryActive',
                            categoryId: c.id,
                            active: c.active === false,
                            confirm: true,
                          })
                        }
                      >
                        {c.active === false ? 'Restore' : 'Archive'} {c.name}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {!all.length && <p>No categories in this section yet.</p>}
            <div className="form-footer">
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={close}
              >
                Done
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
export function SectionCategoryTools({
  workspace,
  scope,
  canManage,
  onSettings,
  value,
  onFilter,
  compact = false,
  filterScopes,
}: Common & {
  compact?: boolean
  filterScopes?: CategoryScope[]
  value?: string
  onFilter?: (id: string) => void
}) {
  const [mode, setMode] = useState('')
  return (
    <div className="section-category-tools">
      {onFilter && (
        <label>
          Filter by category
          <select
            aria-label="Filter by category"
            value={value || 'all'}
            onChange={(e) => onFilter(e.target.value)}
          >
            <option value="all">All categories</option>
            <option value="uncategorized">Uncategorized</option>
            {[
              ...new Map(
                (filterScopes || [scope])
                  .flatMap((s) => sectionCategories(workspace, s))
                  .map((c) => [c.id, c]),
              ).values(),
            ].map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.active === false ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {canManage &&
        (compact ? (
          <DropdownMenu>
            <ActionTip label="Category actions">
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="btn secondary"
                  aria-label="Category actions"
                >
                  <MoreHorizontal size={18} />
                  <span className="catalog-category-label">
                    Category actions
                  </span>
                </button>
              </DropdownMenuTrigger>
            </ActionTip>
            <DropdownMenuContent className="workspace-menu">
              <DropdownMenuItem onSelect={() => setMode('add')}>
                Add category
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMode('manage')}>
                Manage categories
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="button-row">
            <button
              type="button"
              className="btn secondary"
              onClick={() => setMode('add')}
            >
              Add category
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setMode('manage')}
            >
              Manage categories
            </button>
          </div>
        ))}
      {mode && (
        <SectionCategoryManager
          workspace={workspace}
          scope={scope}
          onSettings={onSettings}
          create={mode === 'add'}
          close={() => setMode('')}
        />
      )}
    </div>
  )
}
export function ScopedCategorySelect({
  workspace,
  scope,
  item,
  canManage,
  onSettings,
  onChange,
}: Common & { item: Item; onChange: (key: string, value: any) => void }) {
  const [mode, setMode] = useState('')
  const [retry, setRetry] = useState(0)
  const businessId = workspace.settings[0]?.id
  const requestKey = `${businessId}:${scope}:${retry}`
  const [requestState, setRequestState] = useState<{
    key: string
    status: 'ready' | 'error'
  } | null>(null)
  const loadState =
    requestState?.key === requestKey ? requestState.status : 'loading'
  const settingsCallback = useRef(onSettings)
  useEffect(() => {
    settingsCallback.current = onSettings
  }, [onSettings])
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(categoryEndpointFor(scope), {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Categories unavailable')
        const data = await response.json()
        if (!Array.isArray(data.categories) || !Number.isInteger(data.revision))
          throw new Error('Invalid categories')
        if (cancelled) return
        settingsCallback.current(categorySettingsPatch(scope, data))
        setRequestState({ key: requestKey, status: 'ready' })
      } catch {
        if (!cancelled) setRequestState({ key: requestKey, status: 'error' })
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [requestKey, scope])
  const categories = sectionCategories(workspace, scope)
  const id = assignedCategoryId(item, workspace, scope)
  const current = categories.find((c) => c.id === id)
  const select = (category?: SectionCategory) => {
    if (scope === 'recipes') {
      onChange('recipeCategoryId', category?.id || '')
      onChange('category', category?.name || '')
    } else if (scope.endsWith('products') || scope === 'kits')
      onChange('productCategoryId', category?.id || '')
    else {
      onChange('sectionCategoryId', category?.id || '')
      onChange('category', category?.name || '')
      onChange('categoryId', category?.id || '')
      if (scope === 'handmade-materials')
        onChange('materialCategory', category?.name || '')
    }
  }
  return (
    <div className="scoped-category-select">
      <span className="category-field-label">Category</span>
      <TooltipProvider>
        <div className="category-input-row">
          <label>
            <span className="sr-only">Category</span>
            <select
              aria-label="Category"
              disabled={loadState !== 'ready'}
              aria-busy={loadState === 'loading'}
              value={id}
              onChange={(e) =>
                select(categories.find((c) => c.id === e.target.value))
              }
            >
              <option value="">Uncategorized</option>
              {id && !current && (
                <option value={id} disabled>
                  Saved category · review section assignment
                </option>
              )}
              {(loadState === 'ready' ? categories : current ? [current] : [])
                .filter((c) => c.active !== false || c.id === id)
                .map((c) => (
                  <option key={c.id} value={c.id} disabled={c.active === false}>
                    {c.parentId
                      ? `${categories.find((p) => p.id === c.parentId)?.name || 'Parent'} / `
                      : ''}
                    {c.name}
                    {c.active === false ? ' (archived)' : ''}
                  </option>
                ))}
            </select>
          </label>
          {canManage && (
            <>
              <ActionTip label="Add category">
                <button
                  type="button"
                  className="text-button category-compact-action"
                  aria-label="Add category"
                  onClick={() => setMode('add')}
                >
                  <Plus size={18} />
                  <span>Add</span>
                </button>
              </ActionTip>
              <ActionTip label="Manage categories">
                <button
                  type="button"
                  className="text-button category-compact-action"
                  aria-label="Manage categories"
                  onClick={() => setMode('manage')}
                >
                  <Settings size={18} />
                  <span>Manage</span>
                </button>
              </ActionTip>
            </>
          )}
          <ActionTip label="Refresh categories">
            <button
              type="button"
              className="text-button category-compact-action"
              aria-label="Refresh categories"
              disabled={loadState === 'loading'}
              onClick={() => setRetry((n) => n + 1)}
            >
              <RefreshCw size={16} />
            </button>
          </ActionTip>
        </div>
      </TooltipProvider>
      {loadState === 'loading' && (
        <p role="status">Loading current categories…</p>
      )}
      {loadState === 'error' && (
        <p role="alert">
          Could not load current categories. Your selection is preserved.{' '}
          <button
            type="button"
            className="text-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry categories
          </button>
        </p>
      )}
      {loadState === 'ready' && !categories.some((c) => c.active !== false) && (
        <p role="status">No active categories configured in this section.</p>
      )}
      {id && !current && (
        <p role="status">
          Saved category “{item.category || id}” needs review. Choose a current
          category to replace it.
        </p>
      )}
      {pantryCategoryConflict(item, workspace) &&
        !scope.endsWith('products') &&
        scope !== 'recipes' && (
          <p className="form-hint warning-text" role="status">
            {pantryCategoryConflict(item, workspace)}{' '}
            {current && current.active !== false && (
              <button
                type="button"
                className="text-button"
                onClick={() => select(current)}
              >
                Confirm selected category
              </button>
            )}
          </p>
        )}
      {current?.description && (
        <p className="form-hint">{current.description}</p>
      )}
      {current?.needsReview && (
        <p className="form-hint">
          Legacy label preserved; category details need review.
        </p>
      )}
      {mode && (
        <SectionCategoryManager
          workspace={workspace}
          scope={scope}
          onSettings={onSettings}
          create={mode === 'add'}
          onCreated={select}
          close={() => setMode('')}
        />
      )}
    </div>
  )
}
export { productCategoryScope, pantryCategoryScope }
