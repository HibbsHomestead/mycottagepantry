import type { Item } from './domain'
import { tracksFinishedStock, workflowOf } from './product-workflows'
import { productCategoryName } from './product-categories'
export type ProductCriteria = {
  search: string
  category: string
  type: string
  status: string
  min: string
  max: string
  image: string
  stock: string
  sort: string
  direction: string
}
export const defaultProductCriteria: ProductCriteria = {
  search: '',
  category: '',
  type: '',
  status: '',
  min: '',
  max: '',
  image: '',
  stock: '',
  sort: '',
  direction: 'asc',
}
export const productCategoryKey = (p: Item) =>
  p.productCategoryId || p.category || 'uncategorized'
export function productNumber(value: unknown) {
  if (value == null || String(value).trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}
export function browseProducts(
  products: Item[],
  business: Item,
  c: ProductCriteria,
) {
  const rows = products.filter((p) => {
    const price = productNumber(p.price)
    return (
      String(p.name).toLowerCase().includes(c.search.trim().toLowerCase()) &&
      (!c.category || productCategoryKey(p) === c.category) &&
      (!c.type || workflowOf(p) === c.type) &&
      (!c.status || (p.archived ? 'Archived' : p.status) === c.status) &&
      (!c.min || (price !== undefined && price >= Number(c.min))) &&
      (!c.max || (price !== undefined && price <= Number(c.max))) &&
      (!c.image || Boolean(p.imageAssetId) === (c.image === 'has')) &&
      (!c.stock ||
        (tracksFinishedStock(p) &&
          p.trackInventory !== false &&
          productNumber(p.quantity) !== undefined &&
          (c.stock === 'available'
            ? Number(p.quantity) > 0
            : Number(p.quantity) <= 0)))
    )
  })
  if (!c.sort) return rows
  const value = (p: Item): string | number | undefined => {
    if (c.sort === 'price') return productNumber(p.price)
    if (c.sort === 'createdAt' || c.sort === 'updatedAt') {
      const n = Date.parse(p[c.sort])
      return Number.isFinite(n) ? n : undefined
    }
    return c.sort === 'category' ? productCategoryName(p, business) : p.name
  }
  return rows.sort((a, b) => {
    const av = value(a),
      bv = value(b)
    // Missing values stay last in either direction. IDs stabilize equal names.
    if (av === undefined || bv === undefined)
      return av === bv
        ? String(a.id).localeCompare(String(b.id))
        : av === undefined
          ? 1
          : -1
    const result =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, {
            sensitivity: 'base',
            numeric: true,
          })
    return (
      result * (c.direction === 'desc' ? -1 : 1) ||
      String(a.name).localeCompare(String(b.name)) ||
      String(a.id).localeCompare(String(b.id))
    )
  })
}
