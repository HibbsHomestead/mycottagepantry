import {
  BookOpen,
  Sandwich,
  Cookie,
  CakeSlice,
  CupSoda,
  Candy,
  Croissant,
  CookingPot,
  Cherry,
  Wheat,
  Milk,
  Bean,
  Cake,
  Coffee,
  Soup,
  Pizza,
  Grid2X2,
} from 'lucide-react'
import type { RecipeIconName } from '@/lib/recipe-categories'
import './recipe-categories.css'

export const recipeIconLabels: Record<RecipeIconName, string> = {
  bread: 'Bread',
  cookie: 'Cookie',
  cake: 'Cake',
  muffin: 'Muffin',
  pie: 'Pie',
  pastry: 'Pastry',
  bars: 'Bars',
  cheesecake: 'Cheesecake',
  candy: 'Candy',
  frosting: 'Frosting',
  filling: 'Filling',
  spread: 'Spread',
  jam: 'Preserves',
  seasoning: 'Dry mix',
  savory: 'Savory',
  drink: 'Beverage',
  other: 'Other',
}
const icons = {
  bread: Sandwich,
  cookie: Cookie,
  cake: Cake,
  muffin: Coffee,
  pie: Pizza,
  pastry: Croissant,
  bars: Grid2X2,
  cheesecake: CakeSlice,
  candy: Candy,
  frosting: Milk,
  filling: Soup,
  spread: Bean,
  jam: Cherry,
  seasoning: Wheat,
  savory: CookingPot,
  drink: CupSoda,
  other: BookOpen,
}
const tones: Record<RecipeIconName, string> = {
  bread: 'gold',
  cookie: 'terracotta',
  cake: 'purple',
  muffin: 'gold',
  pie: 'terracotta',
  pastry: 'gold',
  bars: 'terracotta',
  cheesecake: 'purple',
  candy: 'purple',
  frosting: 'blue',
  filling: 'purple',
  spread: 'sage',
  jam: 'terracotta',
  seasoning: 'sage',
  savory: 'sage',
  drink: 'blue',
  other: 'neutral',
}
const drawings: Partial<Record<RecipeIconName, string>> = {
  bread: 'M5 19h14V9c0-4-3-6-7-6S5 5 5 9v10Zm3-12 2 4m2-5 2 4m2-3 2 4M5 15h14',
  muffin:
    'm6 12 2 9h8l2-9M6 12c-4-1-4-6 0-7 1-4 7-4 9-1 5-1 7 6 3 8H6Zm4 3 1 4m3-4-1 4',
  pie: 'M3 13h18l-3 7H6l-3-7Zm1-3c3-8 13-8 16 0M7 6l10 6M12 4l8 5M4 10l6-6M8 12l8-7',
  frosting: 'm5 19 3-9 7 7-9 3-2 2m4-12 3-5 3 1 3-2 3 3-2 3 1 3-4 4M8 10l7 7',
  spread: 'M7 8h10l2 4v9H5v-9l2-4Zm0-4h10v4H7V4Zm-2 9h14m-11 4h8',
  filling: 'M3 12h18c0 6-4 9-9 9s-9-3-9-9Zm11-3 5-7m-9 7c-3-2 1-3-1-5',
}
export function RecipeCategoryIcon({
  icon = 'other',
  label,
  className = '',
}: {
  icon?: RecipeIconName
  label?: string
  className?: string
}) {
  const Icon = icons[icon]
  return (
    <span
      className={`recipe-category-icon tone-${tones[icon]} ${className}`}
      data-recipe-icon={icon}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {drawings[icon] ? (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={drawings[icon]} />
        </svg>
      ) : (
        <Icon size={24} strokeWidth={1.6} />
      )}
    </span>
  )
}
