import type { Item, Workspace } from '@/lib/domain'
import { inventoryQuantity } from '@/lib/inventory-quantity'
import { basketChecklist } from '@/lib/production-checklist'
import { activeProduction, marketOutput } from '@/lib/production-destinations'
import {
  combinedProductionRequirements,
  productionRunLines,
} from '@/lib/production-run'

export function ProductionMarketSummary({
  event,
  state,
}: {
  event: Item
  state: Workspace
}) {
  const totals = new Map<
    string,
    {
      name: string
      planned: number
      completed: number
      forBaskets: number
      basketNeed: number
    }
  >()
  const get = (id: string, name: string) => {
    const row = totals.get(id) || {
      name,
      planned: 0,
      completed: 0,
      forBaskets: 0,
      basketNeed: 0,
    }
    totals.set(id, row)
    return row
  }
  const outstanding: Item[] = []
  for (const run of state.batches.filter(activeProduction)) {
    const modern = productionRunLines(run)
    for (const line of modern.length ? modern : [run]) {
      const output = marketOutput(run, line, event.id, state)
      if (output.planned <= 0) continue
      const row = get(
        line.productId || line.recipeId || line.id,
        line.name || run.name,
      )
      row.planned += output.planned
      row.completed += output.completed
      row.forBaskets += output.forBaskets
      if (run.status === 'completed') continue
      if (modern.length)
        outstanding.push({
          ...line,
          quantity: output.planned,
          ...(output.planned < Number(line.quantity)
            ? {
                output: undefined,
                waste: 0,
                usage: {},
                materialWaste: {},
                laborMinutes: undefined,
              }
            : {}),
        })
      for (const part of basketChecklist(
        { ...line, quantity: output.planned },
        state,
        'reviewed',
      ).filter((part) => !part.supply)) {
        const demand = get(part.key.slice('product:'.length), part.name)
        demand.basketNeed += part.required
      }
    }
  }
  const calculation = combinedProductionRequirements(outstanding, state)
  const setup = [
    ...new Set(
      calculation.products
        .flatMap((line) => (line.error ? [line.error] : []))
        .concat(calculation.allocationIssues),
    ),
  ]
  const fmt = inventoryQuantity
  return (
    <section
      className="production-market-summary"
      aria-label={`${event.name} production plan`}
    >
      <div>
        <small>MARKET WORKSHEET</small>
        <h3>{event.name}</h3>
        <p>
          Consolidated by selling product. Basket assignments are part of the
          same output, not extra batches or reserved stock.
        </p>
      </div>
      {!totals.size ? (
        <p className="muted">
          No planned output is linked yet. Choose this market when saving a run,
          or allocate existing runs in Events.
        </p>
      ) : (
        <ul className="production-market-totals">
          {[...totals].map(([id, row]) => (
            <li key={id}>
              <strong>{row.name}</strong>
              {row.planned > 0 && (
                <span>
                  {fmt(row.planned)} planned · {fmt(row.completed)} completed ·{' '}
                  {fmt(Math.max(0, row.planned - row.completed))} remaining
                </span>
              )}
              {(row.basketNeed > 0 || row.forBaskets > 0) && (
                <small>
                  {fmt(row.basketNeed)} needed for open baskets ·{' '}
                  {fmt(row.forBaskets)} assigned from production
                </small>
              )}
            </li>
          ))}
        </ul>
      )}
      {!!(setup.length || calculation.shortages.length) && (
        <details open className="production-board-warning">
          <summary>Materials and finished components to review</summary>
          <ul>
            {calculation.shortages.map((entry) => (
              <li key={`${entry.kind}:${entry.itemId}:${entry.unit}`}>
                {entry.name}: {fmt(entry.quantity - entry.available)}{' '}
                {entry.unit} short ({fmt(entry.available)} on hand)
              </li>
            ))}
            {setup.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="button-row market-sheet-controls">
        <a href="#Production/Grocery%20%26%20Prep" className="btn secondary">Grocery &amp; Prep</a>
        <button type="button" className="btn secondary" onClick={() => {
          const root = document.documentElement
          root.classList.add('print-market-production')
          try { window.print() } finally { root.classList.remove('print-market-production') }
        }}>Print production checklist</button>
      </div>
    </section>
  )
}
