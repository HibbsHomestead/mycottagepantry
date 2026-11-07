import { useMemo } from 'react'
import {
  moveRecipeContent,
  parseIngredient,
  sourceHasDirections,
  type ContentSection,
  type RecipeDraft,
} from '@/lib/recipe-import'

export function ContentDestination({
  label,
  value,
  move,
}: {
  label: string
  value: ContentSection
  move: (to: ContentSection) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => move(e.target.value as ContentSection)}
      >
        <option value="unclassified">Needs classification</option>
        <option value="ingredient">Required ingredient</option>
        <option value="instruction">Instructions / Method</option>
        <option value="optional">Optional addition</option>
        <option value="note">Note</option>
      </select>
    </label>
  )
}
export function RecipeContentReview({
  draft,
  sourceText,
  edit,
}: {
  draft: RecipeDraft
  sourceText: string
  edit: (patch: Partial<RecipeDraft>) => void
}) {
  const directions = useMemo(
    () => sourceHasDirections(sourceText),
    [sourceText],
  )
  const missing = directions && !draft.instructions.some((step) => step.trim())
  const move = (
    from: 'instruction' | 'optional' | 'unclassified',
    index: number,
    to: ContentSection,
  ) => edit(moveRecipeContent(draft, from, index, to))
  function step(index: number, text: string) {
    edit({
      instructions: draft.instructions.map((value, at) =>
        at === index ? text : value,
      ),
      missingInstructionsReviewed: false,
    })
  }
  function reorder(index: number, offset: number) {
    const steps = [...draft.instructions],
      groups = steps.map((_, at) => draft.instructionGroups[at] || '')
    const target = index + offset
    ;[steps[index], steps[target]] = [steps[target], steps[index]]
    ;[groups[index], groups[target]] = [groups[target], groups[index]]
    edit({ instructions: steps, instructionGroups: groups })
  }
  return (
    <>
      <section aria-label="Instructions / Method review">
        <h3>Instructions / Method</h3>
        {missing && (
          <div className="recipe-import-warning" role="alert">
            <strong>
              The original source contains directions, but Instructions / Method
              is empty.
            </strong>
            <p>
              Review the source, move any method rows out of ingredient
              matching, or preview reprocessing before approval.
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={draft.missingInstructionsReviewed}
                onChange={(e) =>
                  edit({ missingInstructionsReviewed: e.target.checked })
                }
              />
              I reviewed the source and intentionally left the method empty or
              moved it to notes.
            </label>
          </div>
        )}
        {!draft.instructions.length && !missing && (
          <p>
            No instructions were provided. Add only directions available from
            your source.
          </p>
        )}
        {draft.instructions.map((text, index) => (
          <div className="recipe-content-card" key={index}>
            <label className="field">
              <span>Instruction section {index + 1}</span>
              <input
                value={draft.instructionGroups[index] || ''}
                onChange={(e) =>
                  edit({
                    instructionGroups: draft.instructions.map((_, at) =>
                      at === index
                        ? e.target.value
                        : draft.instructionGroups[at] || '',
                    ),
                  })
                }
              />
            </label>
            <label className="field">
              <span>Method step {index + 1}</span>
              <textarea
                rows={3}
                value={text}
                onChange={(e) => step(index, e.target.value)}
              />
            </label>
            <div className="button-row">
              <button
                className="btn secondary"
                disabled={index === 0}
                onClick={() => reorder(index, -1)}
              >
                Move step {index + 1} up
              </button>
              <button
                className="btn secondary"
                disabled={index === draft.instructions.length - 1}
                onClick={() => reorder(index, 1)}
              >
                Move step {index + 1} down
              </button>
              <button
                className="text-button"
                onClick={() =>
                  edit({
                    instructions: draft.instructions.filter(
                      (_, at) => at !== index,
                    ),
                    instructionGroups: draft.instructions.flatMap((_, at) =>
                      at === index ? [] : [draft.instructionGroups[at] || ''],
                    ),
                  })
                }
              >
                Remove step {index + 1}
              </button>
            </div>
            <ContentDestination
              label={`Classify step ${index + 1}`}
              value="instruction"
              move={(to) => move('instruction', index, to)}
            />
          </div>
        ))}
        <button
          className="btn secondary"
          onClick={() =>
            edit({
              instructions: [...draft.instructions, ''],
              instructionGroups: [
                ...draft.instructions.map(
                  (_, index) => draft.instructionGroups[index] || '',
                ),
                '',
              ],
            })
          }
        >
          Add method step
        </button>
      </section>
      <section aria-label="Optional additions review">
        <h3>Optional additions</h3>
        <p>
          Kept separate from required ingredients. These do not need Pantry
          matches and are excluded from recipe costing unless you explicitly
          move them to required ingredients.
        </p>
        {draft.optionalAdditions.map((line, index) => (
          <div className="recipe-content-card" key={index}>
            {line.group && <strong>{line.group}</strong>}
            <label className="field">
              <span>Optional addition {index + 1}</span>
              <textarea
                value={line.original}
                onChange={(e) =>
                  edit({
                    optionalAdditions: draft.optionalAdditions.map(
                      (value, at) =>
                        at === index
                          ? parseIngredient(e.target.value, value.group)
                          : value,
                    ),
                  })
                }
              />
            </label>
            {line.uncertainty && (
              <p className="warning-text">{line.uncertainty}</p>
            )}
            <ContentDestination
              label={`Classify optional addition ${index + 1}`}
              value="optional"
              move={(to) => move('optional', index, to)}
            />
          </div>
        ))}
        {!draft.optionalAdditions.length && (
          <p>No optional additions provided.</p>
        )}
      </section>
      {!!draft.unclassified.length && (
        <section
          className="recipe-import-warning"
          aria-label="Unclassified source content"
        >
          <h3>Source content needing review</h3>
          <p>
            Classify each item before approval. Nothing here enters Pantry
            matching or costing.
          </p>
          {draft.unclassified.map((text, index) => (
            <div className="recipe-content-card" key={index}>
              <label className="field">
                <span>Unclassified content {index + 1}</span>
                <textarea
                  value={text}
                  onChange={(e) =>
                    edit({
                      unclassified: draft.unclassified.map((value, at) =>
                        at === index ? e.target.value : value,
                      ),
                    })
                  }
                />
              </label>
              <ContentDestination
                label={`Classify unclassified content ${index + 1}`}
                value="unclassified"
                move={(to) => move('unclassified', index, to)}
              />
            </div>
          ))}
        </section>
      )}
    </>
  )
}
