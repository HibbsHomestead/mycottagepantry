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
}: {
  item: Item
  assets?: Item[]
  className?: string
  kind?: 'pantry' | 'product' | 'recipe'
  recipeCategories?: RecipeCategory[]
}) {
  const [failed, setFailed] = useState('')
  const src = assets.find((a) => a.id === item.imageAssetId)?.fileUrl
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
      className={`pantry-photo ${kind === 'recipe' ? 'recipe-category-photo' : ''} ${className}`}
    >
      {src && failed !== src ? (
        <img
          src={src}
          alt={`Photo of ${item.name}`}
          loading="lazy"
          onError={() => setFailed(src)}
        />
      ) : kind === 'recipe' && item.workflow !== 'handmade' ? (
        <RecipeCategoryIcon
          icon={category?.icon}
          label={`${category?.name || 'Uncategorized'} recipe icon for ${item.name}`}
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
