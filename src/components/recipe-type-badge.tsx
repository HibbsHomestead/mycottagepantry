import type { Item } from '@/lib/domain'
import { recipeTypeLabel } from '@/lib/recipe-type'
import './recipe-type.css'

export function RecipeTypeBadge({ recipe }: { recipe: Item }) {
  return (
    <span className="recipe-type-badge" data-prep={recipe.compound === true}>
      {recipeTypeLabel(recipe)}
    </span>
  )
}
