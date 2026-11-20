import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { RecipeYieldFields } from './recipe-yield-fields'
function Draft() {
  const [recipe, setRecipe] = useState({
    yield: '8',
    yieldUnit: 'oz',
    compound: true,
  })
  return (
    <RecipeYieldFields
      recipe={recipe}
      onChange={(key, value) =>
        setRecipe((draft) => ({ ...draft, [key]: value }))
      }
    />
  )
}
it('preserves quantity and declared unit through editing and toggles, with distinct weight/fluid ounces', async () => {
  render(<Draft />)
  const selector = screen.getByRole('combobox', { name: 'Yield unit' })
  expect(selector).toHaveValue('oz')
  expect(screen.getByRole('option', { name: 'oz (weight)' })).toBeVisible()
  expect(screen.getByRole('option', { name: 'US fl oz' })).toBeVisible()
  await userEvent.selectOptions(selector, 'cup')
  await userEvent.clear(screen.getByRole('spinbutton', { name: 'Batch yield' }))
  await userEvent.type(
    screen.getByRole('spinbutton', { name: 'Batch yield' }),
    '1',
  )
  await userEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('textbox', { name: 'Yield unit' })).toHaveValue('cup')
  await userEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('combobox', { name: 'Yield unit' })).toHaveValue(
    'cup',
  )
  expect(screen.getByRole('spinbutton', { name: 'Batch yield' })).toHaveValue(1)
})
it('keeps a regular recipe custom unit and requires an explicit choice after enabling compound prep', async () => {
  render(
    <RecipeYieldFields
      recipe={{ yield: 2, yieldUnit: 'loaves', compound: true }}
      onChange={() => {}}
    />,
  )
  expect(screen.getByRole('combobox')).toHaveValue('loaves')
  expect(screen.getByRole('status')).toHaveTextContent('Choose a supported')
  expect(screen.queryByRole('option', { name: 'package' })).toBeNull()
})
