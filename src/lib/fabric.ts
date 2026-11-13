import { convert, number, type Item } from './domain'

export const lengthUnits = ['yd', 'ft', 'in', 'm', 'cm'] as const
export const isFabric = (item?: Item | null) => item?.materialType === 'fabric'
/** Historical fabric dates remain stored, but never drive expiry controls or alerts. */
export const supportsExpiry = (item?: Item | null) => !isFabric(item)
export const fabricUnitOptions = (tracking: string) =>
  tracking === 'precut' ? ['each'] : [...lengthUnits]
export function lengthUnit(unit: string) {
  if (!(lengthUnits as readonly string[]).includes(unit))
    throw new Error('Choose yd, ft, in, m or cm for fabric length.')
  return unit
}
/** Fabric never uses weight, area, or contextual count-to-length conversions. */
export function fabricConvert(
  quantity: number | string,
  from: string,
  to: string,
  item: Item,
) {
  if (item.fabricTracking === 'precut') {
    if (from !== 'each' || to !== 'each')
      throw new Error(
        'Precuts and bundles are tracked by count, not continuous yardage.',
      )
    return number(quantity, 'Piece count')
  }
  return convert(quantity, lengthUnit(from), lengthUnit(to))
}
export function validateFabric(item: Item, existing?: Item) {
  if (
    item.usedAs !== 'material' ||
    !['length', 'precut'].includes(item.fabricTracking)
  )
    throw new Error('Choose length or precut/count fabric tracking.')
  if (item.fabricTracking === 'precut') {
    if (item.unit !== 'each')
      throw new Error('Track precuts and bundles as each.')
    if (item.pieceLength !== '' && item.pieceLength != null) {
      item.pieceLength = number(item.pieceLength, 'Piece length', 0.000001)
      lengthUnit(item.pieceLengthUnit)
    }
    item.pieceMode = 'aggregate'
  } else {
    lengthUnit(item.unit)
    if (!['aggregate', 'separate'].includes(item.pieceMode))
      throw new Error('Choose total length or a separate piece record.')
    if (item.pieceMode === 'separate' && !String(item.pieceId || '').trim())
      throw new Error('Enter an identifier for this separate piece or remnant.')
  }
  item.fabricWidth = number(item.fabricWidth, 'Fabric width', 0.000001)
  lengthUnit(item.widthUnit)
  for (const key of [
    'fiber',
    'color',
    'pattern',
    'collection',
    'pieceId',
    'sku',
    'barcode',
    'storageLocation',
    'notes',
  ]) {
    item[key] = String(item[key] || '').trim()
    if (item[key].length > (key === 'notes' ? 4000 : 200))
      throw new Error('Fabric detail is too long.')
  }
  if (existing) {
    if (
      existing.fabricTracking !== item.fabricTracking ||
      existing.unit !== item.unit ||
      existing.pieceMode !== item.pieceMode ||
      Math.abs(
        convert(existing.fabricWidth, existing.widthUnit, 'm') -
          convert(item.fabricWidth, item.widthUnit, 'm'),
      ) > 1e-9
    )
      throw new Error(
        'Tracking method, stock unit and width are fixed. Create a separate fabric record for a different width or tracking method.',
      )
  }
  return item
}
/** Confirmed length is per purchased bolt/roll. Never infer package contents. */
export function fabricReceipt(item: Item, data: Record<string, unknown>) {
  const quantity = number(data.quantity, 'Purchase quantity', 0.000001)
  if (['bolt', 'roll'].includes(String(data.unit))) {
    if (item.fabricTracking !== 'length' || data.lengthConfirmed !== true)
      throw new Error(
        'Confirm the usable length per bolt or roll before receiving.',
      )
    const length = number(
      data.usableLength,
      'Usable length per bolt/roll',
      0.000001,
    )
    return fabricConvert(
      quantity * length,
      String(data.usableLengthUnit),
      item.unit,
      item,
    )
  }
  return fabricConvert(quantity, String(data.unit), item.unit, item)
}
export function fabricPurchaseCost(
  data: Record<string, unknown>,
  total: unknown,
) {
  const value = data.priceMode === 'per_unit' ? data.purchaseUnitPrice : total
  if (value === '' || value == null)
    throw new Error(
      'Confirm acquisition cost, including zero for a free purchase.',
    )
  const price = number(value, 'Purchase cost')
  return data.priceMode === 'per_unit'
    ? price * number(data.quantity, 'Purchase quantity', 0.000001)
    : price
}
export function checkFabricWidth(input: Item, line: Record<string, unknown>) {
  if (line.minimumWidth === '' || line.minimumWidth == null) return
  if (!isFabric(input))
    throw new Error('Width requirements apply to fabric materials.')
  const minimum = number(line.minimumWidth, 'Required fabric width', 0.000001)
  lengthUnit(String(line.widthUnit))
  if (
    convert(input.fabricWidth, input.widthUnit, 'm') + 1e-9 <
    convert(minimum, String(line.widthUnit), 'm')
  )
    throw new Error(`${input.name} is narrower than the design requires.`)
}
export function materialPlan(design: Item, ingredients: Item[], count = 1) {
  return ((design.lines || []) as Item[]).map((line: Item) => {
    const input = ingredients.find((i) => i.id === line.ingredientId)
    if (!input) throw new Error('Select an available material for every line.')
    checkFabricWidth(input, line)
    const planned = number(line.quantity, 'Material quantity', 0.000001) * count
    const needed = isFabric(input)
      ? fabricConvert(planned, line.unit, input.unit, input)
      : convert(planned, line.unit, input.unit, input.conversions)
    return {
      id: input.id,
      name: input.name,
      planned,
      enteredUnit: line.unit,
      needed,
      unit: input.unit,
      available: input.quantity,
      shortage: Math.max(0, needed - input.quantity),
      cost: needed * input.cost,
    }
  })
}
