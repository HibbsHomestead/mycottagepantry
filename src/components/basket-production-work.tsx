import type { Item, Workspace } from '../lib/domain'
import { basketProduction } from '../lib/basket-production'
import {
  combinedProductionRequirements,
  productionRunLines,
} from '../lib/production-run'
import { activeBasketAssignments } from '../lib/production-destinations'

function assignableRuns(
  state: Workspace,
  productId: string,
  linked: Set<string>,
) {
  return state.batches
    .flatMap((run) => {
      if (
        !['draft', 'scheduled'].includes(run.status) ||
        run.orderId ||
        linked.has(run.id)
      )
        return []
      const market = (state.event_batch_links || [])
        .filter((link) => link.recordId === run.id)
        .flatMap((link) => link.allocations || [])
      const available = productionRunLines(run)
        .filter((line) => line.productId === productId)
        .reduce((total, line) => {
          const explicit = market
            .filter((entry) => entry.lineId === line.id)
            .reduce((sum, entry) => sum + Number(entry.quantity), 0)
          const assigned = activeBasketAssignments(line, state).reduce(
            (sum, entry) => sum + entry.quantity,
            0,
          )
          return (
            total + Math.max(0, Number(line.quantity) - explicit - assigned)
          )
        }, 0)
      return available > 0 ? [{ run, available }] : []
    })
    .slice(0, 5)
}

