import { describe, expect, it } from 'vitest'
import { breadBaseFixture } from '@/test/fixtures/bread-base'
import {
  baseIngredientOverlap,
  costBreakdown,
  effectiveRecipeLines,
  recipeProductionLines,
} from './domain'
import { componentStock, validateRecipeComponents } from './recipe-components'
import { resolveLabelData } from './label-studio'
import { rollup } from './demo'

describe('Homestyle White Bread linked into Spinach Parmesan', () => {
  for (const [scale, flour, ingredientCost, total] of [
    [0.5, 500, 2.47, 7.97],
    [1, 1000, 3.54, 12.54],
    [2, 2000, 5.68, 21.68],
  ]) {
    it(`scales only the base at ${scale} batches, without a loaf conversion or base packaging`, () => {
      const w = breadBaseFixture(),
        variation = w.recipes[1]
      variation.baseMultiplier = scale
      const before = structuredClone(w.ingredients)
      expect(validateRecipeComponents(variation, w)).toEqual([])
      const lines = effectiveRecipeLines(variation, w.recipes)
      expect(lines).toHaveLength(6)
      expect(lines.find((l) => l.ingredientId === 'flour').quantity).toBe(flour)
      expect(lines.find((l) => l.ingredientId === 'spinach').quantity).toBe(80)
      expect(lines.find((l) => l.ingredientId === 'parmesan').quantity).toBe(50)
      const c = costBreakdown(variation, w.ingredients, {
        recipes: w.recipes,
      })
      expect(c.ingredient).toBeCloseTo(ingredientCost)
      expect(c.total).toBeCloseTo(total)
      expect(c.packagingCost).toBe(0)
      expect(c.plannedYield).toBe(3)
      expect(w.ingredients).toEqual(before)
      expect(w.ledger).toEqual([])
      expect(() => componentStock(w.recipes[0], w.ingredients)).toThrow(
        'supported pantry unit',
      )
    })
  }
  it('scales both components when the entire variation is doubled and keeps declarations/provenance', () => {
    const w = breadBaseFixture(),
      variation = w.recipes[1]
    const c = costBreakdown(variation, w.ingredients, {
      recipes: w.recipes,
      multiplier: 2,
    })
    expect(c.total).toBeCloseTo(25.08)
    expect(c.lines.find((l) => l.ingredientId === 'flour').normalized).toBe(
      2000,
    )
    expect(c.lines.find((l) => l.ingredientId === 'spinach').normalized).toBe(
      160,
    )
    expect(c.lines.find((l) => l.ingredientId === 'parmesan').normalized).toBe(
      100,
    )
    const label = resolveLabelData(w, {
      kind: 'product',
      id: 'spinach-loaf',
    })
    expect(label.values['recipe.ingredients']).toContain(
      'Bread flour (Wheat flour, malted barley flour)',
    )
    expect(label.values['recipe.ingredients']).toContain(
      'Parmesan (Milk, cultures, salt, enzymes)',
    )
    expect(label.allergens).toEqual(expect.arrayContaining(['Wheat', 'Milk']))
    expect(
      label.ingredientParts.find((p) => p.name === 'Bread flour')
        ?.sourceRecipeIds,
    ).toEqual(['spinach-parmesan', 'bread'])
    const rawUse = recipeProductionLines(variation, w.ingredients, w.recipes)
    expect(rawUse.map((l) => l.ingredientId)).toEqual([
      'flour',
      'water',
      'yeast',
      'salt',
      'spinach',
      'parmesan',
    ])
    expect(new Set(rawUse.map((l) => l.ingredientId)).size).toBe(6)
    expect(
      rawUse.some(
        (l) => l.ingredientId === 'bread' || l.ingredientId === 'prep-bread',
      ),
    ).toBe(false)
  })
  it('requires explicit overlap approval, preserves all saved lines and aggregates actual consumption once', () => {
    const w = breadBaseFixture(),
      variation = w.recipes[1]
    variation.lines.push({
      ingredientId: 'flour',
      quantity: 0.1,
      unit: 'kg',
    })
    const original = structuredClone(variation.lines)
    expect(() => validateRecipeComponents(variation, w)).toThrow(
      'Review and approve',
    )
    variation.baseOverlapApproval = baseIngredientOverlap(
      variation,
      w.recipes,
    )!.approval
    expect(() => validateRecipeComponents(variation, w)).not.toThrow()
    expect(variation.lines).toEqual(original)
    const use = recipeProductionLines(variation, w.ingredients, w.recipes)
    expect(use.filter((l) => l.ingredientId === 'flour')).toHaveLength(1)
    expect(use.find((l) => l.ingredientId === 'flour').quantity).toBe(1100)
  })
  it('refreshes current estimates after source saves while preserving completed cost/usage snapshots', () => {
    const w = breadBaseFixture(),
      variation = w.recipes[1]
    w.batches = [
      {
        id: 'historical',
        name: variation.name,
        status: 'completed',
        recipeId: variation.id,
        costSnapshot: costBreakdown(variation, w.ingredients),
        usage: recipeProductionLines(variation, w.ingredients, w.recipes),
      },
    ]
    const history = structuredClone(w.batches),
      sourceBefore = structuredClone(w.recipes[0])
    variation.lines[0].quantity = 90
    expect(w.recipes[0]).toEqual(sourceBefore)
    w.recipes[0].lines[0].quantity = 1200
    rollup(w)
    expect(costBreakdown(variation, w.ingredients).ingredient).toBeCloseTo(3.99)
    expect(w.batches).toEqual(history)
    expect(variation.yield).toBe(3)
    expect(w.recipes[0].yield).toBe(2)
  })
  it('rejects direct, indirect and prepared-component cycles and unavailable base references', () => {
    const w = breadBaseFixture(),
      variation = w.recipes[1]
    variation.baseRecipeId = variation.id
    expect(() => validateRecipeComponents(variation, w)).toThrow('itself')
    variation.baseRecipeId = 'bread'
    w.recipes[0].baseRecipeId = variation.id
    w.recipes[0].baseMultiplier = 1
    expect(() => validateRecipeComponents(variation, w)).toThrow('itself')
    delete w.recipes[0].baseRecipeId
    w.recipes[0].lines.push({
      ingredientId: 'prep-variation',
      componentRecipeId: variation.id,
      quantity: 1,
      unit: 'each',
    })
    expect(() => validateRecipeComponents(variation, w)).toThrow('itself')
    variation.baseRecipeId = 'foreign'
    expect(() => validateRecipeComponents(variation, w)).toThrow('unavailable')
  })
})
