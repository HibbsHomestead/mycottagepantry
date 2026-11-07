import { configuredTaxRates } from './tax-configuration'
import { categoryTaxState } from './product-categories'
export type Item = { id: string; name: string; [key: string]: any }
export type Workspace = { [key: string]: Item[] }
export const units: Record<string, { category: string; factor: number }> = {
  mg: { category: 'weight', factor: 0.001 },
  g: { category: 'weight', factor: 1 },
  kg: { category: 'weight', factor: 1000 },
  oz: { category: 'weight', factor: 28.349523125 },
  lb: { category: 'weight', factor: 453.59237 },
  ml: { category: 'volume', factor: 1 },
  l: { category: 'volume', factor: 1000 },
  'fl oz': { category: 'volume', factor: 29.5735295625 },
  cup: { category: 'volume', factor: 236.5882365 },
  tbsp: { category: 'volume', factor: 14.78676478125 },
  tsp: { category: 'volume', factor: 4.92892159375 },
  // US liquid gallon = 231 cubic inches; inch = exactly 25.4 mm (NIST).
  pint: { category: 'volume', factor: 473.176473 },
  quart: { category: 'volume', factor: 946.352946 },
  gallon: { category: 'volume', factor: 3785.411784 },
  mm: { category: 'length', factor: 0.001 },
  cm: { category: 'length', factor: 0.01 },
  m: { category: 'length', factor: 1 },
  in: { category: 'length', factor: 0.0254 },
  ft: { category: 'length', factor: 0.3048 },
  yd: { category: 'length', factor: 0.9144 },
  each: { category: 'count', factor: 1 },
  dozen: { category: 'count', factor: 12 },
  package: { category: 'count', factor: 0 },
  case: { category: 'count', factor: 0 },
  bag: { category: 'count', factor: 0 },
  bottle: { category: 'count', factor: 0 },
  jar: { category: 'count', factor: 0 },
  can: { category: 'count', factor: 0 },
  box: { category: 'count', factor: 0 },
  pack: { category: 'count', factor: 0 },
  bundle: { category: 'count', factor: 0 },
  roll: { category: 'count', factor: 0 },
}
/** IDs are persisted unchanged; labels make the existing US convention explicit. */
export function unitLabel(unit: string) {
  return (
    (
      {
        ml: 'mL',
        l: 'L',
        oz: 'oz (weight)',
        'fl oz': 'US fl oz',
        cup: 'US cup',
        tsp: 'US tsp',
        tbsp: 'US tbsp',
        pint: 'US liquid pint',
        quart: 'US liquid quart',
        gallon: 'US gallon',
      } as Record<string, string>
    )[unit] || unit
  )
}
/** For new imports only: ambiguous regional volume measures require review. */
export function normalizeUnit(
  raw: string,
  usVolumeConfirmed = false,
): string | null {
  const text = raw.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ')
  if (/imperial|metric cup|uk/.test(text)) return null
  const explicitUS = /^us /.test(text)
  const value = text.replace(/^us /, '')
  const aliases: Record<string, string> = {
    milligram: 'mg',
    milligrams: 'mg',
    gram: 'g',
    grams: 'g',
    kilograms: 'kg',
    kilogram: 'kg',
    ounce: 'oz',
    ounces: 'oz',
    lbs: 'lb',
    pound: 'lb',
    pounds: 'lb',
    milliliter: 'ml',
    milliliters: 'ml',
    millilitre: 'ml',
    millilitres: 'ml',
    liter: 'l',
    liters: 'l',
    litre: 'l',
    litres: 'l',
    gallons: 'gallon',
    gal: 'gallon',
    quarts: 'quart',
    qt: 'quart',
    pints: 'pint',
    pt: 'pint',
    cups: 'cup',
    teaspoons: 'tsp',
    teaspoon: 'tsp',
    tablespoons: 'tbsp',
    tablespoon: 'tbsp',
    'fluid ounce': 'fl oz',
    'fluid ounces': 'fl oz',
    'fl oz': 'fl oz',
    ea: 'each',
    pieces: 'each',
    bags: 'bag',
    bottles: 'bottle',
    jars: 'jar',
    cans: 'can',
    boxes: 'box',
    packs: 'pack',
    cases: 'case',
    rolls: 'roll',
    packages: 'package',
  }
  const id = aliases[value] || value
  if (!Object.hasOwn(units, id)) return null
  if (
    ['tsp', 'tbsp', 'fl oz', 'cup', 'pint', 'quart', 'gallon'].includes(id) &&
    !explicitUS &&
    !usVolumeConfirmed
  )
    return null
  return id
}
export function parseQuantity(value: unknown): number {
  if (typeof value === 'number') return value
  const text = String(value ?? '').trim()
  const fraction = text.match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/)
  if (fraction)
    return Number(fraction[3]) > 0
      ? Number(fraction[1] || 0) + Number(fraction[2]) / Number(fraction[3])
      : NaN
  return text ? Number(text) : NaN
}
export function ingredientUnits(conversions: any[] = []) {
  const registry = { ...units }
  for (const c of conversions)
    if (c.verified && c.unitDefinition) {
      const d = c.unitDefinition
      if (
        (units[d.abbreviation] &&
          ![
            'mg',
            'pint',
            'quart',
            'gallon',
            'bag',
            'bottle',
            'jar',
            'can',
            'box',
            'pack',
            'roll',
            'bundle',
          ].includes(d.abbreviation)) ||
        d.category !== 'count' ||
        !Number.isFinite(d.factor) ||
        d.factor <= 0
      )
        continue
      registry[d.abbreviation] = { category: 'count', factor: d.factor }
    }
  return registry
}
export function convert(
  q: number | string,
  from: string,
  to: string,
  conversions: any[] = [],
) {
  q = number(q, 'Quantity')
  const registry = ingredientUnits(conversions)
  const a = registry[from],
    b = registry[to]
  if (!a || !b)
    throw new Error('Choose a supported unit or define a custom count unit.')
  if (from === to) return q
  // An explicit ingredient-specific measurement takes precedence over a generic measure.
  const direct = conversions.find(
    (c) =>
      c.verified &&
      ((c.from === from && c.to === to) || (c.from === to && c.to === from)),
  )
  if (direct) {
    const x = number(direct.amountFrom, 'Conversion from quantity', 0.000001)
    const y = number(direct.amountTo, 'Conversion to quantity', 0.000001)
    return direct.from === from ? (q * y) / x : (q * x) / y
  }
  if (a.category === b.category && a.factor > 0 && b.factor > 0)
    return (q * a.factor) / b.factor
  const key = (unit: string) =>
    registry[unit].factor > 0 ? registry[unit].category : unit
  // Contextual package definitions can chain, e.g. case -> bottle -> gallon.
  // Dimension nodes include built-in factors, never an assumed package size.
  const graph = new Map<string, { to: string; ratio: number }[]>()
  for (const c of conversions) {
    if (!c.verified || !registry[c.from] || !registry[c.to]) continue
    const x =
      number(c.amountFrom, 'Conversion from quantity', 0.000001) *
      (registry[c.from].factor || 1)
    const y =
      number(c.amountTo, 'Conversion to quantity', 0.000001) *
      (registry[c.to].factor || 1)
    const f = key(c.from),
      t = key(c.to)
    graph.set(f, [...(graph.get(f) || []), { to: t, ratio: y / x }])
    graph.set(t, [...(graph.get(t) || []), { to: f, ratio: x / y }])
  }
  const ratios = new Map<string, number>([[key(from), 1]])
  const queue = [key(from)]
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index]
    for (const edge of graph.get(node) || []) {
      const ratio = ratios.get(node)! * edge.ratio
      const existing = ratios.get(edge.to)
      if (existing !== undefined) {
        if (
          Math.abs(existing - ratio) >
          1e-9 * Math.max(Math.abs(existing), Math.abs(ratio))
        )
          throw new Error('Conflicting verified conversions require review.')
      } else {
        ratios.set(edge.to, ratio)
        queue.push(edge.to)
      }
    }
  }
  const ratio = ratios.get(key(to))
  if (ratio !== undefined)
    return (q * (a.factor || 1) * ratio) / (b.factor || 1)
  throw new Error(
    `A verified unit conversion from ${from} to ${to} is required.`,
  )
}
export const baseUnit = (unit: string, conversions: any[] = []) => {
  const registry = ingredientUnits(conversions)
  if (!registry[unit]) throw new Error('Choose a supported unit.')
  return (
    { weight: 'g', volume: 'ml', count: 'each', length: 'm' } as Record<
      string,
      string
    >
  )[registry[unit].category]
}

