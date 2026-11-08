import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { breadBaseFixture } from '@/test/fixtures/bread-base'
import { BatchCostPreview } from './financial-editors'

it.each([
  [undefined, '$30.00'],
  [60, '$15.00'],
  [0, '$0.00'],
] as const)(
  'previews whole-run labor with %s actual minutes without adding the base again',
  async (laborMinutes, laborCost) => {
    const w = breadBaseFixture(),
      recipe = w.recipes[1]
    Object.assign(recipe, { laborMinutes: 60, laborRate: 15 })
    render(
      <BatchCostPreview
        recipe={recipe}
        ingredients={w.ingredients}
        multiplier={2}
        laborMinutes={laborMinutes}
      />,
    )
    await userEvent.click(
      screen.getByText('View calculation · run cost preview'),
    )
    expect(screen.getByText(/Ingredients \$/)).toHaveTextContent(
      `+ labor ${laborCost} + overhead`,
    )
  },
)
