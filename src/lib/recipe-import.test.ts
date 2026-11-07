import { it, expect } from 'vitest'
import {
  parseQuantity,
  parseIngredient,
  parseRecipeText,
  suggestIngredient,
  lineIssues,
  duplicateRecipes,
  measurement,
  recipeMethod,
  recipeDraftSchema,
  moveRecipeContent,
  reprocessRecipeDraft,
} from './recipe-import'
import { classifyRecipeText, isDirection } from './recipe-source'
import { bestCrumbleSource } from '../test/fixtures/best-crumble'
import { costBreakdown } from './domain'
it('parses decimals, ordinary/unicode fractions and mixed numbers without inventing ranges', () => {
  for (const [text, value] of [
    ['1.25', 1.25],
    ['.5', 0.5],
    ['1/2', 0.5],
    ['½', 0.5],
    ['1½', 1.5],
    ['1 1/2', 1.5],
    ['2⅓', 2 + 1 / 3],
  ] as const)
    expect(parseQuantity(text)).toBeCloseTo(value)
  expect(parseQuantity('1/0')).toBeNull()
  expect(parseIngredient('1–2 cups flour').quantity).toBeNull()
  expect(parseIngredient('salt to taste').quantity).toBeNull()
  expect(parseIngredient('2 fl oz milk').unit).toBe('')
  expect(parseIngredient('2 US fl oz milk').unit).toBe('fl oz')
  expect(parseIngredient('2 oz chocolate').unit).toBe('oz')
  expect(parseIngredient('1½ cups bread flour, sifted')).toMatchObject({
    quantity: 1.5,
    unit: 'cup',
    name: 'bread flour',
    preparation: 'sifted',
  })
})
it('distinguishes a missing price from an explicitly entered zero price for an imported recipe', () => {
  const line = {
    ...parseIngredient('8 g bread flour'),
    decision: 'match' as const,
    ingredientId: 'flour',
    confirmed: true,
  }
  const ingredient = {
    id: 'flour',
    name: 'Bread flour',
    unit: 'g',
    cost: null,
    currentCost: null,
    quantity: 0,
    conversions: [],
  }
  const recipe = {
    id: 'imported',
    name: 'Bread',
    yield: 1,
    importProvenance: { importId: 'draft' },
    lines: [line],
  }
  expect(lineIssues(line, [ingredient])).toContain(
    'Missing price: enter purchase/cost details in Pantry.',
  )
  expect(() => costBreakdown(recipe, [ingredient])).toThrow(/Cost incomplete/)
  expect(lineIssues(line, [{ ...ingredient, cost: 0 }])).toEqual([])
  expect(costBreakdown(recipe, [{ ...ingredient, cost: 0 }]).ingredient).toBe(0)
})
it('preserves ingredient groups, ordered instructions, missing yield and separate timing', () => {
  const draft = parseRecipeText(
    'Coffee rolls\nPrep time: 20 minutes\nCook time: 1 hour\nIngredients:\nDough:\n1 1/2 cups bread flour\nFilling\n2 tbsp butter, softened\nStreusel:\n½ cup sugar\nInstructions:\n1. Mix dough.\n2. Bake.',
  )
  expect(draft.lines.map((l) => l.group)).toEqual([
    'Dough',
    'Filling',
    'Streusel',
  ])
  expect(draft.instructions).toEqual(['Mix dough.', 'Bake.'])
  expect(draft.yieldQuantity).toBeNull()
  expect(draft.prepMinutes).toBe(20)
  expect(draft.cookMinutes).toBe(60)
})
it('matches only exact identities and saved aliases; requires confirmation and real conversions', () => {
  const ingredients = [
    {
      id: 'bread',
      name: 'Bread flour',
      usedAs: 'ingredient',
      aliases: ['strong flour'],
      unit: 'g',
      cost: 0.01,
    },
    { id: 'ap', name: 'All-purpose flour', unit: 'g', cost: 0.01 },
  ]
  expect(
    suggestIngredient(parseIngredient('2 cups strong flour'), ingredients).map(
      (i) => i.id,
    ),
  ).toEqual(['bread'])
  expect(
    suggestIngredient(parseIngredient('2 cups flour'), ingredients),
  ).toEqual([])
  const line = {
    ...parseIngredient('2 cups bread flour'),
    ingredientId: 'bread',
    decision: 'match' as const,
    confirmed: true,
  }
  expect(lineIssues(line, ingredients)).toContain(
    'Confirm cup standard: US or metric.',
  )
  expect(lineIssues({ ...line, cupStandard: 'us' }, ingredients)).toContain(
    'Conversion needed: US cup to g for Bread flour.',
  )
  expect(measurement({ ...line, cupStandard: 'metric' })).toEqual({
    quantity: 500,
    unit: 'ml',
  })
  expect(
    lineIssues({ ...line, cupStandard: 'us' }, [
      {
        ...ingredients[0],
        conversions: [
          {
            from: 'cup',
            to: 'g',
            amountFrom: 1,
            amountTo: 125,
            verified: true,
          },
        ],
      },
    ]),
  ).toEqual([])
})
it('flags duplicates and incomplete costs instead of reporting partial totals as complete', () => {
  const draft = parseRecipeText('Bread\nIngredients:\n2 lb bread flour')
  expect(
    duplicateRecipes(draft, 'https://example.com/bread#recipe', [
      {
        id: 'r',
        name: 'Other title',
        importProvenance: { sourceUrl: 'https://example.com/bread' },
      },
    ]),
  ).toHaveLength(1)
  expect(() =>
    costBreakdown(
      {
        id: 'r',
        name: 'Imported',
        yield: 1,
        lines: [{ ingredientId: 'new', quantity: 1, unit: 'g' }],
        importProvenance: { importId: 'd' },
      },
      [
        {
          id: 'new',
          name: 'Uncosted',
          unit: 'g',
          cost: 0,
          needsCostSetup: true,
        },
      ],
    ),
  ).toThrow('Cost incomplete — 1 ingredient need setup.')
})
it('classifies the exact crumble source before amounts, preserving six real ingredients, optional choices and all five steps', () => {
  const draft = parseRecipeText(bestCrumbleSource)
  expect(draft.title).toBe('Best Crumble Topping')
  expect(draft.lines).toHaveLength(6)
  expect(draft.optionalAdditions).toHaveLength(1)
  expect(draft.optionalAdditions[0].original).toBe(
    '1 chopped pecans, walnuts and/or oats 1/2 cup to 1 cup',
  )
  expect(draft.optionalAdditions[0].name).toContain(
    'pecans, walnuts and/or oats',
  )
  expect(draft.optionalAdditions[0].quantity).toBeNull()
  expect(draft.lines[3].quantity).toBeNull()
  expect(draft.instructions).toEqual([
    'Melt butter, set aside.',
    'In a medium bowl, mix the flour, sugars and cinnamon.',
    'Slowly pour the melted butter in as you stir the mixture with a fork.',
    'Evenly spread the crumble mixture over the pie filling, cake or muffins.',
    'Bake in the oven according to the recipe you are using.',
  ])
  expect(draft.lines.some((line) => isDirection(line.original))).toBe(false)
  expect(draft.instructionGroups).toEqual(Array(5).fill('Crumble topping:'))
  expect(recipeMethod(draft)).toMatch(/^Crumble topping:\n\nMelt butter/)
  expect(draft.sourceUrl).toBe(
    'https://www.thebakingchocolatess.com/best-crumble-topping-recipe/',
  )
  expect(draft.description).toBe('')
  expect(draft.unclassified).toEqual([])
  expect(draft.yieldQuantity).toBeNull()
  expect(draft.cookMinutes).toBeNull()
  // Every nonblank source line is classified exactly once, including headings/footer/URL.
  expect(
    classifyRecipeText(bestCrumbleSource).flatMap((block) =>
      block.text.split('\n'),
    ),
  ).toEqual(
    bestCrumbleSource
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  )
})
it('separates unnumbered directions without standard headings and keeps preparation words in ingredients', () => {
  const draft = parseRecipeText(
    'Quick cake\n100 g butter, melted\n50 g walnuts, chopped\nIn a bowl, mix the butter with 2 cups of flour.\nSpread over the cake.\nBake for 20 minutes.',
  )
  expect(draft.lines).toHaveLength(2)
  expect(draft.lines.map((line) => line.preparation)).toEqual([
    'melted',
    'chopped',
  ])
  expect(draft.instructions).toHaveLength(3)
  expect(draft.instructions[0]).toContain('2 cups of flour')
  expect(draft.cookMinutes).toBeNull()
})
it('preserves multi-section headings, wrapped ingredients and wrapped instruction paragraphs', () => {
  const draft = parseRecipeText(
    'Layer cake\nIngredients:\nCake:\n100 g flour,\n  sifted\nFilling:\n20 g butter\nCake assembly:\n1. Mix flour with water until\n  the batter is smooth.\n2. Bake for 10 minutes.\nFinish the filling:\nWhisk butter until fluffy.\nNotes:\nKeep covered.',
  )
  expect(draft.lines[0].original).toBe('100 g flour,\nsifted')
  expect(draft.lines.map((line) => line.group)).toEqual(['Cake', 'Filling'])
  expect(draft.instructions).toEqual([
    'Mix flour with water until\nthe batter is smooth.',
    'Bake for 10 minutes.',
    'Whisk butter until fluffy.',
  ])
  expect(draft.instructionGroups).toEqual([
    'Cake assembly:',
    'Cake assembly:',
    'Finish the filling:',
  ])
  expect(draft.notes).toContain('Keep covered.')
})
it('flags uncertain source text and unknown metadata without guessing a numeric value or method', () => {
  const draft = parseRecipeText(
    'Simple recipe\nYield: 4–6 servings\nCook time: 20–30 minutes\nIngredients:\n100 g flour\nThis sentence may be an annotation',
  )
  expect(draft.yieldQuantity).toBeNull()
  expect(draft.cookMinutes).toBeNull()
  expect(draft.unclassified).toContain('Yield: 4–6 servings')
  expect(draft.unclassified).toContain('Cook time: 20–30 minutes')
  expect(draft.instructions).toEqual([])
  expect(
    draft.lines.some((line) => line.original.startsWith('This sentence')),
  ).toBe(false)
})
it('does not mistake list ordinals or numbered prose for quantities', () => {
  const draft = parseRecipeText(
    'Bread\nIngredients:\n1. 100 g flour\n2. 20 g butter, melted\nA different finish:\n1. The dough should be soft and smooth.\n2. Add 2 tbsp butter and stir until combined.',
  )
  expect(draft.lines.map((line) => line.quantity)).toEqual([100, 20])
  expect(draft.instructions).toHaveLength(2)
  expect(draft.instructions[1]).toBe(
    'Add 2 tbsp butter and stir until combined.',
  )
})
it('moves content intact between method, ingredients, optional additions and notes without matches for prose', () => {
  let draft = recipeDraftSchema.parse({
    lines: [parseIngredient('1. Melt butter, set aside.', 'Topping')],
  })
  draft = moveRecipeContent(draft, 'ingredient', 0, 'instruction')
  expect(draft.lines).toEqual([])
  expect(draft.instructions).toEqual(['Melt butter, set aside.'])
  expect(draft.instructionGroups).toEqual(['Topping'])
  draft = moveRecipeContent(draft, 'instruction', 0, 'note')
  expect(draft.notes).toBe('Topping:\nMelt butter, set aside.')
  draft = moveRecipeContent(
    recipeDraftSchema.parse({ instructions: ['100 g flour'] }),
    'instruction',
    0,
    'ingredient',
  )
  expect(draft.lines[0]).toMatchObject({
    original: '100 g flour',
    quantity: 100,
    name: 'flour',
    decision: 'unresolved',
  })
  draft = moveRecipeContent(draft, 'ingredient', 0, 'optional')
  expect(draft.lines).toEqual([])
  expect(draft.optionalAdditions[0].original).toBe('100 g flour')
})
it('proposes five moved directions and preserves valid exact-source Pantry matches without mutating the current draft', () => {
  const parsed = parseRecipeText(bestCrumbleSource)
  const legacy = recipeDraftSchema.parse({
    title: 'My edited title',
    lines: [
      ...parsed.lines,
      ...parsed.optionalAdditions,
      ...parsed.instructions.map((text, index) =>
        parseIngredient(`${index + 1}. ${text}`, 'Crumble topping'),
      ),
    ],
    instructions: [],
  })
  legacy.lines[0] = {
    ...legacy.lines[0],
    decision: 'match',
    confirmed: true,
    ingredientId: 'flour',
    cupStandard: 'us',
  }
  const before = structuredClone(legacy)
  const repair = reprocessRecipeDraft(legacy, bestCrumbleSource, [
    { id: 'flour', name: 'All-purpose flour', usedAs: 'ingredient' },
  ])
  expect(repair.movedInstructions).toBe(5)
  expect(repair.preservedMatches).toBe(1)
  expect(repair.draft.lines[0]).toMatchObject({
    decision: 'match',
    confirmed: true,
    ingredientId: 'flour',
    cupStandard: 'us',
  })
  expect(repair.draft.lines).toHaveLength(6)
  expect(repair.draft.instructions).toHaveLength(5)
  expect(legacy).toEqual(before)
})
it('recognizes passive directions containing quantities without turning those quantities into ingredients', () => {
  const draft = parseRecipeText(
    'Cake\n100 g flour\n2 cups flour are mixed with water in a bowl.\nThe dough is kneaded until smooth.',
  )
  expect(draft.lines).toHaveLength(1)
  expect(draft.instructions).toEqual([
    '2 cups flour are mixed with water in a bowl.',
    'The dough is kneaded until smooth.',
  ])
})
it('preserves a recipe with no instructions as an empty method without inventing timing or yield', () => {
  const draft = parseRecipeText(
    'Simple crumble\nIngredients:\n100 g flour\n50 g butter, melted',
  )
  expect(draft.lines).toHaveLength(2)
  expect(draft.instructions).toEqual([])
  expect(draft.yieldQuantity).toBeNull()
  expect(draft.prepMinutes).toBeNull()
  expect(draft.cookMinutes).toBeNull()
})
it('keeps multiple wrapped sentences and paragraphs within a numbered step and separates inline notes', () => {
  const draft = parseRecipeText(
    'Bread\n100 g flour\nMethod:\n1. Mix the dough.\nStir in the remaining flour.\n\nLet the dough rest.\n2. Bake for 20 minutes.\nNote: Keep leftovers covered.',
  )
  expect(draft.instructions).toEqual([
    'Mix the dough.\nStir in the remaining flour.\n\nLet the dough rest.',
    'Bake for 20 minutes.',
  ])
  expect(draft.notes).toBe('Note: Keep leftovers covered.')
})
