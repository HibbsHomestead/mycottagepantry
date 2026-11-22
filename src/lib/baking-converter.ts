import { units } from './domain'
export const weightUnits = ['g', 'kg', 'oz', 'lb']
export const volumeUnits = [
  'ml',
  'l',
  'tsp',
  'tbsp',
  'fl oz',
  'cup',
  'pint',
  'quart',
  'gallon',
]
export const ingredientUnits = [...weightUnits, 'cup', 'tbsp', 'tsp', 'ml', 'l']
export type BakingReference = {
  id: string
  ingredientName: string
  description: string
  referenceWeightG: number
  referenceVolumeMl: number
  originalQuantity: number
  originalUnit: string
  sourceName: string
  sourceUrl: string
  brand?: string
  businessId?: string | null
  inventoryIngredientId?: string | null
  referenceId?: string | null
  scope: 'shared' | 'private'
}
export function parseBakingQuantity(
  raw: string,
  signed = false,
): number | null {
  const value = raw.trim()
  let result: number
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
    result = Number(value)
  else {
    const match = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(value)
    if (!match || Number(match[3]) === 0) return null
    result = Number(match[1] || 0) + Number(match[2]) / Number(match[3])
  }
  return Number.isFinite(result) && (signed || result >= 0) ? result : null
}
export function bakingConvert(
  quantity: number,
  from: string,
  to: string,
  density?: number,
): number | null {
  const a = units[from],
    b = units[to]
  if (!a || !b || !Number.isFinite(quantity) || quantity < 0) return null
  let result = (quantity * a.factor) / b.factor
  if (a.category !== b.category) {
    if (!density || !Number.isFinite(density) || density <= 0) return null
    if (a.category === 'volume' && b.category === 'weight') result *= density
    else if (a.category === 'weight' && b.category === 'volume')
      result /= density
    else return null
  }
  return Number.isFinite(result) ? result : null
}
export function bakingDisplay(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value > 0 && value < 0.005) return 'less than 0.01'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
    value,
  )
}
export const yeastRatios: Record<string, number> = {
  'Fresh yeast': 1,
  'Active dry yeast': 0.4,
  'Instant yeast': 0.33,
}
export const yeastConvert = (q: number, from: string, to: string) =>
  (q / yeastRatios[from]) * yeastRatios[to]
export const ovenConvert = (q: number, from: string) =>
  from === '°F' ? (q - 32) / 1.8 : q * 1.8 + 32
export function validateCustomFactor(input: any) {
  const weight = Number(input.referenceWeightG),
    volume = Number(input.referenceVolumeMl)
  if (
    !Number.isFinite(weight) ||
    weight <= 0 ||
    !Number.isFinite(volume) ||
    volume <= 0 ||
    !Number.isFinite(weight / volume) ||
    weight / volume <= 0
  )
    throw new Error('Enter a positive measured weight and known volume.')
  if (
    typeof input.ingredientName !== 'string' ||
    !input.ingredientName.trim() ||
    input.ingredientName.length > 200
  )
    throw new Error('Choose an ingredient name (up to 200 characters).')
  if (typeof input.description !== 'string' || input.description.length > 500)
    throw new Error('Keep the measurement description under 500 characters.')
  return { weight, volume }
}
