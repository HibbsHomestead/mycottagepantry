import { normalizeUnit } from '../../src/lib/domain'
/** Only labelled product facts. A width is never a purchasable length. */
export function productSpecifications(product: any) {
  const fields: Record<string, string | number> = {}
  const text = (v: any): string =>
    typeof v === 'string' || typeof v === 'number'
      ? String(v).slice(0, 6000)
      : ''
  const properties = new Map<string, any>()
  for (const p of Array.isArray(product.additionalProperty)
    ? product.additionalProperty
    : []) {
    if (p?.name) properties.set(String(p.name).trim().toLowerCase(), p)
  }
  const property = (...keys: string[]) =>
    keys.map((k) => properties.get(k)).find(Boolean)
  const value = (p: any) => text(p?.value ?? p)
  const add = (key: string, v: any) => {
    const s = value(v)
    if (s) fields[key] = s
  }
  add('manufacturerSku', product.mpn)
  add(
    'fiber',
    product.material ||
      property('composition', 'fiber content', 'material composition'),
  )
  add('color', product.color || property('color', 'colour'))
  add('pattern', product.pattern || property('pattern'))
  add(
    'variant',
    product.size || property('selected variant', 'variant', 'size'),
  )
  add(
    'dimensions',
    property('dimensions', 'product dimensions', 'specifications'),
  )
  const type = value(property('material type')).toLowerCase()
  const title = text(product.name)
  const fabric = type === 'fabric' || /\bfabric\b/i.test(title)
  const yarn = type === 'yarn' || /\byarn\b/i.test(title)
  if (fabric || yarn) fields.materialType = fabric ? 'fabric' : 'yarn'
  const measure = (p: any) => {
    if (!p) return null
    const raw =
      typeof p === 'object'
        ? `${value(p)} ${text(p.unitText || p.unitCode)}`
        : text(p)
    const match = raw
      .trim()
      .match(
        /^(\d+(?:\.\d+)?)\s*(yards?|yd|feet|ft|inches?|in|meters?|metres?|m|cm|mm|grams?|g|kg|oz|ounces?|lbs?|pounds?)\b/i,
      )
    if (!match) return null
    const aliases: Record<string, string> = {
      yards: 'yd',
      yard: 'yd',
      feet: 'ft',
      inches: 'in',
      inch: 'in',
      meters: 'm',
      meter: 'm',
      metres: 'm',
      metre: 'm',
      grams: 'g',
      gram: 'g',
    }
    const u = aliases[match[2].toLowerCase()] || normalizeUnit(match[2])
    return u && Number(match[1]) > 0
      ? { quantity: Number(match[1]), unit: u }
      : null
  }
  if (fabric) {
    const width = measure(product.width || property('fabric width', 'width'))
    if (width && ['yd', 'ft', 'in', 'm', 'cm'].includes(width.unit)) {
      fields.fabricWidth = width.quantity
      fields.widthUnit = width.unit
    }
    const length = measure(
      property('fabric length', 'length', 'yardage') || product.length,
    )
    if (length && ['yd', 'ft', 'in', 'm', 'cm'].includes(length.unit)) {
      fields.purchaseQuantity = length.quantity
      fields.purchaseUnit = length.unit
    }
  }
  if (yarn) {
    const length = measure(
      property('yarn length', 'length', 'yardage') || product.length,
    )
    const weight = measure(
      property('yarn weight', 'net weight', 'weight') || product.weight,
    )
    if (length && ['yd', 'ft', 'in', 'm', 'cm'].includes(length.unit)) {
      fields.yarnLength = length.quantity
      fields.yarnLengthUnit = length.unit
    }
    if (weight && ['g', 'kg', 'oz', 'lb'].includes(weight.unit)) {
      fields.yarnWeight = weight.quantity
      fields.yarnWeightUnit = weight.unit
    }
  }
  const contents = value(
    property(
      'items per pack',
      'items per case',
      'items per package',
      'package quantity',
      'number of pieces',
    ),
  )
  if (/^[1-9]\d*$/.test(contents)) fields.itemsPerPackage = Number(contents)
  return fields
}
