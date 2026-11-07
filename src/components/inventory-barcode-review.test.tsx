import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { demoData } from '@/lib/demo'
import {
  InventoryBarcodeReview,
  inventoryBarcodeMatches,
} from './inventory-barcode-review'
it('requires package selection and confirmation and passes no catalog cost or scanned quantity', async () => {
  const w = demoData(),
    receive = vi.fn()
  w.ingredients[0].barcode = '001234'
  w.ingredients[0].purchaseOffers = [
    {
      id: 'offer',
      barcode: '001234',
      purchaseQuantity: 5,
      purchaseUnit: 'lb',
      packagePrice: 9.25,
    },
  ]
  render(
    <InventoryBarcodeReview
      workspace={w}
      code="001234"
      change={vi.fn()}
      onScan={vi.fn()}
      onManual={vi.fn()}
      onUrl={vi.fn()}
      onReceive={receive}
      autoSearch
    />,
  )
  expect(screen.getAllByRole('radio')).toHaveLength(2)
  expect(
    screen.queryByRole('button', { name: 'Receive Stock' }),
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getAllByRole('radio')[1])
  expect(screen.getByRole('button', { name: 'Receive Stock' })).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox'))
  await userEvent.click(screen.getByRole('button', { name: 'Receive Stock' }))
  expect(receive).toHaveBeenCalledWith(
    expect.objectContaining({
      quantity: '',
      price: '',
      unit: 'lb',
      operationId: expect.any(String),
    }),
  )
})
it('never treats an unknown leading-zero barcode as successful product lookup', () => {
  render(
    <InventoryBarcodeReview
      workspace={demoData()}
      code="000000123456"
      change={vi.fn()}
      onScan={vi.fn()}
      onManual={vi.fn()}
      onUrl={vi.fn()}
      autoSearch
    />,
  )
  expect(screen.getByText(/Product lookup unavailable/)).toBeVisible()
  expect(screen.getByText('000000123456', { exact: true })).toBeVisible()
})
it('searches current Oven pantry and resale records without cross-type duplicates or foreign records', () => {
  const w = demoData()
  w.products.push({
    id: 'mug',
    name: 'Mug',
    workflow: 'resale',
    barcode: '001234',
    quantity: 8,
  })
  expect(inventoryBarcodeMatches(w, '001234')[0].item.id).toBe('mug')
  expect(inventoryBarcodeMatches(demoData(), '001234')).toEqual([])
  expect(inventoryBarcodeMatches(w, '001234')[0].item.barcode).toBe('001234')
})
