import { costBreakdown, money, parseQuantity, type Item } from './domain'

/** Read-only line estimate through the existing recipe costing calculation. */
export function recipeLineCost(line: Item[string], ingredients: Item[]) {
  try {
    const ingredient = ingredients.find((item) => item.id === line.ingredientId)
    if (!ingredient) throw new Error('Ingredient is unavailable.')
    if (
      line.quantity == null ||
      line.quantity === '' ||
      !Number.isFinite(parseQuantity(line.quantity)) ||
      parseQuantity(line.quantity) <= 0
    )
      throw new Error('Enter a positive ingredient quantity.')
    const price = ingredient.currentCost ?? ingredient.cost
    if (
      ingredient.needsCostSetup ||
      price == null ||
      price === '' ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0
    )
      throw new Error('Ingredient price needs setup.')
    const result = costBreakdown(
      { id: 'line-preview', name: 'Line preview', yield: 1, lines: [line] },
      ingredients,
    )
    const cost = result.lines[0].cost
    return {
      text: cost > 0 && cost < 0.01 ? `<${money(0.01)}` : money(cost),
      reason: '',
    }
  } catch (error) {
    return {
      text: 'Cost unavailable',
      reason:
        error instanceof Error
          ? error.message
          : 'Check the quantity, price and unit conversion.',
    }
  }
}
