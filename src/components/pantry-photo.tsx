import { isPackaging } from '@/lib/pantry-category'
import { useState } from 'react'
import { Package, Wheat, Leaf, Brush, CookingPot } from 'lucide-react'
import type { Item } from '@/lib/domain'
import './pantry-cards.css'
export function PantryPhoto({
  item,
  assets = [],
  className = '',
  kind = 'pantry',
}: {
  item: Item
  assets?: Item[]
  className?: string
  kind?: 'pantry' | 'product' | 'recipe'
}) {
  const [failed, setFailed] = useState('')
  const src = assets.find((a) => a.id === item.imageAssetId)?.fileUrl
  const Icon =
    item.usedAs === 'material' || item.workflow === 'handmade'
      ? Brush
      : kind === 'recipe'
        ? CookingPot
        : kind === 'product' || isPackaging(item)
          ? Package
          : item.usedAs === 'supply'
            ? Brush
            : /flour|grain/i.test(item.category || '')
              ? Wheat
              : Leaf
  return (
    <span className={`pantry-photo ${className}`}>
      {src && failed !== src ? (
        <img
          src={src}
          alt={`Photo of ${item.name}`}
          loading="lazy"
          onError={() => setFailed(src)}
        />
      ) : (
        <Icon
          aria-label={`${kind !== 'pantry' ? kind : isPackaging(item) ? 'packaging' : item.usedAs || 'ingredient'} icon for ${item.name}`}
          size={28}
        />
      )}
    </span>
  )
}
