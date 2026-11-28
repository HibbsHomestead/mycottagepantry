import { describe, expect, it } from 'vitest'
import { assortmentLabel } from './assortment-labels'
import { validateLabelRunContent } from './label-sets'
import {
  blankLabel,
  newElement,
  resolveLabelData,
  resolveRecipeAllergens,
} from './label-studio'
import {
  componentSources,
  majorAllergens,
  mergeWeightedIngredients,
  validateAllergenDecisions,
  type AllergenDecisions,
} from './label-ingredient-review'
import {
  confirmFixtureAllergens,
  labelIngredientReviewFixture,
} from '../test/fixtures/label-ingredient-review'
import { mixedPackFixture } from '../test/fixtures/mixed-pack'

const document = {
  ...blankLabel(),
  elements: [newElement('text', '', 'recipe.ingredients')],
}

describe('shared ingredient declaration and allergen review', () => {
  it('uses verified product weights, consolidates flour and expands nested leavening without touching allergen qualifiers', () => {
    const { workspace, product } = labelIngredientReviewFixture()
    const source = { kind: 'product', id: product.id } as const
    const original = resolveLabelData(workspace, source)
    expect(original.values['recipe.ingredients']).toContain(
      'Muffin mix (Wheat flour, cane sugar, leavening (baking soda, cornstarch), soy lecithin (soy))',
    )
    expect(original.ingredientMerge?.merged).toBe(
      'Ingredients: Wheat flour, cane sugar, Eggs, Oil. Contains less than 2% of: baking soda, cornstarch, soy lecithin (soy), Natural flavor',
    )
    expect(original.ingredientMerge?.parts[0]).toMatchObject({
      name: 'Wheat flour',
      weight: 85,
      contributions: [{ grams: 65 }, { grams: 20 }],
    })
    product.labelIngredientMode = 'merged'
    const pending = resolveLabelData(workspace, source)
    expect(pending.values['recipe.allergens']).toBe('')
    expect(() => validateLabelRunContent(document, pending, ['front'])).toThrow(
      /not confirmed/,
    )
    confirmFixtureAllergens(
      workspace,
      product,
      ['Wheat', 'Eggs', 'Soybeans'],
      'May contain sesame.',
    )
    const confirmed = resolveLabelData(workspace, source)
    expect(confirmed.values['recipe.ingredients']).toBe(
      original.ingredientMerge?.merged,
    )
    expect(confirmed.allergens).toEqual(
      expect.arrayContaining(['Eggs', 'Wheat', 'Soybeans']),
    )
    expect(confirmed.values['recipe.allergenAdvisory']).toBe(
      'May contain sesame.',
    )
    expect(() =>
      validateLabelRunContent(document, confirmed, ['front']),
    ).not.toThrow()
    expect(original.ingredientMerge?.mode).toBe('parenthetical')
  })

  it('retains the fallback when supplier shares are missing or stale and blocks merged printing', () => {
    const { workspace, mix, product } = labelIngredientReviewFixture()
    const source = { kind: 'product', id: product.id } as const
    product.labelIngredientMode = 'merged'
    delete mix.labelComponentWeights.shares['3.2']
    let data = resolveLabelData(workspace, source)
    expect(data.ingredientMerge?.merged).toBe('')
    expect(data.values['recipe.ingredients']).toContain(
      'leavening (baking soda, cornstarch)',
    )
    expect(() => validateLabelRunContent(document, data, ['front'])).toThrow(
      /Merged ingredient order is unconfirmed/,
    )
    mix.labelComponentWeights.shares['3.2'] = '50'
    mix.subingredients += ', peanut flour'
    data = resolveLabelData(workspace, source)
    expect(data.ingredientMerge?.merged).toBe('')
    expect(data.allergenReview?.evidence).toContainEqual(
      expect.objectContaining({ allergen: 'Peanuts' }),
    )
  })

  it('uses a strict less-than threshold and rejects supplier wording it cannot safely split', () => {
    const result = mergeWeightedIngredients(
      [
        { name: 'flour', weight: 97, contributions: [] },
        { name: 'at cutoff', weight: 2, contributions: [] },
        { name: 'below cutoff', weight: 1, contributions: [] },
      ],
      true,
    )
    expect(result.text).toBe(
      'Ingredients: flour, at cutoff. Contains less than 2% of: below cutoff',
    )
    expect(componentSources('leavening (salt, baking soda')).toBeNull()
    expect(componentSources('flour, contains less than 2% of: salt')).toBeNull()
  })

  it('requires a reason for a false positive and exposes evidence and changed sources without rewriting a snapshot', () => {
    const { workspace, product, recipe, mix } = labelIngredientReviewFixture()
    const source = { kind: 'product', id: product.id } as const
    const review = resolveRecipeAllergens(workspace, recipe)!
    expect(review.evidence).toContainEqual(
      expect.objectContaining({
        allergen: 'Soybeans',
        path: [recipe.name, 'Muffin mix', 'soy lecithin (soy)'],
      }),
    )
    expect(review.evidence).toContainEqual(
      expect.objectContaining({
        confidence: 'needs review',
        path: [recipe.name, 'Natural flavor'],
      }),
    )
    workspace.ingredients.find((item) => item.id === 'oil')!.name =
      'Highly refined peanut oil'
    const oilReview = resolveRecipeAllergens(workspace, recipe)!
    const rejected: AllergenDecisions = Object.fromEntries(
      majorAllergens.map((name) => [
        name,
        {
          status: ['Wheat', 'Eggs', 'Soybeans'].includes(name)
            ? 'present'
            : 'absent',
        },
      ]),
    )
    expect(() =>
      validateAllergenDecisions(rejected, oilReview.evidence),
    ).toThrow(/Record a reason/)
    confirmFixtureAllergens(workspace, product, ['Wheat', 'Eggs', 'Soybeans'])
    expect(
      validateAllergenDecisions(
        product.allergenReview.decisions,
        oilReview.evidence,
      ).Peanuts,
    ).toMatchObject({
      status: 'absent',
      reason: 'Synthetic fixture supplier verified',
    })
    expect(() =>
      validateAllergenDecisions(
        {
          ...product.allergenReview.decisions,
          Soybeans: { status: 'absent', reason: 'fixture' },
        },
        oilReview.evidence,
      ),
    ).toThrow(/reviewed ingredient source/)
    const before = structuredClone(resolveLabelData(workspace, source))
    mix.subingredients = ''
    const changed = resolveLabelData(workspace, source)
    expect(changed.allergenReview?.status).toBe('changed')
    expect(changed.allergenReview?.changed.join(' ')).toContain('Muffin mix')
    expect(
      changed.allergenReview?.evidence.some(
        (entry) => entry.confidence === 'incomplete data',
      ),
    ).toBe(true)
    expect(changed.values['recipe.allergens']).toBe('')
    expect(before.values['recipe.allergens']).toBe(
      'CONTAINS: WHEAT, SOYBEANS, EGGS',
    )
  })

  it('blocks circular prep and keeps merge and confirmation scoped to each mixed pack flavor', () => {
    const { workspace, outputs, recipes, ingredients, pack, template, labels } =
      mixedPackFixture()
    outputs[0].labelIngredientMode = 'merged'
    ingredients[1].subingredients = 'blueberries, cane sugar'
    ingredients[1].labelComponentWeights = {
      text: ingredients[1].subingredients,
      shares: { '1': '90', '2': '10' },
    }
    confirmFixtureAllergens(workspace, outputs[0], ['Wheat'])
    confirmFixtureAllergens(workspace, outputs[1], ['Wheat', 'Milk'])
    const { snapshot } = assortmentLabel(workspace, {
      productId: pack.id,
      batchId: '',
      group: '',
      templateId: template.id,
      packagingId: labels.id,
      mode: 'fixed',
      expectedLoose: 6,
      expectedPackages: 0,
      containers: 10,
      copies: 10,
      componentId: '',
      name: pack.name,
      lines: outputs.map((output) => ({
        productId: output.id,
        quantity: 3,
        unit: 'loose',
      })),
    })
    expect(snapshot.sections).toMatchObject([
      {
        declaration: 'Ingredients: Muffin flour, blueberries, cane sugar',
        sourceRevision: { ingredientMode: 'merged' },
        confirmedAllergens: ['Wheat'],
      },
      {
        declaration: 'Ingredients: Muffin flour, cranberry fruit',
        sourceRevision: { ingredientMode: 'parenthetical' },
        confirmedAllergens: ['Wheat', 'Milk'],
      },
    ])
    ingredients[1].compoundRecipeId = recipes[0].id
    const cyclic = resolveLabelData(workspace, {
      kind: 'product',
      id: outputs[0].id,
    })
    expect(cyclic.ingredientMerge?.issues.join(' ')).toMatch(/cyclic/)
    expect(cyclic.allergenReview?.status).toBe('changed')
  })
})
