import type { Item } from './domain'
export const productWorkflows = [
  { value: 'food', label: 'Food / recipe-made' },
  { value: 'handmade', label: 'Handmade / design-made' },
  { value: 'resale', label: 'Resale / purchased' },
] as const
export function workflowOf(product: Item) {
  return product.workflow || (product.recipeId ? 'food' : 'unclassified')
}
export const tracksFinishedStock = (product: Item) =>
  ['handmade', 'resale'].includes(product.workflow) ||
  product.foodStockEnabled === true ||
  (product.workflow === 'kit' && product.stockCostKnown === true)
