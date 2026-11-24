import { useState } from 'react'
import { type Item } from '@/lib/domain'
import { inventoryQuantity } from '@/lib/inventory-quantity'
import {
  preparedLabel,
  preparedMeasureUnit,
  preparedRequirement,
  type PreparedRequirement,
} from '@/lib/prepared-requirement'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/dialog'

export function PreparedStockPicker({
  items,
  lots,
  close,
  select,
}: {
  items: Item[]
  lots: Item[]
  close: () => void
  select: (line: Item) => void
}) {
  const [query, setQuery] = useState('')
  const rows = lots.flatMap<{
    lot: Item
    item: Item
    prepared?: PreparedRequirement
    error: string
  }>((lot) => {
    const item = items.find(
      (entry) => entry.id === lot.ingredientId && !entry.archived,
    )
    if (
      !item ||
      lot.kind !== 'ingredient_prep' ||
      lot.reversedAt ||
      !(lot.quantity > 0)
    )
      return []
    if (
      ![item.name, lot.method, lot.location]
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    )
      return []
    try {
      const prepared = preparedRequirement(item, lot)
      return [{ lot, item, prepared, error: '' }]
    } catch (error) {
      return [
        { lot, item, prepared: undefined, error: (error as Error).message },
      ]
    }
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="app-dialog">
        <DialogTitle>Choose prepared stock</DialogTitle>
        <DialogDescription>
          Use portioned inventory, not a purchased ingredient or a compound
          recipe. Pick the actual lot during production.
        </DialogDescription>
        <label className="field">
          <span>Search prepared stock</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="component-search-results prepared-stock-choices">
          {!rows.length && (
            <p>
              No matching prepared stock. Use Prep / Portion Stock on an
              inventory item to prepare more.
            </p>
          )}
          {rows.map(({ lot, item, prepared, error }) =>
            prepared ? (
              <button
                type="button"
                className="btn secondary"
                key={lot.id}
                onClick={() =>
                  select({
                    id: '',
                    name: item.name,
                    ingredientId: item.id,
                    quantity: prepared.perPortion,
                    unit: prepared.outputUnit,
                    prepared,
                  })
                }
              >
                <span>
                  {preparedLabel(item, prepared)} · {lot.location}
                </span>
                <small>
                  {inventoryQuantity(
                    lot.quantity / (lot.usable / lot.portions),
                  )}{' '}
                  portion equivalents available ·{' '}
                  {inventoryQuantity(lot.quantity)}{' '}
                  {preparedMeasureUnit(lot.unit)} in inventory
                </small>
                {lot.note && <small>{lot.note}</small>}
              </button>
            ) : (
              <p key={lot.id} className="warning-text">
                {error}
              </p>
            ),
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function PreparedPortionQuantity({
  line,
  change,
}: {
  line: Item
  change: (quantity: number | string) => void
}) {
  const perPortion = Number(line.prepared.perPortion)
  return (
    <label className="field prepared-portion-quantity">
      <span>Portions per batch</span>
      <input
        type="number"
        min="0.000001"
        step="any"
        value={
          line.quantity === ''
            ? ''
            : Number((Number(line.quantity) / perPortion).toPrecision(12))
        }
        onChange={(event) =>
          change(
            event.target.value === ''
              ? ''
              : Number(
                  (Number(event.target.value) * perPortion).toPrecision(12),
                ),
          )
        }
      />
      <small>
        {inventoryQuantity(line.quantity)} {preparedMeasureUnit(line.unit)}{' '}
        measured total
      </small>
    </label>
  )
}
