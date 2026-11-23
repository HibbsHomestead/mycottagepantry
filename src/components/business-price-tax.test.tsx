import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { planPriceTaxChange } from '@/lib/business-price-tax'
import {
  BusinessPriceTaxSettings,
  type PriceTaxRequest,
} from './business-price-tax'

const business = {
  name: 'Business',
  id: 'business',
  defaultPriceTaxMode: 'includes',
}

afterEach(cleanup)

it('requires both bulk choices and confirmation after preview, without posting on preview', async () => {
  const plan = planPriceTaxChange(
    {
      settings: [business],
      products: [{ id: 'bread', name: 'Bread', price: 10 }],
      ingredients: [],
      recipes: [],
    },
    '2026-11-23',
    'entered',
    false,
  )
  const request = vi.fn<PriceTaxRequest>(async (action) =>
    action === 'priceTaxPreview'
      ? { plan, review: 'reviewed' }
      : { priceTaxResult: { updated: 1, failed: 0 } },
  )
  render(
    <BusinessPriceTaxSettings
      business={business}
      request={request}
      disabled={false}
    />,
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Apply to existing products…' }),
  )
  const dialog = within(screen.getByRole('dialog'))
  const preview = dialog.getByRole('button', { name: 'Preview changes' })
  expect(
    dialog.getByRole('radio', { name: /Preserve entered prices/ }),
  ).not.toBeChecked()
  expect(
    dialog.getByRole('radio', { name: /Preserve existing overrides/ }),
  ).not.toBeChecked()
  expect(preview).toBeDisabled()
  fireEvent.click(
    dialog.getByRole('radio', { name: /Preserve entered prices/ }),
  )
  expect(preview).toBeDisabled()
  fireEvent.click(
    dialog.getByRole('radio', { name: /Preserve existing overrides/ }),
  )
  fireEvent.click(preview)
  expect(await dialog.findByText('Bread')).toBeVisible()
  expect(request.mock.calls.map(([action]) => action)).toEqual([
    'priceTaxPreview',
  ])
  fireEvent.click(
    dialog.getByRole('button', { name: /Confirm and apply to 1/ }),
  )
  expect(await screen.findByText('1 product updated. 0 failed.')).toBeVisible()
  expect(request.mock.calls[1]).toEqual([
    'priceTaxApply',
    { strategy: 'entered', includeOverrides: false, review: 'reviewed' },
  ])
})
