import {
  convert,
  effectiveProductionSupplies,
  isProductionSupply,
  money,
  type Item,
} from '@/lib/domain'
import { precise } from '@/lib/ingredients'

export function ProductionSupplies({
  recipe,
  items,
  change,
  recipes,
}: {
  recipe: Item
  recipes?: Item[]
  items: Item[]
  change?: (lines: Item[]) => void
}) {
  const available = items.filter(isProductionSupply)
  const own: Item[] = recipe.productionSupplies || []
  let lines = own
  try {
    lines = effectiveProductionSupplies(recipe, recipes)
  } catch {
    /* Cost summary reports missing base. */
  }
  const update = (index: number, patch: Record<string, unknown>) =>
    change?.(own.map((line, n) => (n === index ? { ...line, ...patch } : line)))
  return (
    <section className="production-supplies">
      <div className="form-section-title">
        <h3>Production supplies</h3>
        {change && (
          <button
            type="button"
            className="text-button"
            disabled={!available.length}
            onClick={() =>
              change([
                ...own,
                {
                  id: '',
                  name: available[0].name,
                  ingredientId: available[0].id,
                  quantity: 1,
                  unit: available[0].unit,
                },
              ])
            }
          >
            Add production supply
          </button>
        )}
      </div>
      <p className="form-hint">
        Non-edible consumables used per recipe batch. Packaging added per
        sellable package stays separate. Do not also include this same usage in
        overhead. Normal discarded liners are already included here.
      </p>
      {!available.length && change && (
        <p>
          Add a supply under Supplies before selecting it here. Existing
          packaging and materials are also available; no records are
          reclassified.
        </p>
      )}
      {!lines.length && <p className="form-hint">No production supplies.</p>}
      {change && lines.length > own.length && (
        <p className="form-hint">
          Included from the base recipe:{' '}
          {lines
            .slice(0, lines.length - own.length)
            .map(
              (line) =>
                `${items.find((item) => item.id === line.ingredientId)?.name || 'Unavailable supply'} · ${line.quantity} ${line.unit}`,
            )
            .join('; ')}
          . Edit the base recipe to change this usage.
        </p>
      )}
      {(change ? own : lines).map((line, index) => {
        const item = items.find((i) => i.id === line.ingredientId)
        let extension: number | undefined
        const cost = item?.currentCost ?? item?.cost
        try {
          if (
            item &&
            !item.needsCostSetup &&
            cost != null &&
            cost !== '' &&
            Number.isFinite(Number(cost))
          )
            extension =
              convert(line.quantity, line.unit, item.unit, item.conversions) *
              Number(cost)
        } catch {
          /* Unknown conversion is not zero. */
        }
        return (
          <div className="production-supply-line" key={index}>
            {change ? (
              <>
                <label className="field">
                  <span>Supply item</span>
                  <select
                    value={line.ingredientId}
                    onChange={(e) => {
                      const item = items.find((i) => i.id === e.target.value)!
                      update(index, { ingredientId: item.id, unit: item.unit })
                    }}
                  >
                    <option value="">Choose supply</option>
                    {available.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Quantity per batch</span>
                  <input
                    type="number"
                    min="0.000001"
                    step="any"
                    value={line.quantity}
                    onChange={(e) =>
                      update(index, { quantity: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Unit per batch</span>
                  <input
                    value={line.unit}
                    onChange={(e) => update(index, { unit: e.target.value })}
                  />
                </label>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => change(own.filter((_, n) => n !== index))}
                >
                  Remove supply
                </button>
              </>
            ) : (
              <strong>
                {item?.name || 'Unavailable supply'} · {line.quantity}{' '}
                {line.unit} per batch
              </strong>
            )}
            <p className="form-hint">
              {extension === undefined
                ? 'Cost unavailable — review supply cost and unit conversion.'
                : `Unit cost: ${precise(Number(cost))} per ${item?.unit} · Batch: ${money(extension)} · Per ${recipe.yieldUnit || 'yield unit'}: ${precise(extension / Number(recipe.yield))}`}
            </p>
          </div>
        )
      })}
    </section>
  )
}
