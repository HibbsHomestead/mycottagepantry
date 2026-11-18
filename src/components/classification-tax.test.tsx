import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { TaxRateEditor } from './financial-editors'
import { ProductCostCards } from './product-cost-cards'
import { demoData } from '@/lib/demo'
import type { TaxRate } from '@/lib/domain'

afterEach(cleanup)
const business = {
  id: 'business',
  name: 'Test',
  productCategories: [
    { id: 'bags', name: 'Bags', classification: 'non_food' },
    { id: 'bread', name: 'Bread', classification: 'food' },
  ],
}
it('selects an existing classification and restores its durable identifier on reopen', () => {
  let saved: TaxRate[] = [
    {
      id: 'tax',
      name: 'Goods',
      jurisdiction: 'Test',
      ratePercent: 5,
      behavior: 'exclusive',
    },
  ]
  function Editor() {
    const [rates, setRates] = useState(saved)
    return (
      <TaxRateEditor
        business={business}
        rates={rates}
        onChange={(next) => {
          saved = next
          setRates(next)
        }}
      />
    )
  }
  const first = render(<Editor />)
  fireEvent.click(screen.getByText(/Goods ·/))
  fireEvent.change(screen.getByLabelText('Applies to'), {
    target: { value: 'classification' },
  })
  expect(screen.getByRole('option', { name: 'Food' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Classification'), {
    target: { value: 'non_food' },
  })
  expect(saved[0]).toMatchObject({
    appliesTo: 'classification',
    classification: 'non_food',
  })
  first.unmount()
  render(<Editor />)
  fireEvent.click(screen.getByText(/Goods ·/))
  expect(screen.getByLabelText('Classification')).toHaveValue('non_food')
  fireEvent.change(screen.getByLabelText('Classification'), {
    target: { value: 'food' },
  })
  expect(saved[0].classification).toBe('food')
})
it('offers only classifications represented by this business and shows unavailable saved targets', () => {
  render(
    <TaxRateEditor
      business={{ ...business, productCategories: [] }}
      rates={[
        {
          id: 'tax',
          name: 'Goods',
          jurisdiction: 'Test',
          ratePercent: 5,
          behavior: 'exclusive',
          appliesTo: 'classification',
          classification: 'non_food',
        },
      ]}
      onChange={() => {}}
    />,
  )
  fireEvent.click(screen.getByText(/Goods ·/))
  expect(
    screen.getByRole('option', { name: 'Saved classification unavailable' }),
  ).toBeDisabled()
  expect(screen.queryByRole('option', { name: 'Food' })).not.toBeInTheDocument()
})
it('clears tax setup warnings and restores pricing only for a valid classification treatment after reload', () => {
  const workspace = demoData()
  workspace.settings[0] = {
    ...workspace.settings[0],
    ...business,
    categoryTaxMappings: {},
    taxRates: [],
  }
  const product = {
    ...workspace.products[0],
    productCategoryId: 'bags',
    taxSource: 'category',
    price: 105,
    priceTaxMode: 'includes',
  }
  const first = render(
    <ProductCostCards product={product} cost={40} workspace={workspace} />,
  )
  expect(screen.getByText('Tax setup needs attention')).toBeVisible()
  first.unmount()
  workspace.settings[0].taxRates = [
    {
      id: 'tax',
      name: 'Goods',
      jurisdiction: 'Test',
      ratePercent: 5,
      behavior: 'exclusive',
      appliesTo: 'classification',
      classification: 'non_food',
    },
  ]
  const reloaded = JSON.parse(JSON.stringify(workspace))
  render(<ProductCostCards product={product} cost={40} workspace={reloaded} />)
  expect(
    screen.queryByText('Tax setup needs attention'),
  ).not.toBeInTheDocument()
  expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0)
})
