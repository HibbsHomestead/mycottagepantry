import type { Item, Workspace } from '../../lib/domain'
import { resolveLabelData } from '../../lib/label-studio'
import {
  majorAllergens,
  type AllergenDecisions,
  type MajorAllergen,
} from '../../lib/label-ingredient-review'

export function confirmFixtureAllergens(
  workspace: Workspace,
  product: Item,
  present: MajorAllergen[],
  advisory = '',
) {
  const review = resolveLabelData(workspace, {
    kind: 'product',
    id: product.id,
  }).allergenReview!
  const decisions: AllergenDecisions = Object.fromEntries(
    majorAllergens.map((name) => [
      name,
      {
        status: present.includes(name) ? 'present' : 'absent',
        reason: 'Synthetic fixture supplier verified',
      },
    ]),
  )
  product.allergenReview = {
    source: review.source,
    decisions,
    advisory,
    reviewedAt: '2026-11-27T01:00:00.000Z',
    actor: 'fixture-reviewer',
  }
}

export function labelIngredientReviewFixture() {
  const mix: Item = {
    id: 'fixture-mix',
    name: 'Purchased blueberry muffin mix',
    statement: 'Muffin mix',
    unit: 'g',
    reviewed: true,
    requiresSubingredients: true,
    subingredients:
      'Wheat flour, cane sugar, leavening (baking soda, cornstarch), soy lecithin (soy)',
    allergens: ['Wheat', 'Soybeans'],
  }
  mix.labelComponentWeights = {
    text: mix.subingredients,
    shares: {
      '1': '65',
      '2': '30',
      '3': '4',
      '3.1': '50',
      '3.2': '50',
      '4': '1',
    },
  }
  const item = (id: string, name: string, allergens: string[] = []): Item => ({
    id,
    name,
    unit: 'g',
    reviewed: true,
    allergens,
  })
  const product: Item = {
    id: 'fixture-muffin',
    name: 'Blueberry muffins',
    workflow: 'food',
    recipeId: 'fixture-recipe',
    labelIngredientMode: 'parenthetical',
    labelGroupSmallIngredients: true,
  }
  const recipe: Item = {
    id: 'fixture-recipe',
    name: 'Blueberry muffin recipe',
    yield: 6,
    yieldUnit: 'each',
    lines: [
      ['fixture-mix', 100],
      ['flour', 20],
      ['eggs', 20],
      ['oil', 10],
      ['vanilla', 1],
    ].map(([ingredientId, quantity]) => ({
      ingredientId,
      quantity,
      unit: 'g',
    })),
  }
  const workspace: Workspace = {
    products: [product],
    recipes: [recipe],
    settings: [{ id: 'fixture-business', name: 'Synthetic oven' }],
    batches: [],
    ingredients: [
      mix,
      item('flour', 'wheat flour', ['Wheat']),
      item('eggs', 'Eggs', ['Eggs']),
      item('oil', 'Oil'),
      item('vanilla', 'Natural flavor'),
    ],
  }
  return { workspace, product, mix, recipe }
}
