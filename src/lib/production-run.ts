import { convert, knownCurrentIngredientCost, type Item, type Workspace } from './domain'
import { productionRequirements } from './production'
import { cardCost } from './product-list'
import { resaleCostBasis } from './resale-cost'

/** Read-through migration: old product-run IDs, snapshots and movements remain
 * untouched, including immutable finalized records. Repeated reads are stable. */
export function productionRunLines(run?: Item): Item[] {
  if (!run) return []
  if (Array.isArray(run.lines)) return run.lines
  if (!run.productionVersion) return []
  return [
    {
      ...run,
      id: 'original-line',
      output: run.actualYield,
      usage: run.status === 'completed' ? {} : run.actualUsage || {},
      historicalUsage: run.usage,
    },
  ]
}

export function combinedProductionRequirements(
  lines: Item[],
  state: Workspace,
  validateStock = false,
) {
  const merged = new Map<string, Item>()
  let total = 0
  const products = lines.map((line) => {
    let result: ReturnType<typeof productionRequirements>
    try {
      if (!line.definition)
        throw new Error(`${line.name}: recipe/BOM relationship is unavailable.`)
      result = productionRequirements(line.definition, Number(line.quantity), {
        ...line,
        laborMinutes: line.laborMinutes === '' ? undefined : line.laborMinutes,
        output: line.output === '' ? undefined : line.output,
      })
    } catch (error) {
      if (validateStock) throw error
      return {
        line,
        cost: undefined,
        multiplier: undefined,
        requirements: undefined,
        estimate: 0,
        costKnown: false,
        error: (error as Error).message,
      }
    }
    let materialCost = 0
    let lineCostKnown = true
    for (const r of result.requirements) {
      const item = (
        r.kind === 'product' ? state.products : state.ingredients
      ).find((i) => i.id === r.itemId)
      if (!item) {
        if (validateStock) throw new Error(`${r.name}: stock item unavailable.`)
        lineCostKnown = false
        const key = r.kind + ':' + r.itemId
        const previous = merged.get(key)
        merged.set(key, {
          ...r,
          quantity: Number(previous?.quantity || 0) + r.quantity,
          cost: 0,
          costKnown: false,
          inventoryCostKnown: false,
          costReason: `Referenced ${r.kind} ${r.itemId} is unavailable in this workspace.`,
          costBasis: 'Unresolved relationship',
          available: 0,
        })
        continue
      }
      let quantity: number
      try {
        quantity =
          r.kind === 'product'
            ? r.quantity
            : convert(r.quantity, r.unit, item.unit, item.conversions)
      } catch (error) {
        if (validateStock) throw error
        lineCostKnown = false
        const key = r.kind + ':' + item.id + ':' + r.unit
        const previous = merged.get(key)
        merged.set(key, {
          ...r,
          id: key,
          quantity: Number(previous?.quantity || 0) + r.quantity,
          cost: 0,
          costKnown: false,
          inventoryCostKnown: false,
          available: 0,
          costBasis: 'Unit conversion unavailable',
          costReason: (error as Error).message,
        })
        continue
      }
      // Planned estimates may use the same current product basis as All Products.
      // Finalization continues to require recorded inventory valuation.
      const recorded =
        !item.needsCostSetup &&
        item.cost != null &&
        item.cost !== '' &&
        Number.isFinite(Number(item.cost)) &&
        Number(item.cost) >= 0 &&
        (r.kind !== 'product' || item.stockCostKnown === true)
      let unitCost: number | undefined = recorded
        ? Number(item.cost)
        : undefined
      let costBasis =
        r.kind === 'product'
          ? item.stockEntry?.costEstimated
            ? 'Estimated inventory cost'
            : 'Average inventory cost'
          : 'Inventory cost'
      let costReason = 'Inventory valuation is not recorded.'
      if (!validateStock) {
        if (r.kind === 'product' && !recorded) {
          const planned = cardCost(item, state)
          unitCost = planned.cost
          costReason = planned.reason || costReason
          costBasis =
            item.workflow === 'resale'
              ? resaleCostBasis(item).label
              : 'Current product estimate'
        } else if (r.kind !== 'product') {
          unitCost = knownCurrentIngredientCost(item)
          costBasis =
            item.currentCost != null
              ? 'Current material cost'
              : 'Inventory cost'
          costReason = 'Material cost is missing or marked incomplete.'
        }
      }
      const costKnown = unitCost !== undefined
      lineCostKnown &&= costKnown
      const cost = costKnown ? quantity * unitCost! : 0
      materialCost += cost
      const key = r.kind + ':' + item.id
      const previous = merged.get(key)
      if (previous) {
        previous.quantity += quantity
        previous.cost += cost
        previous.costKnown &&= costKnown
        previous.inventoryCostKnown &&= recorded
      } else
        merged.set(key, {
          ...r,
          id: key,
          quantity,
          unit: r.kind === 'product' ? 'package' : item.unit,
          available: Number(item.quantity || 0),
          cost,
          costKnown,
          unitCost,
          costBasis,
          costReason: costKnown ? undefined : costReason,
          inventoryCostKnown: recorded,
          productId: r.kind === 'product' ? item.id : undefined,
          recipeId: item.recipeId,
        })
    }
    const flatPackaging =
      Number(line.definition.recipe?.packagingCost || 0) * result.multiplier
    const estimate =
      materialCost +
      flatPackaging +
      result.cost.labor +
      result.cost.overhead +
      result.cost.waste
    total += estimate
    return { line, ...result, estimate, costKnown: lineCostKnown }
  })
  const requirements = [...merged.values()]
  if (validateStock)
    for (const r of requirements) {
      if (!r.costKnown) throw new Error(`${r.name}: stock cost needs review.`)
      if (r.tracked && r.quantity > r.available + 1e-8)
        throw new Error(
          `${r.name}: combined run requirement exceeds available stock.`,
        )
    }
  return {
    products,
    requirements,
    total,
    costKnown:
      products.every((p) => p.costKnown) &&
      requirements.every((r) => r.costKnown),
    shortages: requirements.filter(
      (r) => r.tracked && r.quantity > r.available + 1e-8,
    ),
  }
}
