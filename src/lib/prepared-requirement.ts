import { convert, number, type Item } from './domain'

export type PreparedRequirement = {
  method: string
  perPortion: number
  outputUnit: string
  costPerOutputUnit: number
}

export function preparedRequirement(
  item: Item,
  lot: Item,
): PreparedRequirement {
  if (
    lot.kind !== 'ingredient_prep' ||
    lot.ingredientId !== item.id ||
    lot.reversedAt
  )
    throw new Error(`${item.name}: this prepared stock is no longer eligible.`)
  if (
    !(Number(lot.perPortion) > 0) ||
    !lot.outputUnit ||
    (!lot.hasMeasurement && lot.outputUnit !== lot.unit)
  )
    throw new Error(
      `${item.name}: review the measured amount and unit per portion. Descriptive notes are not conversions.`,
    )
  let equivalent: number
  try {
    equivalent = convert(1, lot.outputUnit, item.unit, item.conversions)
    const recorded = convert(
      lot.usable / lot.portions,
      lot.unit,
      item.unit,
      item.conversions,
    )
    if (
      !(recorded > 0) ||
      Math.abs(recorded - equivalent * lot.perPortion) >
        Math.max(1e-7, recorded * 1e-8)
    )
      throw new Error(
        'The saved portion does not match the current conversion.',
      )
  } catch {
    throw new Error(
      `${item.name}: review the verified conversion from ${lot.outputUnit} per portion to ${item.unit} inventory units. No conversion is assumed.`,
    )
  }
  return {
    method: lot.method || 'Portioned',
    perPortion: Number(lot.perPortion),
    outputUnit: lot.outputUnit,
    costPerOutputUnit:
      equivalent *
      convert(1, item.unit, lot.unit, item.conversions) *
      number(lot.unitCost, 'Recorded prepared stock cost'),
  }
}

export const preparedSpecKey = (value?: PreparedRequirement) =>
  value
    ? JSON.stringify([value.method, value.perPortion, value.outputUnit])
    : ''

export function matchingPreparedLots(
  item: Item,
  lots: Item[],
  requirement: PreparedRequirement,
) {
  return lots.filter((lot) => {
    try {
      return (
        lot.unit === item.unit &&
        preparedSpecKey(preparedRequirement(item, lot)) ===
          preparedSpecKey(requirement)
      )
    } catch {
      return false
    }
  })
}

export const preparedMeasureUnit = (unit: string) =>
  unit === 'each' ? 'counted units' : unit

export function preparedLabel(item: Item, requirement: PreparedRequirement) {
  return `${item.name} — ${requirement.method} · ${requirement.perPortion} ${preparedMeasureUnit(requirement.outputUnit)} per portion`
}

export function assertSamePreparedSource(
  first: Item,
  second: Item,
  name: string,
) {
  if (preparedSpecKey(first.prepared) !== preparedSpecKey(second.prepared))
    throw new Error(
      `${name}: this run line cannot combine different prepared requirements or mix prepared and unportioned use of the same item. Separate the usage before continuing.`,
    )
}

export function validatePreparedLine(
  line: Item,
  item: Item,
  lots: Item[],
  previous: Item[] = [],
) {
  const requirement = line.prepared as PreparedRequirement | undefined
  if (!requirement) return
  if (
    item.trackInventory === false ||
    item.compoundRecipeId ||
    line.componentRecipeId
  )
    throw new Error(
      `${item.name}: choose tracked, directly portioned inventory for this requirement.`,
    )
  if (line.unit !== requirement.outputUnit)
    throw new Error(
      `${item.name}: use the saved measured unit for the portion definition.`,
    )
  convert(
    number(line.quantity, 'Prepared quantity', 0.000001),
    line.unit,
    item.unit,
    item.conversions,
  )
  const matches = matchingPreparedLots(item, lots, requirement).filter(
    (lot) => lot.quantity > 0,
  )
  const match =
    matches.find(
      (lot) =>
        preparedRequirement(item, lot).costPerOutputUnit ===
        requirement.costPerOutputUnit,
    ) || matches[0]
  const prior = previous.find(
    (entry) =>
      entry.ingredientId === item.id &&
      entry.prepared &&
      preparedSpecKey(entry.prepared) === preparedSpecKey(requirement),
  )
  if (!match && !prior)
    throw new Error(
      `${item.name}: choose a verified prepared portion from inventory before saving.`,
    )
  line.prepared = match ? preparedRequirement(item, match) : prior!.prepared
}

export function preparedEstimateRate(line: Item, item: Item) {
  const requirement = line.prepared as PreparedRequirement
  return (
    number(requirement.costPerOutputUnit, 'Recorded prepared unit cost') *
    convert(1, item.unit, requirement.outputUnit, item.conversions)
  )
}
