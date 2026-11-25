import type { Item, Workspace } from './domain'
import { productionDefinition } from './production'
import {
  activeBasketAssignments,
  activeProduction,
  marketOutput,
} from './production-destinations'
import {
  combinedProductionRequirements,
  productionRunLines,
} from './production-run'
import { workflowOf } from './product-workflows'

function productionWasReversed(state: Workspace, run: Item, line: Item) {
  return state.ledger?.some(
    (entry) =>
      entry.type === 'production_reversal' &&
      entry.batchId === run.id &&
      entry.productionLineId === line.id,
  )
}

export function finishedBasketClaims(
  state: Workspace,
  productId: string,
  except: string,
) {
  const openBaskets = new Set<string>()
  const assigned = state.batches.reduce((total, run) => {
    if (
      run.id === except ||
      !activeProduction(run) ||
      run.status === 'completed'
    )
      return total
    const basket = productionRunLines(run).find((line) =>
      line.definition?.components?.some(
        (component: Item) => component.productId === productId,
      ),
    )
    if (!basket) return total
    openBaskets.add(run.id)
    return total + Number(basket.basketPlan?.[productId]?.stock || 0)
  }, 0)
  const openEvents = (state.events || []).filter(
    (event) => !['Completed', 'Cancelled'].includes(event.status),
  )
  const marketStock = state.batches.reduce((total, run) => {
    if (run.status !== 'completed') return total
    return (
      total +
      productionRunLines(run)
        .filter(
          (line) =>
            line.productId === productId &&
            !productionWasReversed(state, run, line),
        )
        .reduce((sum, line) => {
          const allocations = activeBasketAssignments(line, state)
          let left = Number(line.actualYield ?? line.output ?? 0)
          for (const allocation of allocations) {
            const filled = Math.min(left, allocation.quantity)
            left -= filled
            if (openBaskets.has(allocation.runId)) sum += filled
          }
          if (left <= 0) return sum
          const invoice = (state.finance_transactions || []).find(
            (entry) =>
              entry.id === run.orderId &&
              !entry.reversedBy &&
              entry.status !== 'void',
          )
          if (invoice) return sum + left
          const openMarket = openEvents.reduce((count, event) => {
            const allocated = marketOutput(run, line, event.id, state)
            const basketCredit = allocations
              .filter((entry) =>
                state.batches.some(
                  (parent) =>
                    parent.id === entry.runId && parent.eventId === event.id,
                ),
              )
              .reduce((value, entry) => value + entry.quantity, 0)
            return count + Math.max(0, allocated.completed - basketCredit)
          }, 0)
          return sum + Math.min(left, openMarket)
        }, 0)
    )
  }, 0)
  return assigned + marketStock
}

export function basketSources(
  state: Workspace,
  parentId: string,
  productId: string,
) {
  return state.batches.filter(activeProduction).flatMap((run) =>
    productionRunLines(run).flatMap((line) => {
      if (line.productId !== productId) return []
      const allocations = activeBasketAssignments(line, state)
      const index = allocations.findIndex((entry) => entry.runId === parentId)
      if (index < 0) return []
      const assigned = allocations[index].quantity
      const preceding = allocations
        .slice(0, index)
        .reduce((sum, entry) => sum + entry.quantity, 0)
      const posted =
        run.status === 'completed' && !productionWasReversed(state, run, line)
          ? Math.min(
              assigned,
              Math.max(
                0,
                Number(line.actualYield ?? line.output ?? 0) - preceding,
              ),
            )
          : 0
      return [
        {
          run,
          line,
          assigned,
          posted,
          pending: run.status === 'completed' ? 0 : assigned,
        },
      ]
    }),
  )
}

export function basketProduction(
  line: Item,
  state: Workspace,
  parentId: string,
) {
  const product = state.products.find((entry) => entry.id === line.productId)
  if (workflowOf(product || line.definition?.product || {}) !== 'kit') return []
  const completed = state.batches.some(
    (run) => run.id === parentId && run.status === 'completed',
  )
  const components: Item[] =
    (completed ? line.definition?.components : product?.kitComponents) || []
  return components.map((component) => {
    const item = state.products.find(
      (entry) => entry.id === component.productId,
    )
    const name = item?.name || component.product?.name || 'Unavailable product'
    const required = Number(component.quantity) * Number(line.quantity || 0)
    const stock = Math.max(0, Number(item?.quantity || 0))
    const eligible = Math.max(
      0,
      stock - finishedBasketClaims(state, component.productId, parentId),
    )
    const choice = line.basketPlan?.[component.productId] || {}
    const allocated = Number(choice.stock || 0)
    const sources = basketSources(state, parentId, component.productId)
    const posted = sources.reduce((sum, source) => sum + source.posted, 0)
    const pending = sources.reduce((sum, source) => sum + source.pending, 0)
    const unplanned = Math.max(0, required - allocated - posted - pending)
    const packingRequired =
      Number(component.quantity) *
      (Number(line.output || line.quantity || 0) + Number(line.waste || 0))
    const ready = Math.min(
      eligible,
      line.basketPlan ? allocated + posted : eligible,
    )
    const resale = !!item && workflowOf(item) === 'resale'
    let requirementCandidate: Item | undefined
    let candidate: Item | undefined
    let setup = ''
    let shortages: string[] = []
    if (!resale && unplanned > 0) {
      try {
        if (
          !item ||
          item.archived ||
          !['food', 'handmade'].includes(workflowOf(item))
        )
          throw new Error('Link an active recipe or design product.')
        const recipe = state.recipes.find((entry) => entry.id === item.recipeId)
        const mapping =
          item.unitsPerPackage && recipe?.yieldUnit
            ? {
                quantity: item.unitsPerPackage,
                unit: item.contentUnit || recipe.yieldUnit,
                verified: true,
              }
            : {}
        const definition = productionDefinition(item, state, mapping)
        const batch = definition.recipe
          ? Number(definition.recipe.yield) /
            Number(definition.product.unitsPerPackage)
          : 1
        if (choice.wholeBatch && (!Number.isSafeInteger(batch) || batch < 1))
          throw new Error(
            'A whole batch does not yield a whole number of selling packages. Use scaled production or review the package size.',
          )
        const quantity = choice.wholeBatch
          ? Math.ceil(unplanned / batch) * batch
          : unplanned
        requirementCandidate = {
          id: component.productId,
          name,
          productId: component.productId,
          quantity,
          mapping,
          definition,
        }
        const requirements = combinedProductionRequirements([requirementCandidate], state)
        const error = requirements.products[0]?.error
        if (error) throw new Error(error)
        candidate = requirementCandidate
        shortages = requirements.shortages.map(
          (entry) =>
            `Missing ${Number((entry.quantity - entry.available).toFixed(6))} ${entry.unit} ${entry.name}.`,
        )
      } catch (error) {
        candidate = undefined
        setup = (error as Error).message
      }
    }
    return {
      component,
      item,
      name,
      required,
      packingRequired,
      stock,
      eligible,
      allocated,
      sources,
      posted,
      pending,
      unplanned,
      ready,
      resale,
      requirementCandidate,
      candidate,
      setup,
      shortages,
      choice,
    }
  })
}

export function basketAllocationIssues(
  lines: Item[],
  state: Workspace,
  parentId: string,
) {
  return lines.flatMap((line) =>
    !line.basketPlan
      ? []
      : basketProduction(line, state, parentId)
          .filter((entry) => entry.ready < entry.packingRequired)
          .map(
            (entry) =>
              `${entry.name}: ${entry.packingRequired - entry.ready} more packages needed. Finish a linked run or allocate available stock.`,
          ),
  )
}
