import type { Item, Workspace } from './domain'
import { productionRunLines } from './production-run'

export const activeProduction = (run: Item) =>
  !['canceled', 'cancelled'].includes(run.status)

export function productionOrderInvoices(state: Workspace) {
  return (state.finance_transactions || []).filter(
    (record) => record.kind === 'invoice',
  )
}

export function basketAssignments(
  line: Item,
): { runId: string; quantity: number }[] {
  return line.basketAssignments || []
}

export function activeBasketAssignments(line: Item, state: Workspace) {
  return basketAssignments(line).filter((entry) => {
    const target = state.batches.find((run) => run.id === entry.runId)
    return target && activeProduction(target)
  })
}

export function marketOutput(
  run: Item,
  line: Item,
  eventId: string,
  state: Workspace,
) {
  const explicit = (state.event_batch_links || [])
    .filter((link) => link.recordId === run.id)
    .flatMap((link) =>
      (link.allocations || [])
        .filter(
          (entry: Item) =>
            entry.lineId === line.id && entry.productId === line.productId,
        )
        .map((entry: Item) => ({
          eventId: link.eventId,
          quantity: Number(entry.quantity),
        })),
    )
  const assigned = activeBasketAssignments(line, state)
  const reserved =
    assigned.reduce((sum, entry) => sum + entry.quantity, 0) +
    explicit.reduce((sum, entry) => sum + entry.quantity, 0)
  const planned = Number(line.quantity || 0)
  const actual =
    run.status === 'completed'
      ? Number(line.actualYield ?? line.output ?? 0)
      : 0
  const allocated = explicit.reduce(
    (sum, entry) => sum + (entry.eventId === eventId ? entry.quantity : 0),
    0,
  )
  const allocations = [
    ...assigned.map((entry) => ({
      eventId: state.batches.find((basket) => basket.id === entry.runId)
        ?.eventId,
      quantity: entry.quantity,
    })),
    ...explicit,
  ]
  let remaining = actual
  let assignedOutput = 0
  for (const entry of allocations) {
    const filled = Math.min(remaining, entry.quantity)
    remaining -= filled
    if (entry.eventId === eventId) assignedOutput += filled
  }
  const basketDemand = allocations
    .slice(0, assigned.length)
    .reduce(
      (sum, entry) => sum + (entry.eventId === eventId ? entry.quantity : 0),
      0,
    )
  return {
    planned:
      allocated +
      basketDemand +
      (run.eventId === eventId ? Math.max(0, planned - reserved) : 0),
    completed:
      assignedOutput +
      (run.eventId === eventId && planned > reserved
        ? Math.min(remaining, planned - reserved)
        : 0),
    forBaskets: basketDemand,
  }
}

export function eligibleBasketRuns(
  state: Workspace,
  productId: string,
  sourceId: string,
) {
  return state.batches.filter(
    (run) =>
      run.id !== sourceId &&
      activeProduction(run) &&
      run.status !== 'completed' &&
      productionRunLines(run).some((line) =>
        line.definition?.components?.some(
          (component: Item) => component.productId === productId,
        ),
      ),
  )
}

export function validateBasketAssignments(
  input: Item,
  quantity: number,
  sourceId: string,
  state: Workspace,
) {
  const raw = input.basketAssignments ?? []
  if (!Array.isArray(raw) || raw.length > 100)
    throw new Error('Choose valid basket destinations.')
  const targets = eligibleBasketRuns(state, input.productId, sourceId)
  const seen = new Set<string>()
  const validated = raw.map((entry) => {
    const count = Number(entry?.quantity)
    const prior = productionRunLines(
      state.batches.find((run) => run.id === sourceId),
    ).find((line) => line.id === input.id && line.productId === input.productId)
    const wasAssigned =
      prior &&
      basketAssignments(prior).some(
        (allocation) =>
          allocation.runId === entry?.runId && allocation.quantity === count,
      )
    if (
      (!targets.some((run) => run.id === entry?.runId) && !wasAssigned) ||
      seen.has(entry.runId) ||
      !Number.isSafeInteger(count) ||
      count < 1
    )
      throw new Error(
        'Choose each matching basket run once, with a positive whole package quantity.',
      )
    seen.add(entry.runId)
    const previousTarget = targets.find((run) => run.id === entry.runId)
    const managed = productionRunLines(previousTarget).find((line) => line.basketPlan)
    if (managed && !wasAssigned) {
      const component = managed.definition.components.find((item: Item) => item.productId === input.productId)
      const other = state.batches.filter((run) => activeProduction(run)).flatMap((run) => productionRunLines(run).flatMap((line) => {
        if ((run.id === sourceId && line.id === input.id) || line.productId !== input.productId) return []
        const allocations = activeBasketAssignments(line, state)
        const index = allocations.findIndex((entry) => entry.runId === previousTarget!.id)
        if (index < 0) return []
        const assignment = allocations[index].quantity
        const preceding = allocations.slice(0, index).reduce((sum, entry) => sum + entry.quantity, 0)
        return [run.status === 'completed' ? Math.min(assignment, Math.max(0, Number(line.actualYield ?? line.output ?? 0) - preceding)) : assignment]
      })).reduce((sum, value) => sum + value, 0)
      if (!component || other + count + Number(managed.basketPlan[input.productId]?.stock || 0) > Number(component.quantity) * Number(managed.quantity))
        throw new Error(`${managed.name}: assignments exceed unmet basket demand.`)
    }
    return { runId: entry.runId as string, quantity: count }
  })
  const marketQuantity = (state.event_batch_links || [])
    .filter((link) => link.recordId === sourceId)
    .flatMap((link) => link.allocations || [])
    .reduce(
      (sum, entry) =>
        sum + (entry.lineId === input.id ? Number(entry.quantity) : 0),
      0,
    )
  if (
    validated.reduce((sum, entry) => sum + (state.batches.some((run) => run.id === entry.runId && activeProduction(run)) ? entry.quantity : 0), marketQuantity) >
    quantity + 1e-8
  )
    throw new Error(
      'Market and basket assignments exceed planned packages. Reduce the assignments first.',
    )
  return validated
}
