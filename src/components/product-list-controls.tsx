import { CookingPot, Gift, Package, Scissors } from 'lucide-react'
import type { Item } from '@/lib/domain'
import { workflowOf } from '@/lib/product-workflows'
import { productSortOptions, type ProductSort } from '@/lib/product-list'
import { SummaryCards } from './summary-cards'

export function ProductSummaries({ products }: { products: Item[] }) {
  const count = (type: string) =>
    products.filter((p) => workflowOf(p) === type).length
  return (
    <SummaryCards
      className="product-summaries"
      label="Product summaries before search and category filters"
      cards={[
        {
          label: 'Total products',
          value: products.length,
          icon: <Package size={21} />,
        },
        {
          label: 'Food products',
          value: count('food'),
          icon: <CookingPot size={21} />,
        },
        {
          label: 'Handmade products',
          value: count('handmade'),
          icon: <Scissors size={21} />,
        },
        {
          label: 'Resale products & kits',
          value: (
            <>
              <span>Resale: {count('resale')}</span>
              <span>Baskets: {count('kit')}</span>
            </>
          ),
          icon: <Gift size={21} />,
        },
      ]}
    />
  )
}
export function ProductSortControl({
  value,
  onChange,
}: {
  value: ProductSort
  onChange: (value: ProductSort) => void
}) {
  return (
    <label className="product-sort-control">
      Sort
      <select
        aria-label="Sort products"
        value={value}
        onChange={(event) => onChange(event.target.value as ProductSort)}
      >
        {productSortOptions.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}
