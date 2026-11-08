import type { ReactNode } from 'react'
import type { Item } from '@/lib/domain'
import { DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { PantryPhoto } from './pantry-photo'

/** The existing Product Details structure, shared with Ingredient Details. */
export function ItemDetailHeader({
  name,
  children,
}: {
  name: string
  children: ReactNode
}) {
  return (
    <DialogHeader>
      <div className="eyebrow">COTTAGE PANTRY · YOUR OVEN</div>
      <DialogTitle>{name}</DialogTitle>
      <DialogDescription>{children}</DialogDescription>
    </DialogHeader>
  )
}

export function ItemDetailLayout({
  item,
  assets,
  kind = 'pantry',
  children,
  photoDetails,
}: {
  item: Item
  assets?: Item[]
  kind?: 'pantry' | 'product'
  children: ReactNode
  photoDetails?: ReactNode
}) {
  const photo = (
    <PantryPhoto
      className="product-detail-photo"
      item={item}
      assets={assets}
      kind={kind}
    />
  )
  return (
    <div className="product-detail-layout">
      <div className="product-detail-information">{children}</div>
      {photoDetails ? (
        <div
          className={
            kind === 'product'
              ? 'product-detail-media'
              : 'ingredient-detail-media'
          }
        >
          {photo}
          {photoDetails}
        </div>
      ) : (
        photo
      )}
    </div>
  )
}
