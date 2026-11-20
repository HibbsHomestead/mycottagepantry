import { units } from './domain'

/** Supported physical food-prep outputs; package sizes require explicit definitions. */
export const prepYieldUnits = Object.keys(units).filter(
  (unit) =>
    ['weight', 'volume', 'count'].includes(units[unit].category) &&
    units[unit].factor > 0,
)
export function supportedPrepYieldUnit(unit: string) {
  return prepYieldUnits.includes(unit)
}
