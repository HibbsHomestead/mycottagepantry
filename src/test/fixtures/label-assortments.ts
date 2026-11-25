import { blankLabel } from '../../lib/label-studio'
import type { AssortmentPlan } from '../../lib/label-assortments'
import type { Workspace } from '../../lib/domain'

export function assortmentFixture() {
  const names = ['Blueberry', 'Chocolate', 'Lemon']
  const workspace: Workspace = {
    settings: [{ id: 'bakery', name: 'Synthetic bakery' }],
    products: names.map((name, index) => ({
      id: name,
      name: `${name} muffin`,
      recipeId: `recipe-${index}`,
      unitsPerPackage: 6,
      netQuantity: 'Net Wt. 18 oz',
    })),
    recipes: names.map((name, index) => ({
      id: `recipe-${index}`,
      name,
      yield: 4,
      yieldUnit: 'each',
      lines: [
        { ingredientId: `ingredient-${index}`, quantity: 10, unit: 'g' },
      ],
    })),
    ingredients: names.map((name, index) => ({
      id: `ingredient-${index}`,
      name: `${name} mix`,
      unit: 'g',
      quantity: 800,
      cost: 2,
      reviewed: true,
      requiresSubingredients: true,
      subingredients: `${name}, cane sugar`,
      allergens: index === 1 ? ['milk'] : ['wheat'],
      ...(index === 1 && { sourceMayContain: 'May contain soy' }),
    })),
    batches: [],
    label_templates: [
      {
        ...blankLabel(),
        id: 'test-stock',
        name: '4 × 6 test stock',
        revision: 2,
      },
    ],
  }
  workspace.ingredients.push({
    id: 'outer-box',
    name: 'Large box',
    usedAs: 'packaging',
    quantity: 10,
    cost: 1,
  })
  const plan: AssortmentPlan = {
    name: 'Market assortment',
    templateId: 'test-stock',
    count: 2,
    labelsPerContainer: 1,
    mode: 'fixed',
    packagingId: 'outer-box',
    extraText: 'Packed for the market',
    groups: [
      {
        name: '',
        count: 2,
        lines: names.map((productId, index) => ({
          productId,
          count: index + 1,
          unit: index === 1 ? 'package' : 'item',
          wrapped: index > 0,
          advisory:
            index === 2 ? 'Made on shared equipment with tree nuts' : '',
          componentLabel: index > 0,
        })),
      },
    ],
  }
  return { workspace, plan }
}
