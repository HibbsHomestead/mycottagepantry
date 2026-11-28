import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import {
  majorAllergens,
  validateAllergenDecisions,
  type AllergenDecisions,
} from '@/lib/label-ingredient-review'
import { blankLabel, newElement, resolveLabelData } from '@/lib/label-studio'
import { validateLabelRunContent } from '@/lib/label-sets'
import { labelIngredientReviewFixture } from '@/test/fixtures/label-ingredient-review'
import { ComponentWeightFields, LabelSourceAllergenReview } from './label-ingredient-review'

it('keeps supplier weights optional, groups nested components, and applies only the pasted values', async () => {
  const { mix } = labelIngredientReviewFixture()
  const draft = { ...mix, subingredients: 'Peanuts, enriched flour (wheat flour, niacin), sugar', labelComponentWeights: undefined }
  const change = vi.fn()
  const user = userEvent.setup()
  render(<ComponentWeightFields draft={draft} change={change} />)
  const summary = screen.getByText('Supplier component weights for merged labels (optional)')
  expect(summary.closest('details')).not.toHaveAttribute('open')
  await user.click(summary)
  expect(screen.getByLabelText('Peanuts · % by weight')).toHaveValue('')
  const nested = screen.getByText('enriched flour components').closest('details')!
  expect(nested).not.toHaveAttribute('open')
  await user.click(within(nested).getByText('enriched flour components'))
  expect(within(nested).getByLabelText('niacin · % by weight')).toHaveValue('')
  await user.click(within(nested).getByText('Paste percentages for this level'))
  await user.type(within(nested).getByLabelText('In the order listed above, separated by commas; leave unknown entries blank.'), '98,')
  await user.click(within(nested).getByRole('button', { name: 'Apply known values' }))
  expect(change).toHaveBeenCalledWith('labelComponentWeights', { text: draft.subingredients, sourceRef: '', shares: { '2.1': '98' } })
})

it('fixes missing mix evidence in place, confirms each allergen, and unlocks print until the source changes', async () => {
  const { workspace, product, mix } = labelIngredientReviewFixture()
  const wording = mix.subingredients
  mix.subingredients = ''
  mix.updatedAt = 'fixture-original'
  const source = { kind: 'product', id: product.id } as const
  const label = {
    ...blankLabel(),
    elements: [newElement('text', '', 'recipe.ingredients')],
  }
  const saves = vi.fn()

  function Fixture() {
    const [current, setCurrent] = useState(workspace)
    const data = resolveLabelData(current, source)
    let blocked = false
    try {
      validateLabelRunContent(label, data, ['front'])
    } catch {
      blocked = true
    }
    return (
      <>
        <LabelSourceAllergenReview
          workspace={current}
          source={source}
          data={data}
          mutate={async (action, table, payload) => {
            saves(action, table, payload)
            if (action === 'ingredientAllergenSource') {
              setCurrent({
                ...current,
                ingredients: current.ingredients.map((item) =>
                  item.id === mix.id
                    ? {
                        ...item,
                        subingredients: payload.subingredients,
                        reviewed: payload.reviewed,
                        updatedAt: 'fixture-edited',
                      }
                    : item,
                ),
              })
            } else {
              const evidence = data.allergenReview!
              expect(payload.source).toEqual(evidence.source)
              const decisions = validateAllergenDecisions(
                payload.decisions as AllergenDecisions,
                evidence.evidence,
              )
              setCurrent({
                ...current,
                products: [
                  {
                    ...product,
                    allergenReview: {
                      source: evidence.source,
                      decisions,
                      reviewedAt: '2026-11-28T00:00:00Z',
                      actor: 'fixture-reviewer',
                    },
                  },
                ],
              })
            }
          }}
        />
        <button disabled={blocked}>Print fixture</button>
        <button
          onClick={() =>
            setCurrent({
              ...current,
              ingredients: current.ingredients.map((item) =>
                item.id === mix.id
                  ? { ...item, subingredients: `${wording}, peanuts` }
                  : item,
              ),
            })
          }
        >
          Change fixture source
        </button>
      </>
    )
  }

  const user = userEvent.setup()
  render(<Fixture />)
  expect(screen.getByRole('button', { name: 'Print fixture' })).toBeDisabled()
  expect(screen.getByText(/add the supplier’s component list/)).toBeVisible()
  const mixSummary = screen.getByText('Edit allergen source for Purchased blueberry muffin mix')
  await user.click(mixSummary)
  const mixEditor = within(mixSummary.closest('details')!)
  await user.type(
    mixEditor.getByRole('textbox', { name: 'Supplier subingredients' }),
    wording,
  )
  await user.click(
    mixEditor.getByRole('checkbox', { name: /I verified the ingredient/ }),
  )
  await user.click(
    mixEditor.getByRole('button', { name: 'Save ingredient source' }),
  )
  expect(saves).toHaveBeenCalledWith(
    'ingredientAllergenSource',
    'ingredients',
    expect.objectContaining({
      expectedUpdatedAt: 'fixture-original',
      subingredients: wording,
      reviewed: true,
    }),
  )
  expect(screen.getByRole('button', { name: 'Print fixture' })).toBeDisabled()

  await user.click(screen.getByText(/Review and confirm major allergens/))
  for (const allergen of majorAllergens) {
    const present = ['Eggs', 'Wheat', 'Soybeans'].includes(allergen)
    await user.selectOptions(
      within(screen.getByRole('group', { name: allergen })).getByRole(
        'combobox',
      ),
      present ? 'present' : 'absent',
    )
  }
  await user.click(screen.getByRole('button', { name: 'Save allergen review' }))
  expect(screen.getByRole('button', { name: 'Print fixture' })).toBeEnabled()
  await user.click(
    screen.getByRole('button', { name: 'Change fixture source' }),
  )
  expect(screen.getByRole('button', { name: 'Print fixture' })).toBeDisabled()
  expect(screen.getByText(/Source changes need confirmation/)).toBeVisible()
})
