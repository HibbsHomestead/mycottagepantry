import { configuredTaxRates } from './tax-configuration'
import { z } from 'zod'
import type { Item, TaxRate } from './domain'

export const productCategorySchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  classification: z.enum(['food', 'non_food']).nullable(),
  active: z.boolean().optional(),
  previousNames: z.array(z.string().max(100)).max(100).optional(),
})
export type ProductCategory = z.infer<typeof productCategorySchema>
export const categoryListSchema = z.array(productCategorySchema).max(500)
export const categoryMappingsSchema = z
  .object({
    food: z.array(z.string().min(1)).max(100).optional(),
    non_food: z.array(z.string().min(1)).max(100).optional(),
  })
  .strict()
export type CategoryMappings = z.infer<typeof categoryMappingsSchema>
export const classificationLabel = (value: unknown) =>
  value === 'food'
    ? 'Food'
    : value === 'non_food'
      ? 'Non-food'
      : 'Not classified — owner review needed'
export const normalizedCategoryName = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLowerCase()
export function productCategoryName(product: Item, business: Item) {
  if (!product.productCategoryId) return product.category || 'Not assigned'
  const category = (business.productCategories || []).find(
    (c: ProductCategory) => c.id === product.productCategoryId,
  )
  return category
    ? `${category.name}${category.active === false ? ' (inactive)' : ''}`
    : 'Saved category unavailable'
}
export function categoryTaxState(product: Item, business: Item) {
  const category: ProductCategory | undefined = (
    business.productCategories || []
  ).find((c: ProductCategory) => c.id === product.productCategoryId)
  const ids: string[] = category?.classification
    ? business.categoryTaxMappings?.[category.classification] || []
    : []
  const rates: TaxRate[] = configuredTaxRates(business).filter((r: TaxRate) =>
    ids.includes(r.id),
  )
  const issue = !category
    ? 'Product category not configured.'
    : category.active === false
      ? 'Saved product category is inactive.'
      : !category.classification
        ? 'Category classification not configured; owner review needed.'
        : !ids.length
          ? 'Tax treatment not configured. Not configured does not mean tax exempt.'
          : rates.length !== ids.length || rates.some((r) => r.active === false)
            ? 'Configured tax treatment is unavailable or inactive.'
            : ''
  return { category, ids, rates, issue }
}
/** Display and server confirmation use the same affected product set, including preserved legacy assignments. */
export function categoryImpact(
  products: Item[],
  categories: ProductCategory[],
  categoryId?: string,
) {
  const ids = new Set(categories.map((c) => c.id))
  return products.filter((p) =>
    categoryId
      ? p.productCategoryId === categoryId
      : ids.has(p.productCategoryId),
  )
}