export function BasketProductionWork({
  line,
  state,
  parentId,
  open,
  change,
  disabled,
}: {
  line: Item
  state: Workspace
  parentId: string
  open?: (run: Item) => void
  change?: (plan: Item) => void
  disabled?: boolean
}) {
  const rows = basketProduction(line, state, parentId)
  if (!rows.length) return null
  const completed = state.batches.some(
    (run) => run.id === parentId && run.status === 'completed',
  )
  return (
    <section className="basket-work" aria-label="Basket component production">
      {change && (
        <p>
          Choose finished stock to use, or leave it at zero to make fresh. Stock
          is unreserved and rechecked before posting. Saving adds only uncovered
          work; existing runs are not resized or canceled.
        </p>
      )}
      {rows.map((row) => {
        const loose = row.component.basis === 'unpackaged'
        const units = loose ? `${row.component.contentUnit} units` : 'packages'
        const sources = row.sources.map((source) => ({
          ...source,
          shortages:
            source.run.status !== 'completed' && source.line.definition
              ? combinedProductionRequirements([source.line], state).shortages
              : [],
        }))
        const status = completed
          ? 'Recorded'
          : row.ready >= row.packingRequired
            ? 'Ready to pack'
            : row.resale
              ? 'Use stock / obtain stock'
              : row.setup
                ? 'Needs setup'
                : row.shortages.length ||
                    sources.some((source) => source.shortages.length)
                  ? 'Missing ingredients/materials'
                  : 'Needs production'
        return (
          <details key={row.component.productId}>
            <summary>
              {row.name} · {row.required} {units} · {status}
            </summary>
            <p>
              {row.component.quantity} per {loose ? 'mixed pack' : 'basket'} · {row.required} required
              {!completed &&
                ` · ${row.eligible} eligible of ${row.stock} on hand (unreserved)`}
              .
            </p>
            {row.item && !loose && (
              <p>
                {[
                  row.item.sku,
                  row.item.unitsPerPackage &&
                    `${row.item.unitsPerPackage} ${row.item.contentUnit || 'units'} per selling package`,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Selling package'}
              </p>
            )}
            <p>
              {row.allocated} allocated from finished stock · {row.pending}{' '}
              linked to open runs · {row.posted} posted by linked runs
              {!completed && ` · ${row.unplanned} not yet planned or covered`}.
            </p>
            {!completed && (
              <p>
                {row.ready} of {row.packingRequired} {units} ready for the
                current packing count.
              </p>
            )}
            {change && !completed && (
              <div className="form-grid">
                <label>
                  {loose ? 'Unpackaged units to use from stock' : 'Packages to use from stock'}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={row.choice.stock ?? 0}
                    disabled={disabled}
                    onChange={(event) =>
                      change({
                        ...line.basketPlan,
                        [row.component.productId]: {
                          ...row.choice,
                          stock: event.target.value,
                        },
                      } as Item)
                    }
                  />
                </label>
                {!row.resale && row.item?.recipeId && (
                  <label className="basket-work-choice">
                    <input
                      type="checkbox"
                      checked={!!row.choice.wholeBatch}
                      disabled={disabled || !!row.choice.useExistingRun}
                      onChange={(event) =>
                        change({
                          ...line.basketPlan,
                          [row.component.productId]: {
                            ...row.choice,
                            wholeBatch: event.target.checked,
                          },
                        } as Item)
                      }
                    />
                    Round up to whole recipe batches
                  </label>
                )}
                {!row.resale && (
                  <label className="basket-work-choice">
                    <input
                      type="checkbox"
                      checked={!!row.choice.useExistingRun}
                      disabled={disabled}
                      onChange={(event) =>
                        change({
                          ...line.basketPlan,
                          [row.component.productId]: {
                            ...row.choice,
                            useExistingRun: event.target.checked,
                          },
                        } as Item)
                      }
                    />
                    Assign from an existing run instead of creating a fresh run
                  </label>
                )}
              </div>
            )}
            {!completed && row.setup && (
              <p className="warning-text">{row.setup}</p>
            )}
            {!completed && !!row.shortages.length && (
              <ul>
                {row.shortages.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            {!completed && row.candidate && !row.choice.useExistingRun && (
              <p>
                {change ? 'New run preview' : 'Unplanned production'}:{' '}
                {row.candidate.quantity} {units} · {row.unplanned} for this plan
                {row.candidate.quantity > row.unplanned &&
                  ` · ${row.candidate.quantity - row.unplanned} extra, left unallocated`}
                .
              </p>
            )}
            {!completed && row.choice.useExistingRun && row.unplanned > 0 && (
              <div>
                <p>
                  {row.unplanned} packages still to assign. Open an existing
                  batch and use “Assign output to basket runs.”
                </p>
                {open &&
                  assignableRuns(
                    state,
                    row.component.productId,
                    new Set(row.sources.map((source) => source.run.id)),
                  ).map(({ run, available }) => (
                    <button
                      key={run.id}
                      type="button"
                      className="btn secondary"
                      disabled={disabled}
                      onClick={() => open(run)}
                    >
                      {run.name}: {available} packages assignable
                    </button>
                  ))}
              </div>
            )}
            {!completed && row.pending + row.posted > row.required && (
              <p>
                Linked work exceeds current demand by{' '}
                {row.pending + row.posted - row.required} packages. Review the
                source runs; their quantities and history are unchanged.
              </p>
            )}
            {sources.map(
              ({ run, line: output, assigned, posted, shortages }) => (
                <div
                  className="basket-work-source"
                  key={`${run.id}:${output.id}`}
                >
                  <p>
                    {run.name} · {assigned} assigned of {output.quantity}{' '}
                    planned
                    {run.status === 'completed'
                      ? ` · ${posted} credited from ${output.actualYield ?? output.output ?? 0} posted`
                      : ''}
                    .
                  </p>
                  {shortages.map((entry) => (
                    <p className="warning-text" key={entry.id}>
                      Missing{' '}
                      {Number((entry.quantity - entry.available).toFixed(6))}{' '}
                      {entry.unit} {entry.name}.
                    </p>
                  ))}
                  {open && (
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={disabled}
                      onClick={() => open(run)}
                    >
                      {run.status === 'completed'
                        ? 'View posted output'
                        : 'Open component run'}
                    </button>
                  )}
                </div>
              ),
            )}
          </details>
        )
      })}
    </section>
  )
}
