import { checkFabricWidth, fabricConvert, isFabric } from './fabric'
import { convert, number, type Item, type Workspace } from './domain'
import { preparedEstimateRate } from './prepared-requirement'

export const handmadeUnits = [
  'each',
  'sheet',
  'yd',
  'ft',
  'in',
  'm',
  'cm',
  'oz',
  'g',
  'kg',
  'ml',
  'l',
  'roll',
  'pack',
  'box',
]
/** Product-owned BOMs are independent of food recipes. Legacy designs remain readable. */
export function handmadeBom(product: Item, state: Workspace): Item | undefined {
  if (product.bom) return product.bom
  const legacy = state.recipes.find(
    (r) => r.id === product.recipeId && r.workflow === 'handmade',
  )
  return legacy
    ? { ...legacy, output: legacy.yield, scrapPercent: 0, legacy: true }
    : undefined
}
export function validateHandmadeBom(bom: Item, state: Workspace) {
  number(bom.output, 'BOM output', 1)
  if (!Number.isInteger(Number(bom.output)))
    throw new Error('BOM output must be whole finished units.')
  for (const key of ['laborMinutes', 'laborRate', 'overhead', 'scrapPercent']) {
    if (bom[key] == null || bom[key] === '')
      throw new Error(`Enter ${key}; explicitly enter zero if excluded.`)
    number(bom[key], key)
  }
  if (Number(bom.scrapPercent) > 100)
    throw new Error('Scrap allowance cannot exceed 100%.')
  if (!Array.isArray(bom.lines) || !bom.lines.length || bom.lines.length > 100)
    throw new Error('Add 1 to 100 BOM lines.')
  const ids = new Set<string>()
  for (const line of bom.lines) {
    const i = state.ingredients.find(
      (i) =>
        i.id === line.ingredientId &&
        ['material', 'packaging'].includes(i.usedAs),
    )
    if (!i || i.trackInventory === false)
      throw new Error(
        'Choose tracked materials or shared packaging from this business.',
      )
    if (ids.has(i.id)) throw new Error('Combine repeated BOM components.')
    ids.add(i.id)
    number(line.quantity, 'BOM quantity', 0.000001)
    checkFabricWidth(i, line)
    if (isFabric(i)) fabricConvert(line.quantity, line.unit, i.unit, i)
    else convert(line.quantity, line.unit, i.unit, i.conversions)
  }
}
export function handmadeRequirements(
  bom: Item,
  inputs: Item[],
  planned: number,
  actual?: Item,
) {
  const multiplier =
    number(planned, 'Planned output', 1) / number(bom.output, 'BOM output', 1)
  const output = number(actual?.output ?? planned, 'Sellable output', 1)
  const waste = number(actual?.waste ?? 0, 'Scrap output')
  if (![planned, output, waste].every(Number.isInteger))
    throw new Error('Use whole finished units.')
  const requirements: Item[] = bom.lines.map((line: Item) => {
    const i = inputs.find((i) => i.id === line.ingredientId)
    if (!i) throw new Error('BOM component unavailable.')
    checkFabricWidth(i, line)
    const estimated =
      (isFabric(i)
        ? fabricConvert(line.quantity, line.unit, i.unit, i)
        : convert(line.quantity, line.unit, i.unit, i.conversions)) *
      multiplier *
      (1 + Number(bom.scrapPercent || 0) / 100)
    const quantity =
      number(actual?.usage?.[i.id] ?? estimated, 'Actual material use') +
      number(actual?.materialWaste?.[i.id] ?? 0, 'Material waste')
    return {
      id: 'ingredient:' + i.id,
      name: i.name,
      kind: 'ingredient',
      itemId: i.id,
      unit: i.unit,
      quantity,
      tracked: true,
      source: line,
    }
  })
  const laborMinutes = number(
    actual?.laborMinutes ?? Number(bom.laborMinutes) * multiplier,
    'Labor minutes',
  )
  return {
    requirements,
    multiplier,
    output,
    waste,
    cost: {
      laborMinutes,
      laborRate: Number(bom.laborRate),
      labor: (laborMinutes / 60) * Number(bom.laborRate),
      overhead: Number(bom.overhead) * multiplier,
      waste: 0,
    },
  }
}
export function handmadeEstimate(product: Item, state: Workspace) {
  const bom = handmadeBom(product, state)
  if (!bom) throw new Error('Bill of materials needs review.')
  validateHandmadeBom(bom, state)
  const result = handmadeRequirements(
    bom,
    state.ingredients,
    Number(bom.output),
  )
  let materials = 0,
    packaging = 0
  const lines: Item[] = result.requirements.map((line) => {
    const i = state.ingredients.find((i) => i.id === line.itemId)!
    if (i.needsCostSetup || i.cost == null || i.cost === '')
      throw new Error(`${i.name}: cost missing.`)
    const cost = line.quantity * (line.source.prepared ? preparedEstimateRate(line.source, i) : number(i.cost, 'Material cost'))
    if (i.usedAs === 'packaging') packaging += cost
    else materials += cost
    return { ...line, cost }
  })
  const total = materials + packaging + result.cost.labor + result.cost.overhead
  return {
    lines,
    materials,
    packaging,
    labor: result.cost.labor,
    overhead: result.cost.overhead,
    total,
    unit: total / Number(bom.output),
  }
}
