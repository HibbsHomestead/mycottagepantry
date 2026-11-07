import type { Item } from '@/lib/domain'
import { recipeLineCost } from '@/lib/recipe-line-cost'

export function RecipeLineCost({
  line,
  ingredients,
}: {
  line: Item[string]
  ingredients: Item[]
}) {
  const cost = recipeLineCost(line, ingredients)
  return (
    <span className="recipe-line-cost" aria-live="polite">
      <span>{cost.text}</span>
      {cost.reason && <small>{cost.reason}</small>}
    </span>
  )
}
