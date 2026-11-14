import { useState } from 'react'
import type { RecipeCategory } from '@/lib/recipe-categories'
import { recipeCategoryLabel } from '@/lib/recipe-categories'
import { PantryPhoto } from './pantry-photo'
import { type Item, unitLabel } from '@/lib/domain'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'

export function RecipeComponentPicker({
  recipes,
  categories = [],
  assets = [],
  parentId,
  select,
  close,
}: {
  recipes: Item[]
  categories?: RecipeCategory[]
  assets?: Item[]
  parentId?: string
  select: (recipe: Item) => void
  close: () => void
}) {
  const [query, setQuery] = useState('')
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="app-dialog">
        <DialogTitle>Add recipe component</DialogTitle>
        <DialogDescription>
          Use prepared stock from a linked recipe. Prepare and complete its
          batch before completing the parent run.
        </DialogDescription>
        <label className="field">
          <span>Search recipes</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="component-search-results">
          {recipes
            .filter(
              (r) =>
                r.id !== parentId &&
                r.name.toLowerCase().includes(query.toLowerCase()),
            )
            .map((r) => (
              <button
                type="button"
                key={r.id}
                className="btn secondary"
                onClick={() => select(r)}
              >
                <PantryPhoto
                  item={r}
                  assets={assets}
                  kind="recipe"
                  recipeCategories={categories}
                />
                <span>
                  {r.name}
                  <small>{recipeCategoryLabel(r, categories)}</small>
                </span>
                <small>
                  Finished yield: {r.yield} {unitLabel(r.yieldUnit)}
                </small>
              </button>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
