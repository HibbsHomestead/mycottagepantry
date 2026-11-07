import { Package } from 'lucide-react'
import { convert, type Item } from '@/lib/domain'
import { precise } from '@/lib/ingredients'
import {
  inventoryAdjustmentPlan,
  type InventoryAdjustmentInput,
} from '@/lib/inventory-adjustment'
import type { ReactNode } from 'react'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function IngredientStockAdjustment({
  item,
  draft,
  change,
}: {
  item: Item
  draft: InventoryAdjustmentInput & { type?: string; reason?: string }
  change: (key: string, value: string) => void
}) {
  const unit = item.storageUnit || item.unit
  const total = draft.adjustmentMode === 'total'
  let current = 'Balance unavailable'
  let preview = ''
  let error = ''
  try {
    if (
      item.quantity == null ||
      item.quantity === '' ||
      !Number.isFinite(Number(item.quantity))
    )
      throw new Error(
        'The current stock balance is unavailable. Refresh before adjusting.',
      )
    current = `${precise(convert(item.quantity, item.unit, unit, item.conversions))} ${unit} on hand`
    if (draft.quantity !== '' && draft.quantity != null) {
      const plan = inventoryAdjustmentPlan(item, { ...draft, unit })
      preview = `Resulting balance: ${precise(plan.resultingInventoryQuantity)} ${unit} (${precise(plan.inventoryQuantity)} ${unit} change).`
    }
  } catch (e) {
    error = (e as Error).message
  }
  return (
    <>
      <div className="selected-item">
        <Package size={24} />
        <span>
          <strong>{item.name}</strong>
          <small>{current}</small>
        </span>
      </div>
      <Field label="Adjustment method">
        <select
          value={draft.adjustmentMode || 'change'}
          onChange={(e) => {
            change('adjustmentMode', e.target.value)
            change('quantity', '')
            if (e.target.value === 'total') change('type', 'adjustment')
          }}
        >
          <option value="change">Add / remove a quantity</option>
          <option value="total">Opening count / set total balance</option>
        </select>
      </Field>
      <Field
        label={`${total ? 'Total on hand' : 'Quantity change'} (${unit})`}
        hint={
          total
            ? 'Sets the entire balance to this count. It does not add the count to existing stock.'
            : 'Adds to the current balance. Use a negative number to remove stock, e.g. -0.5. For an opening count, choose set total balance.'
        }
      >
        <input
          type="number"
          step="any"
          min={total ? 0 : undefined}
          required
          value={String(draft.quantity ?? '')}
          onChange={(e) => change('quantity', e.target.value)}
        />
      </Field>
      {preview && (
        <p className="calculation-box" aria-live="polite">
          {preview}
        </p>
      )}
      {error && (
        <p className="warning-text" role="alert">
          {error}
        </p>
      )}
      <Field label="Adjustment type">
        <select
          value={draft.type || 'adjustment'}
          disabled={total}
          onChange={(e) => change('type', e.target.value)}
        >
          <option value="adjustment">adjustment</option>
          <option value="waste">waste</option>
          <option value="spoilage">spoilage</option>
        </select>
      </Field>
      <Field label="Reason (required)">
        <textarea
          required
          value={draft.reason || ''}
          onChange={(e) => change('reason', e.target.value)}
          placeholder="What happened?"
        />
      </Field>
    </>
  )
}
