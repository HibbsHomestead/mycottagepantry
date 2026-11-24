import { convert, knownCurrentIngredientCost, type Item, type Workspace } from './domain'
import { productionRequirements } from './production'
import { cardCost } from './product-list'
import { resaleCostBasis } from './resale-cost'
import { matchingPreparedLots, preparedEstimateRate, preparedSpecKey } from './prepared-requirement'
import { planPrepUsage } from './stock-prep'

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

export function productionOutputIssue(line: Item) {
  const output = Number(line.output)
  return !Number.isSafeInteger(output) || output < 1
    ? 'Enter a whole number of good units greater than zero.'
    : ''
}

export function productionReviewIssues(lines: Item[], calculation?: ReturnType<typeof combinedProductionRequirements>) {
  const issues = lines.flatMap((line, index) => {
    const issue = productionOutputIssue(line)
    return issue ? [`${line.name || `Product ${index + 1}`}: ${issue}`] : []
  })
  if (!lines.length) issues.push('Add at least one product to the run.')
  if (calculation) {
    for (const product of calculation.products) if (product.error) issues.push(product.error)
    for (const requirement of calculation.requirements) {
      if (!requirement.inventoryCostKnown)
        issues.push(`${requirement.name}: ${requirement.costReason || 'record a verified inventory cost.'}`)
    }
    for (const shortage of calculation.shortages)
      issues.push(`${shortage.name}: need ${shortage.quantity} ${shortage.unit}, only ${shortage.available} available.`)
    issues.push(...calculation.allocationIssues)
  }
  return [...new Set(issues)]
}

export function combinedProductionRequirements(
  lines: Item[],
  state: Workspace,
  validateStock = false,
) {
  const merged = new Map<string, Item>()
  const allocationIssues: string[] = []
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
      let available = Number(item.quantity || 0)
      let preparedKey = ''
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
      if (r.kind === 'ingredient' && r.source?.prepared) {
        const requirement = r.source.prepared
        const eligible = matchingPreparedLots(item, state.lots || [], requirement)
        const chosen = eligible.find((lot) => lot.id === line.prepSources?.[item.id])
        available = chosen ? Number(chosen.quantity) : Math.max(0, ...eligible.map((lot) => Number(lot.quantity)))
        preparedKey = `:prepared:${chosen?.id || preparedSpecKey(requirement)}`
        unitCost = chosen ? Number(chosen.unitCost) : preparedEstimateRate(r.source, item)
        costBasis = chosen ? 'Recorded prepared lot cost' : 'Saved prepared portion cost estimate'
        try {
          planPrepUsage(item, state.lots || [], quantity, line.prepSources?.[item.id], requirement)
        } catch (error) {
          if (validateStock) throw error
          allocationIssues.push((error as Error).message)
        }
      }
      const costKnown = unitCost !== undefined
      lineCostKnown &&= costKnown
      const cost = costKnown ? quantity * unitCost! : 0
      materialCost += cost
      const key = r.kind + ':' + item.id + preparedKey
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
          available,
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
    allocationIssues: [...new Set(allocationIssues)],
    costKnown:
      products.every((p) => p.costKnown) &&
      requirements.every((r) => r.costKnown),
    shortages: requirements.filter(
      (r) => r.tracked && r.quantity > r.available + 1e-8,
    ),
  }
}
