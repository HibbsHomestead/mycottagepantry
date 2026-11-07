import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RecipeLineCost } from './recipe-line-cost'
import { recipeLineCost } from '@/lib/recipe-line-cost'
import { costBreakdown, type Item } from '@/lib/domain'

const ingredient: Item = {
  id: 'sugar',
  name: 'Sugar',
  unit: 'g',
  currentCost: 0.0042,
  cost: 0.005,
  quantity: 1000,
}
it('shows the existing costing result and updates for ingredient, quantity and unit changes', () => {
  const line = { ingredientId: ingredient.id, quantity: 100, unit: 'g' }
  const before = structuredClone(ingredient)
  const view = render(<RecipeLineCost line={line} ingredients={[ingredient]} />)
  expect(screen.getByText('$0.42')).toBeVisible()
  expect(
    costBreakdown({ id: 'r', name: 'r', yield: 1, lines: [line] }, [ingredient])
      .lines[0].cost,
  ).toBe(0.42)
  view.rerender(
    <RecipeLineCost
      line={{ ...line, quantity: 1, unit: 'kg' }}
      ingredients={[ingredient]}
    />,
  )
  expect(screen.getByText('$4.20')).toBeVisible()
  view.rerender(
    <RecipeLineCost
      line={line}
      ingredients={[{ ...ingredient, currentCost: 0.01 }]}
    />,
  )
  expect(screen.getByText('$1.00')).toBeVisible()
  expect(ingredient).toEqual(before)
})

it('uses verified conversions and distinguishes small positive costs, true zero, and missing costs', () => {
  const line = { ingredientId: ingredient.id, quantity: 1, unit: 'cup' }
  expect(recipeLineCost(line, [ingredient])).toMatchObject({
    text: 'Cost unavailable',
    reason: expect.stringContaining('conversion'),
  })
  expect(
    recipeLineCost(line, [
      {
        ...ingredient,
        conversions: [
          {
            from: 'cup',
            to: 'g',
            amountFrom: 1,
            amountTo: 100,
            verified: true,
          },
        ],
      },
    ]).text,
  ).toBe('$0.42')
  expect(recipeLineCost({ ...line, unit: 'g' }, [ingredient]).text).toBe(
    '<$0.01',
  )
  expect(
    recipeLineCost({ ...line, unit: 'g' }, [{ ...ingredient, currentCost: 0 }])
      .text,
  ).toBe('$0.00')
  for (const price of [undefined, '', NaN, -1])
    expect(
      recipeLineCost(line, [{ ...ingredient, currentCost: price, cost: price }])
        .text,
    ).toBe('Cost unavailable')
  expect(
    recipeLineCost(line, [{ ...ingredient, needsCostSetup: true }]).text,
  ).toBe('Cost unavailable')
  expect(recipeLineCost(line, []).reason).toBe('Ingredient is unavailable.')
})
