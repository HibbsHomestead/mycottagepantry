import { useRef, useState } from 'react'
import { importLabels, ReviewText } from './product-link-import'
import {
  ingredientImportFields,
  importValuePresent,
  type ImportFields,
} from '@/lib/ingredient-import-draft'
import { foodProduct } from '@/lib/inventory-product'
import type { Item } from '@/lib/domain'

export type ReviewCandidate = {
  field: string
  value: string | number
  uncertain?: boolean
  evidence?: string
  photoId?: string
}
/** The same compact checklist pattern as URL import, with no auto-fill path. */
export function DraftFieldReview({
  draft,
  fields,
  candidates,
  packageSetup = false,
  apply,
  onApplied,
  source,
}: {
  draft: Record<string, Item[string]>
  fields?: ImportFields
  candidates?: ReviewCandidate[]
  packageSetup?: boolean
  apply: (patch: Record<string, Item[string]>, accepted: string[]) => void
  onApplied?: () => void
  source: string
}) {
  const raw: ReviewCandidate[] =
    candidates ||
    Object.entries(fields || {}).map(([field, value]) => ({ field, value }))
  const groups: {
    id: string
    patch: ImportFields
    label: string
    uncertain: boolean
    evidence: string
    originalKeys: string[]
  }[] = []
  const food = foodProduct(draft)
  const quantity = raw.filter((c) =>
    ['purchaseQuantity', 'purchaseUnit'].includes(c.field),
  )
  for (const [index, c] of raw.entries()) {
    if (
      !food &&
      ['subingredients', 'sourceContains', 'sourceMayContain'].includes(c.field)
    )
      continue
    if (['purchaseQuantity', 'purchaseUnit'].includes(c.field)) continue
    const patch = { [c.field]: c.value }
    groups.push({
      id: String(index),
      patch,
      label: importLabels[c.field] || c.field,
      uncertain: !!c.uncertain,
      evidence: c.evidence || '',
      originalKeys: [c.field],
    })
  }
  const amounts = quantity.filter((c) => c.field === 'purchaseQuantity'),
    units = quantity.filter((c) => c.field === 'purchaseUnit')
  for (const [i, q] of amounts.entries()) {
    const fromSamePhoto = units.filter((u) => u.photoId === q.photoId)
    const matches = fromSamePhoto.length
      ? fromSamePhoto
      : units.length === 1
        ? units
        : []
    for (const [j, u] of matches.entries()) {
      const patch = ingredientImportFields(
        { purchaseQuantity: q.value, purchaseUnit: u.value },
        draft,
        packageSetup,
      )
      if (!Object.keys(patch).length) continue
      groups.push({
        id: `package:${i}:${j}`,
        patch,
        label: 'Package contents',
        uncertain: !!q.uncertain || !!u.uncertain,
        evidence: [q.evidence, u.evidence].filter(Boolean).join(' · '),
        originalKeys: ['purchaseQuantity', 'purchaseUnit'],
      })
    }
  }
  const conflicts = (g: (typeof groups)[number]) =>
    Object.entries(g.patch).some(
      ([k, v]) =>
        importValuePresent(draft[k]) && String(draft[k]) !== String(v),
    )
  const ambiguous = (g: (typeof groups)[number]) =>
    groups.some(
      (other) =>
        other.id !== g.id &&
        Object.keys(other.patch).some(
          (k) => k in g.patch && String(other.patch[k]) !== String(g.patch[k]),
        ),
    )
  const safe = (g: (typeof groups)[number]) =>
    !g.uncertain && !ambiguous(g) && !conflicts(g)
  const [selected, setSelected] = useState(() =>
    groups.filter(safe).map((g) => g.id),
  )
  const approvals = useRef(
    Object.fromEntries(
      groups.map((g) => [
        g.id,
        Object.fromEntries(Object.keys(g.patch).map((k) => [k, draft[k]])),
      ]),
    ),
  )
  const [message, setMessage] = useState('')
  const keys = (g: (typeof groups)[number]) => Object.keys(g.patch)
  function choose(id: string, on: boolean) {
    const g = groups.find((g) => g.id === id)!
    approvals.current[id] = Object.fromEntries(
      keys(g).map((k) => [k, draft[k]]),
    )
    setSelected((old) =>
      on
        ? [
            ...old.filter(
              (other) =>
                !groups
                  .find((v) => v.id === other)
                  ?.originalKeys.some((k) => g.originalKeys.includes(k)),
            ),
            id,
          ]
        : old.filter((v) => v !== id),
    )
  }
  return (
    <section className="draft-field-review" aria-label="Review imported fields">
      <p className="form-hint">
        {source}. Apply changes to this draft, then save when ready. Missing
        allergen information is unknown.
      </p>
      <div className="button-row">
        <button
          type="button"
          className="text-button"
          onClick={() => {
            const usable = groups.filter(safe)
            for (const g of usable)
              approvals.current[g.id] = Object.fromEntries(
                keys(g).map((k) => [k, draft[k]]),
              )
            setSelected(usable.map((g) => g.id))
          }}
        >
          Select all
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => setSelected([])}
        >
          Clear
        </button>
      </div>
      {groups.map((g) => (
        <label className="draft-review-row" key={g.id}>
          <input
            type="checkbox"
            checked={selected.includes(g.id)}
            onChange={(e) => choose(g.id, e.target.checked)}
          />
          <span>
            <strong>{g.label}: </strong>
            <ReviewText
              text={Object.entries(g.patch)
                .map(([, v]) => String(v))
                .join(' ')}
            />
            {(g.uncertain || ambiguous(g)) && (
              <small>
                Needs review
                {ambiguous(g)
                  ? ' — conflicting alternatives; choose one.'
                  : ' — uncertain text; check the photo.'}
              </small>
            )}
            {conflicts(g) && (
              <small>
                Current:{' '}
                <ReviewText
                  text={keys(g)
                    .map((k) => String(draft[k] ?? ''))
                    .join(' ')}
                />{' '}
                · Select this field to approve replacement.
              </small>
            )}
            {g.evidence && (
              <small>
                <ReviewText text={g.evidence} />
              </small>
            )}
          </span>
        </label>
      ))}
      {message && <p role="alert">{message}</p>}
      <button
        type="button"
        className="btn secondary"
        disabled={!selected.length}
        onClick={() => {
          const chosen = groups.filter((g) => selected.includes(g.id))
          if (
            chosen.some((g) =>
              keys(g).some(
                (k) =>
                  String(draft[k] ?? '') !==
                  String(approvals.current[g.id]?.[k] ?? ''),
              ),
            )
          ) {
            setMessage(
              'A manual value changed during review. Your edits are preserved. Recheck the affected fields before applying.',
            )
            setSelected([])
            return
          }
          const patch = Object.assign({}, ...chosen.map((g) => g.patch))
          // Statements always return the allergen review to an unreviewed state.
          if (
            ['subingredients', 'sourceContains', 'sourceMayContain'].some(
              (k) => k in patch,
            )
          )
            patch.reviewed = false
          apply(patch, [...new Set(chosen.flatMap((g) => g.originalKeys))])
          onApplied?.()
        }}
      >
        Apply selected values
      </button>
    </section>
  )
}
