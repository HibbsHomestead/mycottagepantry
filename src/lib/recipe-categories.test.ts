import { expect, it } from 'vitest'
import {
  assignRecipeCategory,
  recipeCategories,
  recipeCategory,
  recipeCategoryLabel,
  recipeCategoryKey,
} from './recipe-categories'
import { demoData } from './demo'
import { parseRecipeText, reprocessRecipeDraft } from './recipe-import'

it('expands defaults once, preserves all legacy category assignments and never mutates recipes', () => {
  const w = demoData(),
    before = structuredClone(w)
  w.recipes.push({
    id: 'custom-legacy',
    name: 'Legacy',
    category: 'Sunday specials',
  })
  const categories = recipeCategories(w)
  expect(categories).toHaveLength(21)
  expect(new Set(categories.map((c) => recipeCategoryKey(c.name))).size).toBe(
    categories.length,
  )
  for (const r of before.recipes)
    expect(recipeCategory(r, categories)?.name).toBe(r.category)
  expect(w.recipes.slice(0, before.recipes.length)).toEqual(before.recipes)
  expect(recipeCategory(w.recipes.at(-1)!, categories)?.icon).toBe('other')
  expect(recipeCategoryLabel({ id: 'none', name: 'Plain' }, categories)).toBe(
    'Uncategorized',
  )
})

it('resolves renamed legacy assignments, keeps archives visible, and rejects new archived or foreign assignments', () => {
  const w = demoData()
  const original = recipeCategories(w).find((c) => c.name === 'Cookies')!
  const renamed = {
    ...original,
    name: 'Cookie favorites',
    previousNames: ['Cookies'],
    active: false,
  }
  w.settings[0].recipeCategories = [renamed]
  const categories = recipeCategories(w)
  expect(categories.filter((c) => c.id === original.id)).toEqual([renamed])
  expect(categories.some((c) => c.name === 'Cookies')).toBe(false)
  const old = {
    id: 'saved',
    name: 'Cookies',
    category: 'Cookies',
    yield: 12,
    imageAssetId: 'photo',
  }
  expect(recipeCategoryLabel(old, categories)).toBe(
    'Cookie favorites (archived)',
  )
  expect(assignRecipeCategory({ ...old }, old, categories)).toMatchObject({
    ...old,
    recipeCategoryId: renamed.id,
  })
  expect(() =>
    assignRecipeCategory({ ...old, id: 'new' }, undefined, categories),
  ).toThrow(/Archived/)
  expect(() =>
    assignRecipeCategory(
      {
        id: 'new',
        name: 'Other business',
        recipeCategoryId: 'foreign-category',
      },
      undefined,
      categories,
    ),
  ).toThrow(/this oven/)
  expect(
    assignRecipeCategory(
      { ...old, category: '', recipeCategoryId: '' },
      old,
      categories,
    ).category,
  ).toBe('')
})

it('retains imported categories verbatim for explicit review and preserves a reviewed choice during reprocessing', () => {
  const source =
    'Muffins\nCategories: Family favorites; Breakfast\nYield: 6 muffins\nIngredients:\n100 g flour\nInstructions:\nMix well.'
  const draft = parseRecipeText(source)
  expect(draft.importedCategory).toBe('Family favorites; Breakfast')
  expect(draft.recipeCategoryId).toBe('')
  expect(draft.lines).toHaveLength(1)
  const repaired = reprocessRecipeDraft(
    { ...draft, recipeCategoryId: 'reviewed-choice' },
    source,
    [],
  )
  expect(repaired.draft.recipeCategoryId).toBe('reviewed-choice')
  expect(repaired.draft.importedCategory).toBe(draft.importedCategory)
})
