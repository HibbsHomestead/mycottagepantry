import {
  recipeMethod,
  type RecipeDraft,
  type reprocessRecipeDraft,
} from '@/lib/recipe-import'
export type RecipeRepair = ReturnType<typeof reprocessRecipeDraft>
function Content({ draft }: { draft: RecipeDraft }) {
  return (
    <>
      <p>
        <strong>{draft.title || 'Untitled'}</strong>
      </p>
      <p>{draft.description || 'No description'}</p>
      <p>Source: {draft.sourceUrl || 'Not set'}</p>
      <p>
        Yield: {draft.yieldQuantity ?? 'Unknown'} {draft.yieldUnit} · Prep:{' '}
        {draft.prepMinutes ?? 'Unknown'} · Cook:{' '}
        {draft.cookMinutes ?? 'Unknown'}
      </p>
      <h4>Required ingredients · {draft.lines.length}</h4>
      <ul>
        {draft.lines.map((line, index) => (
          <li key={index}>
            {line.original}
            <small>
              {' '}
              · Parsed: {line.quantity ?? 'Unknown'} {line.unit} {line.name}
              {line.ingredientId ? ' · Pantry match retained' : ''}
            </small>
          </li>
        ))}
      </ul>
      <h4>Instructions / Method · {draft.instructions.length}</h4>
      <pre className="recipe-source-text">
        {recipeMethod(draft) || 'No instructions'}
      </pre>
      <h4>Optional additions</h4>
      <ul>
        {draft.optionalAdditions.map((line, index) => (
          <li key={index}>{line.original}</li>
        ))}
      </ul>
      <h4>Notes</h4>
      <pre className="recipe-source-text">{draft.notes || 'None'}</pre>
      {!!draft.unclassified.length && (
        <>
          <h4>Needs classification</h4>
          <ul>
            {draft.unclassified.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
export function RecipeRepairPreview({
  before,
  repair,
  confirmed,
  confirm,
  apply,
  cancel,
  busy,
}: {
  before: RecipeDraft
  repair: RecipeRepair
  confirmed: boolean
  confirm: (value: boolean) => void
  apply: () => void
  cancel: () => void
  busy: boolean
}) {
  return (
    <section
      className="recipe-import-warning"
      aria-label="Proposed import repair"
    >
      <h3>Proposed repair from preserved source</h3>
      <p>
        {repair.movedInstructions} misclassified ingredient rows move to
        Instructions / Method. {repair.preservedMatches} valid Pantry matches
        are retained for unchanged source lines.
      </p>
      <p>
        Reprocessing replaces extracted text, quantities and any draft edits
        shown below. A snapshot of the current draft is retained with this
        repair. The original source stays untouched. No recipe is created or
        changed.
      </p>
      <div className="recipe-import-comparison">
        <details>
          <summary>Current draft</summary>
          <Content draft={before} />
        </details>
        <div>
          <h4>Proposed draft</h4>
          <Content draft={repair.draft} />
        </div>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => confirm(e.target.checked)}
        />
        I confirm replacing this draft’s edits with the proposed repair.
      </label>
      <div className="button-row">
        <button className="btn secondary" disabled={busy} onClick={cancel}>
          Keep current draft
        </button>
        <button className="btn" disabled={!confirmed || busy} onClick={apply}>
          Apply repair to this draft
        </button>
      </div>
    </section>
  )
}
