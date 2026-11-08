import {
  baseIngredientOverlap,
  effectiveRecipeLines,
  unitLabel,
  type Item,
} from '@/lib/domain'

export function RecipeBaseFields({
  recipe,
  recipes,
  ingredients,
  change,
}: {
  recipe: Item
  recipes: Item[]
  ingredients: Item[]
  change: (key: string, value: any) => void
}) {
  const base = recipes.find((r) => r.id === recipe.baseRecipeId)
  const registry = [...recipes.filter((r) => r.id !== recipe.id), recipe]
  let overlap: ReturnType<typeof baseIngredientOverlap> = null
  let issue = ''
  try {
    overlap = baseIngredientOverlap(recipe, registry)
  } catch (e) {
    issue = (e as Error).message
  }
  return (
    <section className="recipe-base-fields" aria-label="Linked base recipe">
      <h3>Base recipe (optional)</h3>
      <div className="form-grid">
        <label className="field">
          <span>Base recipe</span>
          <select
            value={recipe.baseRecipeId || ''}
            onChange={(e) => {
              change('baseRecipeId', e.target.value || null)
              if (!recipe.baseMultiplier) change('baseMultiplier', 1)
              change('baseOverlapApproval', '')
            }}
          >
            <option value="">No linked base</option>
            {recipes
              .filter((r) => r.id !== recipe.id && r.workflow !== 'handmade')
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </label>
        {base && (
          <label className="field">
            <span>Base quantity (batches)</span>
            <input
              type="number"
              step="any"
              min="0.000001"
              required
              value={recipe.baseMultiplier ?? 1}
              onChange={(e) => {
                change('baseMultiplier', e.target.value)
                change('baseOverlapApproval', '')
              }}
            />
          </label>
        )}
      </div>
      {base && (
        <>
          <p>
            <strong>
              {base.name} × {recipe.baseMultiplier ?? 1} batch(es)
            </strong>
            {' · '}
            <a
              className="text-button"
              href={`/oven?recipe=${encodeURIComponent(base.id)}#Recipes`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open base recipe
            </a>
          </p>
          <p className="form-hint">
            Uses the base’s saved ingredient quantities. Inclusions below are
            for this variation batch; the base multiplier does not scale them.
            Set this variation’s own finished yield and product packaging
            separately.
          </p>
          <details>
            <summary>Base ingredients and quantities</summary>
            {!issue &&
              effectiveRecipeLines(base, registry).map((line, index) => (
                <p key={index}>
                  {ingredients.find((i) => i.id === line.ingredientId)?.name}:{' '}
                  {Number(line.quantity) * Number(recipe.baseMultiplier ?? 1)}{' '}
                  {unitLabel(line.unit)}
                </p>
              ))}
          </details>
        </>
      )}
      {overlap && (
        <div className="calculation-box">
          <p>
            Also present in the base:{' '}
            {overlap.ids
              .map((id) => ingredients.find((i) => i.id === id)?.name || id)
              .join(', ')}
            . The saved inclusion quantities remain additional. Nothing is
            merged or removed.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={recipe.baseOverlapApproval === overlap.approval}
              onChange={(e) =>
                change(
                  'baseOverlapApproval',
                  e.target.checked ? overlap!.approval : '',
                )
              }
            />
            I reviewed the overlap and approve keeping both quantities.
          </label>
        </div>
      )}
      {issue && <p role="alert">{issue}</p>}
    </section>
  )
}
