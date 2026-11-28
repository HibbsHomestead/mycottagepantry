import { useState } from 'react'
import type { Item } from '@/lib/domain'
import type { LabelData } from '@/lib/label-studio'
import {
  componentSources,
  componentWeightSource,
  majorAllergens,
  speciesAllergens,
  validateAllergenDecisions,
  type AllergenDecision,
  type AllergenDecisions,
  type ComponentSource,
  type MajorAllergen,
} from '@/lib/label-ingredient-review'

export function ComponentWeightFields({
  draft,
  change,
}: {
  draft: Item
  change: (key: string, value: unknown) => void
}) {
  const text = String(draft.subingredients || '').trim()
  if (!text) return null
  const nodes = componentSources(text)
  const sourceRef = componentWeightSource(draft)
  const shares =
    draft.labelComponentWeights?.text === text &&
    (draft.labelComponentWeights.sourceRef || '') === sourceRef
      ? draft.labelComponentWeights.shares
      : {}
  function fields(rows: ComponentSource[]) {
    return rows.map((row) => (
      <div key={row.key} className="label-review-component">
        <label>
          {row.name} · % by weight
          <input
            type="text"
            inputMode="decimal"
            maxLength={11}
            placeholder="Unknown"
            value={shares[row.key] || ''}
            onChange={(event) =>
              change('labelComponentWeights', {
                text,
                sourceRef,
                shares: { ...shares, [row.key]: event.target.value },
              })
            }
          />
        </label>
        {!!row.children.length && (
          <div className="label-review-nested">{fields(row.children)}</div>
        )}
      </div>
    ))
  }
  return (
    <details className="product-ingredients-source">
      <summary>Supplier component weights for merged labels</summary>
      <p>
        Use documented percentages by weight only. Each level must total 100%.
        Leave an unknown percentage blank; merged labels stay unconfirmed.
      </p>
      {nodes ? (
        fields(nodes)
      ) : (
        <p>
          This source text cannot safely be split. Keep the parenthetical
          statement or verify the source structure.
        </p>
      )}
    </details>
  )
}

