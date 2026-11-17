import { isPackaging } from '@/lib/pantry-category'
import { useState } from 'react'
import { Package, Wheat, Leaf, Brush, CookingPot } from 'lucide-react'
import type { Item } from '@/lib/domain'
import {
  recipeCategory,
  recipeCategories as availableRecipeCategories,
  type RecipeCategory,
} from '@/lib/recipe-categories'
import { RecipeCategoryIcon } from './recipe-category-icon'
import './pantry-cards.css'
export function PantryPhoto({
  item,
  assets = [],
  className = '',
  kind = 'pantry',
  recipeCategories,
  presentation,
}: {
  item: Item
  assets?: Item[]
  className?: string
  kind?: 'pantry' | 'product' | 'recipe'
  presentation?: 'ingredient-card' | 'product-card'
  recipeCategories?: RecipeCategory[]
}) {
  const [failed, setFailed] = useState('')
  const [loaded, setLoaded] = useState('')
  const [opaque, setOpaque] = useState('')
  const asset = assets.find((a) => a.id === item.imageAssetId)
  const originalSrc = asset?.fileUrl
  const previewWidth = className.includes('detail-photo')
    ? 800
    : presentation || kind !== 'pantry' || className.includes('card')
      ? 480
      : 128
  const src = originalSrc?.startsWith('/api/workspace?asset=')
    ? `${originalSrc}&imageWidth=${previewWidth}`
    : originalSrc
  const category =
    kind === 'recipe'
      ? recipeCategory(
          item,
          recipeCategories ||
            availableRecipeCategories({ settings: [], recipes: [item] }),
        )
      : undefined
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
    <span
      className={`pantry-photo ${kind === 'recipe' ? 'recipe-category-photo' : ''} ${className} ${presentation || ''}`}
      data-photo-state={
        !src || failed === src
          ? 'missing'
          : loaded === src
            ? 'image'
            : 'loading'
      }
      aria-busy={!!src && failed !== src && loaded !== src}
    >
      {presentation === 'product-card' &&
        opaque === src &&
        src &&
        loaded === src &&
        failed !== src && (
          <img
            className="product-photo-extension"
            src={src}
            alt=""
            aria-hidden="true"
            decoding="async"
          />
        )}
      {src && failed !== src ? (
        <img
          className="photo-foreground"
          src={src}
          alt={`Photo of ${item.name}`}
          loading="lazy"
          decoding="async"
          width={asset?.widthPx || 400}
          height={asset?.heightPx || 300}
          onLoad={(event) => {
            setLoaded(src)
            if (presentation !== 'product-card') return
            // A tiny alpha check uses the already decoded thumbnail. Transparent
            // or unreadable cross-origin sources retain the clean card surface.
            try {
              const canvas = document.createElement('canvas')
              canvas.width = canvas.height = 16
              const context = canvas.getContext('2d')
              if (!context) return
              context.drawImage(event.currentTarget, 0, 0, 16, 16)
              const pixels = context.getImageData(0, 0, 16, 16).data
              for (let i = 3; i < pixels.length; i += 4) {
                if (pixels[i] < 255) return
              }
              setOpaque(src)
            } catch {
              // Contain-only fallback for sources that disallow pixel reads.
            }
          }}
          onError={() => setFailed(src)}
        />
      ) : kind === 'recipe' && item.workflow !== 'handmade' ? (
        <RecipeCategoryIcon
          icon={category?.icon}
          label={`${category?.name || 'Uncategorized'} recipe icon for ${item.name}`}
        />
      ) : (
        <>
          <Icon
            aria-label={`${kind !== 'pantry' ? kind : isPackaging(item) ? 'packaging' : item.usedAs || 'ingredient'} icon for ${item.name}`}
            size={28}
          />
          {kind === 'product' && className.includes('detail-photo') && (
            <span>No product image yet</span>
          )}
        </>
      )}
    </span>
  )
}
