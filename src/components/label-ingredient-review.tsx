import { useState } from 'react'
import { allergens, type Item, type Workspace } from '@/lib/domain'
import {
  resolveLabelData,
  type LabelData,
  type LabelSource,
} from '@/lib/label-studio'
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

function IngredientSourceReview({
  item,
  mutate,
}: {
  item: Item
  mutate: ReviewMutation
}) {
  const [source, setSource] = useState(() => ({
    subingredients: String(item.subingredients || ''),
    sourceContains: String(item.sourceContains || ''),
    sourceMayContain: String(item.sourceMayContain || ''),
    reviewed: item.reviewed === true,
    allergens: (item.allergens || []) as string[],
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    setBusy(true)
    setError('')
    try {
      await mutate('ingredientAllergenSource', 'ingredients', {
        ...source,
        id: item.id,
        expectedUpdatedAt: item.updatedAt,
      })
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Ingredient source not saved.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="label-review-section">
      <summary>Edit allergen source for {item.name}</summary>
      <p>
        Copy the verified supplier wording, including any nested components.
        Leave unknown information unconfirmed.
      </p>
      <fieldset disabled={busy}>
        {(
          [
            ['subingredients', 'Supplier subingredients'],
            ['sourceContains', 'Supplier Contains statement'],
            ['sourceMayContain', 'Supplier May contain statement'],
          ] as const
        ).map(([key, label]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <textarea
              maxLength={key === 'subingredients' ? 8000 : 1000}
              value={source[key]}
              onChange={(event) =>
                setSource({
                  ...source,
                  [key]: event.target.value,
                  reviewed: false,
                })
              }
            />
          </label>
        ))}
        <fieldset>
          <legend>Allergens explicitly declared by this source</legend>
          <div className="allergen-options">
            {allergens.map((allergen) => (
              <label key={allergen}>
                <input
                  type="checkbox"
                  checked={source.allergens.includes(allergen)}
                  onChange={(event) =>
                    setSource({
                      ...source,
                      reviewed: false,
                      allergens: event.target.checked
                        ? [...source.allergens, allergen]
                        : source.allergens.filter((name) => name !== allergen),
                    })
                  }
                />
                {allergen}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={source.reviewed}
            onChange={(event) =>
              setSource({ ...source, reviewed: event.target.checked })
            }
          />{' '}
          I verified the ingredient and allergen information against the
          supplier source.
        </label>
        <button
          type="button"
          className="btn secondary"
          onClick={() => void save()}
        >
          Save ingredient source
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </details>
  )
}

export function LabelSourceAllergenReview({
  workspace,
  source,
  data = resolveLabelData(workspace, source),
  mutate,
  onOpenSource,
  actionLabel,
}: {
  workspace: Workspace
  source: LabelSource
  data?: LabelData
  mutate?: ReviewMutation
  onOpenSource?: (kind: string, item?: Item) => void
  actionLabel?: string
}) {
  const product = workspace.products.find(
    (entry) =>
      entry.id === (source.kind === 'product' ? source.id : source.productId),
  )
  const record =
    product ||
    (source.kind === 'batch' ? workspace.batches : workspace.ingredients).find(
      (entry) => entry.id === source.id,
    )
  const name = record
    ? [
        ...new Set(
          [record.name, record.flavor, record.variant].filter(Boolean),
        ),
      ].join(' · ')
    : 'Selected label source'
  const review = data.allergenReview
  const sourceIssues = data.warnings.filter((warning) =>
    /verify allergens|subingredients|manufacturer ingredient and allergen|allergen information not confirmed by the manufacturer/i.test(
      warning,
    ),
  )
  const productNeedsReview = review && review.status !== 'confirmed'
  const ingredientIds = new Set(
    sourceIssues.flatMap((warning) => {
      const issue = data.sourceRecords?.[warning]
      return issue?.kind === 'ingredient' ? [issue.id] : []
    }),
  )
  if (productNeedsReview)
    for (const id of data.declaredAllergenSourceIds || []) ingredientIds.add(id)
  const ingredients = workspace.ingredients.filter((entry) =>
    ingredientIds.has(entry.id),
  )
  const manufacturerNeedsReview =
    product?.workflow === 'resale' &&
    sourceIssues.some((warning) => /manufacturer/i.test(warning))
  const batchHasDifferentEvidence = Boolean(
    source.kind === 'batch' &&
    product &&
    review &&
    JSON.stringify(review.source) !==
      JSON.stringify(
        resolveLabelData(workspace, { kind: 'product', id: product.id })
          .allergenReview?.source,
      ),
  )
  if (data.nonFood || (!productNeedsReview && !sourceIssues.length)) return null
  const pending =
    review &&
    majorAllergens.filter(
      (name) =>
        !['present', 'absent'].includes(review.decisions[name]?.status || ''),
    )
  return (
    <section
      aria-label={`Allergen review for ${name}`}
      className="label-review-section"
    >
      <h4>{name}: allergen information needs review</h4>
      {review?.status === 'changed' && (
        <p>Source changes need confirmation: {review.changed.join('; ')}.</p>
      )}
      {productNeedsReview && !!pending?.length && (
        <p>Not confirmed: {pending.join(', ')}.</p>
      )}
      {!!review?.evidence.some(
        (entry) => entry.confidence === 'incomplete data',
      ) && (
        <ul aria-label="Incomplete allergen sources">
          {review.evidence
            .filter((entry) => entry.confidence === 'incomplete data')
            .map((entry) => (
              <li key={entry.path.join(' → ')}>
                {entry.path.join(' → ')}: source incomplete
              </li>
            ))}
        </ul>
      )}
      {!!sourceIssues.length && (
        <ul>
          {sourceIssues.map((warning) => (
            <li key={warning}>{warning.replace(/ \[[^\]]+\]$/, '')}</li>
          ))}
        </ul>
      )}
      {manufacturerNeedsReview && onOpenSource && product && (
        <button
          type="button"
          className="btn secondary"
          onClick={() => onOpenSource('trade-product-source', product)}
        >
          Review manufacturer allergen declaration
        </button>
      )}
      {productNeedsReview && product && !batchHasDifferentEvidence && (
        <ProductAllergenReview
          key={`${product.id}:${product.allergenReview?.reviewedAt || ''}:${JSON.stringify(review.source)}`}
          product={product}
          review={review}
          mutate={mutate}
          actionLabel={actionLabel || 'Review and confirm major allergens'}
        />
      )}
      {mutate &&
        ingredients.map((item) => (
          <IngredientSourceReview
            key={`${item.id}:${item.updatedAt || ''}`}
            item={item}
            mutate={mutate}
          />
        ))}
      {productNeedsReview && batchHasDifferentEvidence && (
        <p>
          The recorded batch ingredients differ from the current product source.
          A product review cannot confirm this batch’s declaration.
        </p>
      )}
      {productNeedsReview && !product && (
        <p>
          Choose a packaged product linked to this batch’s recipe, then review
          its allergens.
        </p>
      )}
    </section>
  )
}

export function ProductAllergenReview({
  review,
  product,
  mutate,
  actionLabel = 'Major allergen review',
}: {
  review: NonNullable<LabelData['allergenReview']>
  product: Item
  mutate?: ReviewMutation
  actionLabel?: string
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
        {actionLabel} ·{' '}
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
      {review.status === 'confirmed' && product.allergenReview?.reviewedAt && (
        <p>
          Confirmed{' '}
          {new Date(product.allergenReview.reviewedAt).toLocaleString()} against
          this source version.
        </p>
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
      {!mutate && (
        <ul aria-label="Major allergen states">
          {majorAllergens.map((allergen) => {
            const decision = decisions[allergen]?.status
            const state =
              decision === 'present'
                ? 'Confirmed present'
                : decision === 'absent'
                  ? 'Confirmed absent'
                  : decision === 'review'
                    ? 'Needs review'
                    : review.evidence.some(
                          (entry) => entry.allergen === allergen,
                        )
                      ? 'Suggested · not confirmed'
                      : 'Unknown'
            return (
              <li key={allergen}>
                {allergen}: {state}
              </li>
            )
          })}
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
