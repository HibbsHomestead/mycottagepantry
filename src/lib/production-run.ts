import { convert, type Item, type Workspace } from './domain'
import { productionRequirements } from './production'

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
    if (!line.definition)
      throw new Error(`${line.name}: recipe/BOM setup needs review.`)
    const result = productionRequirements(
      line.definition,
      Number(line.quantity),
      { ...line, output: line.output === '' ? undefined : line.output },
    )
    let materialCost = 0
    for (const r of result.requirements) {
      const item = (
        r.kind === 'product' ? state.products : state.ingredients
      ).find((i) => i.id === r.itemId)
      if (!item) throw new Error(`${r.name}: stock item unavailable.`)
      const quantity =
        r.kind === 'product'
          ? r.quantity
          : convert(r.quantity, r.unit, item.unit, item.conversions)
      const costKnown =
        !item.needsCostSetup &&
        item.cost != null &&
        item.cost !== '' &&
        Number.isFinite(Number(item.cost)) &&
        (r.kind !== 'product' || item.stockCostKnown === true)
      const cost = costKnown ? quantity * Number(item.cost) : 0
      materialCost += cost
      const key = r.kind + ':' + item.id
      const previous = merged.get(key)
      if (previous) {
        previous.quantity += quantity
        previous.cost += cost
        previous.costKnown &&= costKnown
      } else
        merged.set(key, {
          ...r,
          id: key,
          quantity,
          unit: r.kind === 'product' ? 'package' : item.unit,
          available: Number(item.quantity || 0),
          cost,
          costKnown,
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
    return { line, ...result, estimate }
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
    costKnown: requirements.every((r) => r.costKnown),
    shortages: requirements.filter(
      (r) => r.tracked && r.quantity > r.available + 1e-8,
    ),
  }
}