export function IngredientModeReview({
  preview,
  change,
}: {
  preview: NonNullable<LabelData['ingredientMerge']>
  change?: (key: string, value: unknown) => void
}) {
  return (
    <div className="label-review-section">
      <h4>Ingredient statement modes</h4>
      {change && (
        <>
          <label className="field">
            <span>Product’s label ingredient mode</span>
            <select
              value={preview.mode}
              onChange={(event) =>
                change('labelIngredientMode', event.target.value)
              }
            >
              <option value="parenthetical">
                Show compound ingredient with sub-ingredients in parentheses
              </option>
              <option value="merged">
                Merge into a single ingredient list
              </option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={preview.groupSmall}
              onChange={(event) =>
                change('labelGroupSmallIngredients', event.target.checked)
              }
            />{' '}
            Group ingredients below 2% when verified
          </label>
        </>
      )}
      <div className="label-review-comparison">
        <div>
          <h5>Parenthetical</h5>
          <p>{preview.parenthetical || 'Source statement unavailable.'}</p>
        </div>
        <div>
          <h5>Merged by verified weight</h5>
          <p>
            {preview.merged ||
              'Unconfirmed — use the parenthetical statement until verified.'}
          </p>
        </div>
      </div>
      {!!preview.issues.length && (
        <ul>
          {preview.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {!!preview.parts.length && (
        <details>
          <summary>
            {preview.merged
              ? 'Weights used to order the list'
              : 'Known weights only — not a complete ordering'}
          </summary>
          <ul>
            {preview.parts.map((part) => (
              <li key={part.name}>
                <strong>{part.name}</strong> ·{' '}
                {part.weight.toLocaleString(undefined, {
                  maximumSignificantDigits: 7,
                })}{' '}
                g
                <ul>
                  {part.contributions.map((source, index) => (
                    <li key={index}>
                      {source.path.join(' → ')} ·{' '}
                      {source.grams.toLocaleString(undefined, {
                        maximumSignificantDigits: 7,
                      })}{' '}
                      g
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

export type ReviewMutation = (
  action: string,
  table: string,
  data: Record<string, unknown>,
) => Promise<unknown>

export function ProductAllergenReview({
  review,
  product,
  mutate,
}: {
  review: NonNullable<LabelData['allergenReview']>
  product: Item
  mutate?: ReviewMutation
}) {
  const [decisions, setDecisions] = useState<AllergenDecisions>(() =>
    review.status === 'changed' ? {} : review.decisions,
  )
  const [aliasTarget, setAliasTarget] = useState<MajorAllergen>('Milk')
  const [aliases, setAliases] = useState(() =>
    (product.allergenAliases?.Milk || []).join(', '),
  )
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [advisory, setAdvisory] = useState<string>(
    () => product.allergenReview?.advisory || '',
  )
  const update = (allergen: MajorAllergen, patch: Partial<AllergenDecision>) =>
    setDecisions((current) => ({
      ...current,
      [allergen]: { status: 'unknown', ...current[allergen], ...patch },
    }))
  async function save(mapping: boolean) {
    if (!mutate || busy) return
    setBusy(true)
    try {
      await mutate(
        mapping ? 'productAllergenMapping' : 'productAllergenReview',
        'products',
        {
          id: product.id,
          source: review.source,
          reviewedAt: product.allergenReview?.reviewedAt || '',
          ...(mapping
            ? { allergen: aliasTarget, aliases }
            : {
                advisory,
                decisions: validateAllergenDecisions(
                  Object.fromEntries(
                    majorAllergens.map((name) => [
                      name,
                      decisions[name] || { status: 'unknown' },
                    ]),
                  ),
                  review.evidence,
                ),
              }),
        },
      )
      setNotice(
        mapping
          ? 'Suggestion names saved. Review the updated evidence.'
          : 'Review saved.',
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Review not saved.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="label-review-section">
      <summary>
        Major allergen review ·{' '}
        {review.status === 'confirmed'
          ? 'Confirmed'
          : review.status === 'changed'
            ? 'Changes need re-review'
            : 'Not confirmed'}
      </summary>
      <p>
        Suggestions are not confirmations. Check the supplier or recipe source
        before declaring an allergen present or absent. This review does not
        infer cross-contact.
      </p>
      {!!review.changed.length && (
        <p>Changed sources: {review.changed.join('; ')}</p>
      )}
      {!!review.evidence.length && (
        <ul aria-label="Ingredient evidence">
          {review.evidence.map((entry, index) => (
            <li key={index}>
              {entry.allergen ? `${entry.allergen} · ` : ''}
              {entry.sourceDeclaration
                ? 'Declared by the reviewed source'
                : entry.confidence === 'name match'
                  ? 'High confidence name match'
                  : entry.confidence}{' '}
              · {entry.path.join(' → ')}
            </li>
          ))}
        </ul>
      )}
      {mutate && (
        <>
          <div className="label-review-decisions">
            {majorAllergens.map((allergen) => {
              const value = decisions[allergen]
              const suggested = review.evidence.some(
                (entry) => entry.allergen === allergen,
              )
              return (
                <fieldset key={allergen}>
                  <legend>{allergen}</legend>
                  <label className="field">
                    <span>Review state</span>
                    <select
                      value={value?.status || 'unknown'}
                      onChange={(event) =>
                        update(allergen, {
                          status: event.target
                            .value as AllergenDecision['status'],
                        })
                      }
                    >
                      <option value="unknown">
                        {suggested && !value
                          ? 'Suggested · not confirmed'
                          : 'Unknown'}
                      </option>
                      <option value="review">Needs review</option>
                      <option value="present">Confirmed present</option>
                      <option value="absent">Confirmed absent</option>
                    </select>
                  </label>
                  {value?.status === 'absent' && suggested && (
                    <label className="field">
                      <span>Reason for dismissal</span>
                      <input
                        maxLength={500}
                        value={value.reason || ''}
                        onChange={(event) =>
                          update(allergen, { reason: event.target.value })
                        }
                      />
                    </label>
                  )}
                  {value?.status === 'present' &&
                    speciesAllergens.some((entry) => entry === allergen) && (
                      <label className="field">
                        <span>Specific reviewed source name(s)</span>
                        <input
                          maxLength={120}
                          value={value.name || ''}
                          onChange={(event) =>
                            update(allergen, { name: event.target.value })
                          }
                        />
                      </label>
                    )}
                </fieldset>
              )
            })}
          </div>
          <label className="field">
            <span>Optional reviewed cross-contact advisory</span>
            <textarea
              maxLength={500}
              value={advisory}
              onChange={(event) => setAdvisory(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void save(false)}
          >
            Save allergen review
          </button>
          <details>
            <summary>Edit suggestion names for this product</summary>
            <label className="field">
              <span>Allergen</span>
              <select
                value={aliasTarget}
                onChange={(event) => {
                  const target = event.target.value as MajorAllergen
                  setAliasTarget(target)
                  setAliases(
                    (product.allergenAliases?.[target] || []).join(', '),
                  )
                }}
              >
                {majorAllergens.map((allergen) => (
                  <option key={allergen}>{allergen}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Additional ingredient names, separated by commas</span>
              <input
                maxLength={400}
                value={aliases}
                onChange={(event) => setAliases(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Save suggestion names
            </button>
          </details>
        </>
      )}
      <p role="status">{notice}</p>
    </details>
  )
}
