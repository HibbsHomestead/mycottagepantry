import {
  formatNetWeight,
  netWeightOunces,
  productNetWeight,
} from '@/lib/net-weight'
import type { Item } from '@/lib/domain'
import { useId } from 'react'

export function NetWeightField({
  value,
  onChange,
}: {
  value: Partial<Item>
  onChange: (key: string, value: string) => void
}) {
  const hintId = useId()
  const weight = productNetWeight(value)
  const inputValue =
    value.netWeightOz !== undefined
      ? (value.netWeightOz ?? '')
      : (weight.ounces ?? '')
  let preview = ''
  try {
    preview = formatNetWeight(inputValue)
  } catch {
    /* Native validity blocks saving. */
  }
  return (
    <label className="field">
      <span>Net weight (oz)</span>
      <input
        aria-label="Net weight (oz)"
        type="number"
        inputMode="decimal"
        min={Number.MIN_VALUE}
        step="any"
        data-field="netWeightOz"
        value={inputValue}
        aria-describedby={hintId}
        onChange={(event) => {
          try {
            netWeightOunces(event.target.value)
            event.target.setCustomValidity('')
          } catch (error) {
            event.target.setCustomValidity((error as Error).message)
          }
          onChange('netWeightOz', event.target.value)
        }}
      />
      <small id={hintId} className="form-hint" aria-live="polite">
        {preview || 'Optional · leave blank to omit the net-weight line.'}
      </small>
      {weight.review && (
        <small className="warning-text">
          {weight.review} Original: {value.netQuantity}
        </small>
      )}
    </label>
  )
}
