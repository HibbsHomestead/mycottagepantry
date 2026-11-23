import { handmadeEstimate } from './handmade'
import {
  packagingLines,
  applicableTaxes,
  priceTaxLabel,
  productCosting,
  profitability,
  type Item,
  type Workspace,
} from './domain'
// Presentation guard: missing source prices must not look like a zero-cost product.
// All amounts still come from the existing costing and profitability functions.
export function cardCost(product: Item, workspace: Workspace) {
  if (['resale', 'kit'].includes(product.workflow)) {
    try {
      return { cost: productCosting(product, workspace, { allowResaleEstimate: true }).perPackage }
    } catch (error) {
      return {
        reason:
          product.workflow === 'kit'
            ? (error as Error).message
            : 'Receive resale stock to establish its cost.',
      }
    }
  }
  if (product.workflow === 'handmade') {
    try {
      return { cost: handmadeEstimate(product, workspace).unit }
    } catch (error) {
      return { reason: (error as Error).message }
    }
  }
  const recipe = workspace.recipes.find((r) => r.id === product.recipeId)
  if (!recipe?.lines?.length || product.needsCostSetup)
    return { reason: 'Connect a recipe with ingredient cost details.' }
  const sources = [...recipe.lines, ...packagingLines(product)]
  if (
    sources.some((line) => {
      const item = workspace.ingredients.find((i) => i.id === line.ingredientId)
      const price = item?.currentCost ?? item?.cost
      return (
        !item ||
        item.needsCostSetup ||
        price == null ||
        String(price).trim() === '' ||
        !Number.isFinite(Number(price)) ||
        Number(price) < 0
      )
    })
  )
    return { reason: 'Review ingredient and packaging cost details.' }
  try {
    const cost = productCosting(product, workspace, { allowResaleEstimate: true }).perPackage
    return Number.isFinite(cost)
      ? { cost }
      : { reason: 'Review recipe quantities and cost details.' }
  } catch (error) {
    return {
      reason:
        error instanceof Error ? error.message : 'Review recipe cost details.',
    }
  }
}

export const productSortOptions = [
  ['name-asc', 'Name: A–Z'],
  ['name-desc', 'Name: Z–A'],
  ['price-asc', 'Price: low to high'],
  ['price-desc', 'Price: high to low'],
  ['cost-asc', 'Cost: low to high'],
  ['cost-desc', 'Cost: high to low'],
  ['profit-asc', 'Profit excluding tax: low to high'],
  ['profit-desc', 'Profit excluding tax: high to low'],
  ['margin-asc', 'Margin: low to high'],
  ['margin-desc', 'Margin: high to low'],
] as const
export type ProductSort = (typeof productSortOptions)[number][0]
export function productListMetrics(product: Item, workspace: Workspace) {
  const result = cardCost(product, workspace)
  const cost =
    result.cost !== undefined && Number.isFinite(result.cost)
      ? result.cost
      : undefined
  const raw = product.price
  const price =
    raw == null ||
    String(raw).trim() === '' ||
    !Number.isFinite(Number(raw)) ||
    Number(raw) < 0
      ? undefined
      : Number(raw)
  let pricing: ReturnType<typeof profitability> | undefined
  if (cost !== undefined && price !== undefined) {
    try {
      const resolved = profitability(product, cost, workspace.settings[0])
      if (Number.isFinite(resolved.profit) && Number.isFinite(resolved.margin))
        pricing = resolved
    } catch {
      /* Display and sort the same unavailable state. */
    }
  }
  let taxLabel = 'Needs tax setup'
  try {
    taxLabel = priceTaxLabel(pricing?.snapshot ?? applicableTaxes(product, workspace.settings[0]))
  } catch { /* A missing setup must not be shown as tax exempt. */ }
  return { cost, price, pricing, taxLabel, reason: result.reason }
}
export function sortProducts(
  products: Item[],
  workspace: Workspace,
  sort: ProductSort,
) {
  const [key, direction] = sort.split('-')
  const metrics =
    key === 'name'
      ? null
      : new Map(products.map((p) => [p.id, productListMetrics(p, workspace)]))
  const tie = (a: Item, b: Item) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
    a.id.localeCompare(b.id)
  return [...products].sort((a, b) => {
    if (key === 'name')
      return (
        (direction === 'desc' ? -1 : 1) *
          a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
        a.id.localeCompare(b.id)
      )
    const value = (p: Item) => {
      const m = metrics!.get(p.id)!
      return key === 'price'
        ? m.price
        : key === 'cost'
          ? m.cost
          : key === 'profit'
            ? m.pricing?.profit
            : m.pricing?.margin
    }
    const av = value(a),
      bv = value(b)
    if (av === undefined) return bv === undefined ? tie(a, b) : 1
    if (bv === undefined) return -1
    return (av - bv) * (direction === 'desc' ? -1 : 1) || tie(a, b)
  })
}
