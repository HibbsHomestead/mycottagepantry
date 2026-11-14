import { useRef, useState } from 'react'
import type { Item, Workspace } from '@/lib/domain'
import {
  recipeCategories,
  recipeCategory,
  recipeCategoryListSchema,
  recipeIconNames,
  type RecipeCategory,
  type RecipeIconName,
} from '@/lib/recipe-categories'
import { RecipeCategoryIcon, recipeIconLabels } from './recipe-category-icon'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'

export function RecipeCategorySelect({
  recipe,
  categories,
  onChange,
  disabled = false,
  label = 'Recipe category',
}: {
  recipe: Item
  categories: RecipeCategory[]
  onChange: (category: RecipeCategory | undefined) => void
  disabled?: boolean
  label?: string
}) {
  const current = recipeCategory(recipe, categories)
  return (
    <label className="field">
      <span>{label}</span>
      <span className="recipe-category-select">
        <RecipeCategoryIcon icon={current?.icon} />
        <select
          aria-label={label}
          value={current?.id || ''}
          disabled={disabled}
          onChange={(e) =>
            onChange(categories.find((c) => c.id === e.target.value))
          }
        >
          <option value="">Uncategorized</option>
          {categories
            .filter((c) => c.active || c.id === current?.id)
            .map((c) => (
              <option key={c.id} value={c.id} disabled={!c.active}>
                {c.name}
                {c.active ? '' : ' (archived)'}
              </option>
            ))}
        </select>
      </span>
    </label>
  )
}

export function RecipeCategoryManager({
  workspace,
  onSettings,
  close,
}: {
  workspace: Workspace
  onSettings: (patch: Partial<Item>) => void
  close: () => void
}) {
  const [categories, setCategories] = useState(() =>
    recipeCategories(workspace),
  )
  const [revision, setRevision] = useState(
    workspace.settings[0]?.recipeCategoryRevision || 0,
  )
  const [editing, setEditing] = useState<RecipeCategory>()
  const [name, setName] = useState(''),
    [icon, setIcon] = useState<RecipeIconName>('other')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [picker, setPicker] = useState(false)
  const pending = useRef(false)
  const reset = () => {
    setEditing(undefined)
    setName('')
    setIcon('other')
    setPicker(false)
  }
  async function request(payload?: Record<string, unknown>) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(
        '/api/workspace?recipeCategories=1',
        payload
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...payload,
                expectedRevision: revision,
              }),
            }
          : undefined,
      )
      const result = await response.json()
      if (!response.ok)
        throw new Error(
          result.error ||
            'Could not save recipe categories. Your edits are preserved.',
        )
      const next = recipeCategoryListSchema.parse(result.categories)
      if (!Number.isInteger(result.revision))
        throw new Error(
          'Could not read category settings. Reload categories and retry.',
        )
      setCategories(next)
      setRevision(result.revision)
      onSettings({
        recipeCategories: next,
        recipeCategoryRevision: result.revision,
      })
      if (payload?.operation === 'saveCategory') reset()
      setNotice(
        payload
          ? 'Category changes saved.'
          : 'Categories reloaded. Your edits are preserved.',
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not connect. Your edits are preserved.',
      )
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close()
      }}
    >
      <DialogContent className="app-dialog">
        <DialogTitle>Recipe categories</DialogTitle>
        <DialogDescription>
          Add categories, choose an icon, or archive unused options. Existing
          recipes keep archived categories.
        </DialogDescription>
        <div className="recipe-category-manager">
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void request()}
              >
                Reload categories
              </button>
            </div>
          )}
          {notice && <p role="status">{notice}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void request({
                operation: 'saveCategory',
                category: { id: editing?.id, name, icon },
              })
            }}
          >
            <label className="field">
              <span>{editing ? 'Rename category' : 'New category name'}</span>
              <input
                value={name}
                maxLength={100}
                required
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="button-row">
              <button
                type="button"
                className="btn secondary"
                aria-expanded={picker}
                onClick={() => setPicker(!picker)}
                disabled={busy}
              >
                <RecipeCategoryIcon icon={icon} /> {recipeIconLabels[icon]} icon
              </button>
              <button className="btn" disabled={busy || !name.trim()}>
                {busy ? 'Saving…' : editing ? 'Save category' : 'Add category'}
              </button>
              {editing && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={reset}
                >
                  Cancel edit
                </button>
              )}
            </div>
            {picker && (
              <fieldset className="recipe-category-icon-picker">
                <legend>Choose a category icon</legend>
                {recipeIconNames.map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={icon === value}
                    disabled={busy}
                    onClick={() => {
                      setIcon(value)
                      setPicker(false)
                    }}
                  >
                    <RecipeCategoryIcon icon={value} />
                    {recipeIconLabels[value]}
                  </button>
                ))}
              </fieldset>
            )}
          </form>
          <div className="recipe-category-list">
            {categories.map((c) => (
              <div className="recipe-category-row" key={c.id}>
                <RecipeCategoryIcon icon={c.icon} />
                <span>
                  {c.name}
                  {!c.active && <small> · Archived</small>}
                </span>
                <div className="button-row">
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    aria-label={`Edit ${c.name}`}
                    onClick={() => {
                      setEditing(c)
                      setName(c.name)
                      setIcon(c.icon)
                      setPicker(false)
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    aria-label={`${c.active ? 'Archive' : 'Restore'} ${c.name}`}
                    onClick={() =>
                      void request({
                        operation: 'setCategoryActive',
                        categoryId: c.id,
                        active: !c.active,
                      })
                    }
                  >
                    {c.active ? 'Archive' : 'Restore'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button className="btn secondary" disabled={busy} onClick={close}>
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
