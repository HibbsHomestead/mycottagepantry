import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { DraftFieldReview } from './draft-field-review'
it('preselects empty fields, keeps conflicts unchecked and preserves latest manual edits', () => {
  const apply = vi.fn(),
    draft = {
      name: 'Manual flour',
      usedAs: 'ingredient',
      brand: '',
      imageAssetId: 'private-photo',
    }
  const fields = {
    name: 'Imported flour',
    brand: 'Bakery brand',
    subingredients: 'Wheat (flour, malt)',
    sourceContains: 'Contains wheat.',
    sourceMayContain: 'May contain soy.',
  }
  const { rerender } = render(
    <DraftFieldReview
      draft={draft}
      fields={fields}
      source="Test"
      apply={apply}
    />,
  )
  expect(screen.getByRole('checkbox', { name: /Name:/ })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: /Brand:/ })).toBeChecked()
  rerender(
    <DraftFieldReview
      draft={{ ...draft, brand: 'Typed while reviewing' }}
      fields={fields}
      source="Test"
      apply={apply}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected values' }))
  expect(apply).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('manual value changed')
  fireEvent.click(
    screen.getByRole('checkbox', { name: /Source ingredient statement:/ }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected values' }))
  expect(apply).toHaveBeenCalledWith(
    { subingredients: 'Wheat (flour, malt)', reviewed: false },
    ['subingredients'],
  )
})
it('shows uncertainty and conflicting alternatives without choosing or concatenating statements', () => {
  const apply = vi.fn()
  render(
    <DraftFieldReview
      draft={{ usedAs: 'ingredient' }}
      source="Photos"
      apply={apply}
      candidates={[
        {
          field: 'subingredients',
          value: 'Flour, salt',
          evidence: 'Back: Flour, salt',
        },
        {
          field: 'subingredients',
          value: 'Flour, milk',
          uncertain: true,
          evidence: 'Close-up: Flour, milk',
        },
      ]}
    />,
  )
  const boxes = screen.getAllByRole('checkbox')
  expect(boxes.every((b) => !(b as HTMLInputElement).checked)).toBe(true)
  fireEvent.click(boxes[0])
  fireEvent.click(boxes[1])
  expect(boxes[0]).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected values' }))
  expect(apply).toHaveBeenCalledWith(
    { subingredients: 'Flour, milk', reviewed: false },
    ['subingredients'],
  )
})
it('keeps package quantity/unit together and never invents a density conversion', () => {
  const apply = vi.fn()
  render(
    <DraftFieldReview
      draft={{ usedAs: 'ingredient', unit: 'g' }}
      packageSetup
      fields={{ name: 'Vanilla', purchaseQuantity: 1, purchaseUnit: 'ml' }}
      source="Catalog"
      apply={apply}
    />,
  )
  expect(
    screen.queryByRole('checkbox', { name: /Package contents/ }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected values' }))
  expect(apply).toHaveBeenCalledWith({ name: 'Vanilla' }, ['name'])
})
