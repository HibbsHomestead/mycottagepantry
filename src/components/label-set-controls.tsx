import { memo, useEffect, useMemo, useState } from 'react'
import { FormErrorNotice } from './form-error-notice'
import type { Item } from '@/lib/domain'
import type { LabelData, LabelDocument } from '@/lib/label-studio'
import {
  labelSetPlan,
  labelSide,
  labelSides,
  type LabelOrder,
  type LabelParts,
  type LabelSide,
} from '@/lib/label-sets'
import { LabelCanvas } from './label-canvas'

/** Small, read-only live thumbnails; debounce geometry changes during gestures. */
export const LabelSideNavigation = memo(function LabelSideNavigation({
  document,
  data,
  assets,
  active,
  onSelect,
}: {
  document: LabelDocument
  data: LabelData
  assets: Item[]
  active: LabelSide
  onSelect: (side: LabelSide) => void
}) {
  const [snapshot, setSnapshot] = useState({ document, data, assets })
  const preview = snapshot.document
  useEffect(() => {
    const timer = window.setTimeout(
      () => setSnapshot({ document, data, assets }),
      120,
    )
    return () => window.clearTimeout(timer)
  }, [document, data, assets])
  const artwork = useMemo(
    () =>
      Object.fromEntries(
        labelSides(preview).map((side) => [
          side,
          <LabelCanvas
            document={labelSide(preview, side)}
            data={snapshot.data}
            assets={snapshot.assets}
          />,
        ]),
      ),
    [snapshot],
  )
  return (
    <div
      className="studio-side-navigation"
      role="group"
      aria-label="Label side"
    >
      {labelSides(document).map((side) => {
        const layout = labelSide(
          preview,
          side === 'back' && !preview.back ? 'front' : side,
        )
        const current = labelSide(document, side)
        const name = side === 'front' ? 'Front' : 'Back'
        return (
          <button
            type="button"
            key={side}
            aria-label={name}
            aria-pressed={active === side}
            onClick={() => onSelect(side)}
          >
            <strong>{name}</strong>
            <span
              className="studio-side-art"
              aria-hidden="true"
              style={{
                aspectRatio: `${layout.width}/${layout.height}`,
                maxWidth: `${(120 * layout.width) / layout.height}px`,
              }}
            >
              {artwork[side] || null}
            </span>
            <small>
              {(current.width / 72).toFixed(2)} ×{' '}
              {(current.height / 72).toFixed(2)} in
            </small>
          </button>
        )
      })}
    </div>
  )
})

export function PairedLabelPreview({
  document,
  data,
  assets,
  maxHeight,
}: {
  document: LabelDocument
  data: LabelData
  assets: Item[]
  maxHeight?: number
}) {
  return (
    <div className="label-set-preview">
      {labelSides(document).map((side) => {
        const d = labelSide(document, side)
        return (
          <figure key={side}>
            <figcaption>
              {side === 'front' ? 'Front' : 'Back'} ·{' '}
              {(d.width / 72).toFixed(2)} × {(d.height / 72).toFixed(2)} in
            </figcaption>
            <div
              style={{
                aspectRatio: `${d.width}/${d.height}`,
                maxWidth: maxHeight
                  ? (maxHeight * d.width) / d.height
                  : undefined,
              }}
            >
              <LabelCanvas document={d} data={data} assets={assets} />
            </div>
            {!d.elements.some((e) => !e.hidden) && (
              <small role="status">
                Blank {side} — add content before printing complete sets.
              </small>
            )}
          </figure>
        )
      })}
    </div>
  )
}
export function LabelSetControls({
  document,
  products,
  parts,
  setParts,
  order,
  setOrder,
  runIndex,
  setRunIndex,
}: {
  document: LabelDocument
  products: number
  parts: LabelParts
  setParts: (v: LabelParts) => void
  order: LabelOrder
  setOrder: (v: LabelOrder) => void
  runIndex: number
  setRunIndex: (v: number) => void
}) {
  if (document.format !== 'front-back') return null
  let plan
  let error = ''
  try {
    plan = labelSetPlan(document, products, parts, order)
  } catch (failure) {
    error = (failure as Error).message
  }
  return (
    <div className="label-set-controls">
      <label className="studio-field">
        <span>Labels to print</span>
        <select
          value={parts}
          onChange={(e) => setParts(e.target.value as LabelParts)}
        >
          <option value="both">Complete sets · Front + Back</option>
          <option value="front">Front only · replacements</option>
          <option value="back">Back only · replacements</option>
        </select>
      </label>
      <label className="studio-field">
        <span>Print order</span>
        <select
          value={order}
          disabled={plan?.differentStock || parts !== 'both'}
          onChange={(e) => setOrder(e.target.value as LabelOrder)}
        >
          <option value="grouped">Grouped · all Front, then all Back</option>
          <option value="paired">Paired · Front, Back, Front, Back</option>
        </select>
      </label>
      <p role="status">
        {products} products = {parts !== 'back' ? `${products} Front` : ''}
        {parts === 'both' ? ' + ' : ''}
        {parts !== 'front' ? `${products} Back` : ''} ={' '}
        {products * (parts === 'both' ? 2 : 1)} individual labels.
      </p>
      {plan?.differentStock && (
        <>
          <p>
            Different stock sizes require separate runs. Load the stated stock
            and submit each run separately at 100% size.
          </p>
          <label className="studio-field">
            <span>Print run / stock</span>
            <select
              value={runIndex}
              onChange={(e) => setRunIndex(Number(e.target.value))}
            >
              {plan.runs.map((run, i) => (
                <option key={i} value={i}>
                  {run.name} · {run.sequence.length} copies ·{' '}
                  {(run.document.width / 72).toFixed(2)} ×{' '}
                  {(run.document.height / 72).toFixed(2)} in
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <small>
        Two separate stickers per product. Browser printing cannot change loaded
        stock or confirm physical output.
      </small>
      {error && <FormErrorNotice message={error} />}
    </div>
  )
}
