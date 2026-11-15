import type { ReactNode } from 'react'
import type { Item } from '@/lib/domain'
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from './ui/dialog'
import { PantryPhoto } from './pantry-photo'

/** The existing Product Details structure, shared with Ingredient Details. */
export function ItemDetailHeader({
  name,
  children,
  close = false,
}: {
  name: string
  close?: boolean
  children: ReactNode
}) {
  return (
    <DialogHeader>
      <div className="eyebrow">COTTAGE PANTRY · YOUR OVEN</div>
      {close && (
        <DialogClose className="product-header-close" aria-label="Close">
          ×
        </DialogClose>
      )}
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
  footer,
}: {
  item: Item
  assets?: Item[]
  kind?: 'pantry' | 'product'
  children: ReactNode
  footer?: ReactNode
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
      {footer && <div className="product-detail-footer">{footer}</div>}
    </div>
  )
}