export function number(value: unknown, label: string, min = 0) {
  const n =
    typeof value === 'string' && value.includes('/')
      ? parseQuantity(value)
      : Number(value)
  if (!Number.isFinite(n) || n < min)
    throw new Error(`${label} must be at least ${min}.`)
  return n
}
export function recipeCost(
  recipe: Item,
  ingredients: Item[],
  _seen: string[] = [],
): number {
  return costBreakdown(recipe, ingredients).total
}

export function packagingLines(product: Item): any[] {
  return (
    product.packagingLines ??
    (product.packagingId
      ? [
          {
            ingredientId: product.packagingId,
            quantity: product.packagingQuantity ?? 1,
            unit: 'each',
            required: true,
          },
        ]
      : [])
  )
}
export function costBreakdown(
  recipe: Item,
  ingredients: Item[],
  options: any = {},
) {
  const multiplier = number(
    options.multiplier ?? 1,
    'Batch multiplier',
    0.000001,
  )
  const plannedYield =
    number(recipe.yield, 'Recipe yield', 0.000001) * multiplier
  const actualYield = number(
    options.actualYield ?? plannedYield,
    'Actual yield',
    0.000001,
  )
  const missingCosts = (recipe.lines || []).filter((line: any) => {
    const i = ingredients.find((i) => i.id === line.ingredientId)
    if (!i || i.needsCostSetup) return true
    const price = i.currentCost ?? i.cost
    if (
      price == null ||
      price === '' ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0
    )
      return true
    try {
      convert(line.quantity, line.unit, i.unit, i.conversions)
      return false
    } catch {
      return true
    }
  }).length
  if (
    missingCosts &&
    (recipe.importProvenance ||
      (recipe.lines || []).some(
        (l: any) =>
          ingredients.find((i) => i.id === l.ingredientId)?.needsCostSetup,
      ))
  )
    throw new Error(
      `Cost incomplete — ${missingCosts} ingredient${missingCosts === 1 ? '' : 's'} need setup.`,
    )
  const lines = (recipe.lines || []).map((line: any) => {
    const i = ingredients.find((i) => i.id === line.ingredientId)
    if (!i) throw new Error('Ingredient is unavailable.')
    const quantity = number(line.quantity, 'Recipe quantity') * multiplier
    const normalized = convert(quantity, line.unit, i.unit, i.conversions)
    const unitCost = number(
      options.historical ? i.cost : (i.currentCost ?? i.cost),
      'Ingredient cost',
    )
    return {
      ingredientId: i.id,
      name: i.name,
      quantity,
      unit: line.unit,
      normalized,
      storageUnit: i.unit,
      unitCost,
      cost: normalized * unitCost,
    }
  })
  const ingredient = lines.reduce((s: number, l: any) => s + l.cost, 0)
  const laborMinutes = number(
    options.laborMinutes ?? Number(recipe.laborMinutes || 0) * multiplier,
    'Labor minutes',
  )
  const laborRate = number(recipe.laborRate ?? 18, 'Labor rate')
  const labor = (laborMinutes / 60) * laborRate
  const product = options.product as Item | undefined
  const unitsPerPackage = number(
    product?.unitsPerPackage ?? 1,
    'Units per package',
    0.000001,
  )
  const packages = actualYield / unitsPerPackage
  const packaging = product
    ? packagingLines(product).map((line: any) => {
        const i = ingredients.find(
          (i) => i.id === line.ingredientId && i.usedAs === 'packaging',
        )
        if (!i) throw new Error('Choose an available packaging item.')
        const perPackage = number(line.quantity, 'Packaging quantity')
        const quantity =
          convert(perPackage, line.unit || 'each', i.unit, i.conversions) *
          packages
        const unitCost = number(
          options.historical ? i.cost : (i.currentCost ?? i.cost),
          'Packaging cost',
        )
        return {
          ...line,
          name: i.name,
          inventoryQuantity: quantity,
          storageUnit: i.unit,
          unitCost,
          cost: quantity * unitCost,
        }
      })
    : []
  const packagingCost =
    packaging.reduce((s: number, l: any) => s + l.cost, 0) +
    number(recipe.packagingCost || 0, 'Batch packaging') * multiplier
  const overheadValue = number(recipe.overhead || 0, 'Overhead')
  const overheadMode = recipe.overheadMode || 'batch'
  if (!['batch', 'unit', 'percent'].includes(overheadMode))
    throw new Error('Choose a valid overhead method.')
  const overhead =
    overheadMode === 'percent'
      ? ((ingredient + packagingCost + labor) * overheadValue) / 100
      : overheadMode === 'unit'
        ? overheadValue * actualYield
        : overheadValue * multiplier
  const wastePercent = number(recipe.wastePercent || 0, 'Waste percentage')
  if (wastePercent > 100)
    throw new Error('Waste percentage must not exceed 100%.')
  const subtotal = ingredient + packagingCost + labor + overhead
  const waste =
    recipe.wasteMode === 'actual'
      ? number(
          options.wasteCost ?? recipe.wasteCost ?? 0,
          'Actual waste cost',
        ) * (options.wasteCost === undefined ? multiplier : 1)
      : (subtotal * wastePercent) / 100
  const total = subtotal + waste
  return {
    lines,
    packaging,
    ingredient,
    packagingCost,
    laborMinutes,
    laborRate,
    labor,
    overhead,
    waste,
    total,
    plannedYield,
    actualYield,
    packages,
    unitsPerPackage,
    perItem: total / actualYield,
    perPackage: total / packages,
  }
}
export function productCosting(product: Item, workspace: Workspace) {
  if (product.workflow === 'resale') {
    if (product.stockCostKnown !== true)
      throw new Error('Receive resale stock to establish its cost.')
    return costBreakdown(
      {
        id: 'resale-basis',
        name: 'Received stock basis',
        yield: 1,
        lines: [],
        overhead: number(product.cost, 'Stock cost'),
        laborRate: 0,
      },
      [],
      { product: { ...product, unitsPerPackage: 1, packagingLines: [] } },
    )
  }
  const recipe = workspace.recipes.find((r) => r.id === product.recipeId)
  if (!recipe) throw new Error('Choose a recipe.')
  return costBreakdown(recipe, workspace.ingredients, { product })
}
export type TaxRate = {
  id: string
  name: string
  jurisdiction: string
  jurisdictionType?: string
  ratePercent: number
  behavior: 'inclusive' | 'exclusive'
  order?: number
  compound?: boolean
  active?: boolean
  start?: string
  end?: string
  appliesTo?: 'all_products' | 'product_category' | 'selected_products'
  category?: string
  productIds?: string[]
  taxAccountId?: string
  notes?: string
}
export function validateDate(date: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new Error('Use a valid calendar date.')
  return date
}
export function validateTaxRates(rates: TaxRate[]) {
  if (
    !Array.isArray(rates) ||
    new Set(rates.map((r) => r.id)).size !== rates.length
  )
    throw new Error('Tax rates require unique IDs.')
  for (const r of rates) {
    if (!r.id || !r.name || !r.jurisdiction)
      throw new Error('Tax name and jurisdiction are required.')
    if (number(r.ratePercent, 'Tax rate') > 100)
      throw new Error('Tax rate must not exceed 100%.')
    if (!['inclusive', 'exclusive'].includes(r.behavior))
      throw new Error('Choose a tax behavior.')
    number(r.order ?? 0, 'Tax calculation order')
    for (const date of [r.start, r.end]) if (date) validateDate(date)
    if (r.start && r.end && r.start > r.end)
      throw new Error('Tax end date precedes start date.')
  }
  return rates
}
/** A deliberate sale-level rate selection overrides inheritance for this calculation only. */
export function saleTaxProduct(product: Item, taxRateIds: unknown): Item {
  return Array.isArray(taxRateIds)
    ? { ...product, taxSource: undefined, taxRateIds }
    : product
}
export function applicableTaxes(
  product: Item,
  business: Item,
  date = new Date().toISOString().slice(0, 10),
): TaxRate[] {
  const inherited =
    product.taxSource === 'category'
      ? categoryTaxState(product, business)
      : undefined
  if (inherited?.issue) throw new Error(inherited.issue)
  if (
    !inherited &&
    (product.taxStatus === 'exempt' || product.taxStatus === 'zero_rated')
  )
    return []
  const configured = configuredTaxRates(business)
  const result = configured
    .filter((r) => !inherited || inherited.ids.includes(r.id))
    .filter(
      (r) =>
        r.active !== false &&
        (!r.start || r.start <= date) &&
        (!r.end || r.end >= date) &&
        (!inherited && Array.isArray(product.taxRateIds)
          ? product.taxRateIds.includes(r.id)
          : !r.appliesTo ||
            r.appliesTo === 'all_products' ||
            (r.appliesTo === 'product_category' &&
              (inherited
                ? Boolean(r.category) &&
                  (r.category === inherited.category?.name ||
                    inherited.category?.previousNames?.includes(
                      r.category || '',
                    ))
                : r.category === product.category)) ||
            (r.appliesTo === 'selected_products' &&
              r.productIds?.includes(product.id))),
    )
    .filter(
      (r) =>
        (inherited ? [] : product.taxAssignments || []).find(
          (a: any) => a.taxRateId === r.id,
        )?.active !== false,
    )
    .map((r) => {
      const assignment = (inherited ? [] : product.taxAssignments || []).find(
        (a: any) => a.taxRateId === r.id,
      )
      return {
        ...r,
        order: assignment?.order ?? r.order,
        behavior:
          product.priceTaxMode === 'before'
            ? 'exclusive'
            : product.priceTaxMode === 'includes'
              ? 'inclusive'
              : assignment?.behavior || r.behavior,
      }
    })
  if (inherited && !result.length)
    throw new Error(
      'No configured category tax treatment applies on this date. Review jurisdiction, scope and effective dates; this is not tax exempt.',
    )
  return result
}
export const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100
export function calculateTax(enteredPrice: number, rates: TaxRate[]) {
  number(enteredPrice, 'Selling price')
  validateTaxRates(rates)
  let prior = 0
  const factors = [...rates]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
    .map((r) => {
      const baseFactor = r.compound ? 1 + prior : 1
      const factor = (baseFactor * Number(r.ratePercent)) / 100
      prior += factor
      return { ...r, baseFactor, factor }
    })
  const divisor =
    1 +
    factors
      .filter((r) => r.behavior === 'inclusive')
      .reduce((s, r) => s + r.factor, 0)
  const revenueExact = enteredPrice / divisor
  const revenue = roundMoney(revenueExact)
  // Allocate each behavior's total by largest remainder: no negative penny taxes
  // and no tax assigned to a zero-rate jurisdiction.
  const allocated = new Map<string, number>()
  for (const behavior of ['inclusive', 'exclusive'] as const) {
    const group = factors.filter((r) => r.behavior === behavior)
    const totalCents =
      behavior === 'inclusive'
        ? Math.round(roundMoney(enteredPrice) * 100) - Math.round(revenue * 100)
        : Math.round(
            roundMoney(group.reduce((s, r) => s + revenueExact * r.factor, 0)) *
              100,
          )
    const rows = group.map((r) => ({
      id: r.id,
      exact: revenueExact * r.factor * 100,
      cents: Math.floor(revenueExact * r.factor * 100 + 1e-9),
    }))
    let remaining = totalCents - rows.reduce((s, r) => s + r.cents, 0)
    for (const r of [...rows].sort(
      (a, b) => b.exact - b.cents - (a.exact - a.cents),
    )) {
      if (remaining > 0 && r.exact > 0) {
        r.cents++
        remaining--
      }
    }
    for (const r of rows) allocated.set(r.id, r.cents / 100)
  }
  const snapshot = factors.map((r) => ({
    ...r,
    taxableBase: revenueExact * r.baseFactor,
    amount: allocated.get(r.id) || 0,
    exactAmount: revenueExact * r.factor,
  }))
  const tax = roundMoney(snapshot.reduce((s, r) => s + r.amount, 0))
  return {
    enteredPrice,
    revenue,
    revenueExact,
    tax,
    customerTotal: roundMoney(revenue + tax),
    snapshot,
    divisor,
  }
}
export function profitability(
  product: Item,
  cost: number,
  business: Item,
  price = Number(product.price || 0),
) {
  const tax = calculateTax(price, applicableTaxes(product, business))
  const profit = tax.revenueExact - cost
  const margin = tax.revenueExact > 0 ? (profit / tax.revenueExact) * 100 : 0
  const target = number(product.targetMargin ?? 65, 'Target margin')
  if (target >= 100) throw new Error('Target margin must be below 100%.')
  return {
    ...tax,
    profit,
    margin,
    suggested: (cost / (1 - target / 100)) * tax.divisor,
  }
}

export const money = (n: number) =>
  !Number.isFinite(n)
    ? 'Unpriced'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(Number.isFinite(n) ? n : 0)
export const allergens = [
  'Milk',
  'Egg',
  'Fish',
  'Crustacean shellfish',
  'Tree nuts',
  'Peanuts',
  'Wheat',
  'Soybeans',
  'Sesame',
]
export function csv(rows: Item[]) {
  if (!rows.length) return ''
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  return [
    keys,
    ...rows.map((r) =>
      keys.map((k) =>
        typeof r[k] === 'object' ? JSON.stringify(r[k]) : (r[k] ?? ''),
      ),
    ),
  ]
    .map((row) =>
      row
        .map(
          (v) =>
            '"' +
            String(
              typeof v === 'string' && /^[=+@]/.test(v) ? "'" + v : v,
            ).replaceAll('"', '""') +
            '"',
        )
        .join(','),
    )
    .join('\n')
}
