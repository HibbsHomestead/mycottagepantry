import userEvent from '@testing-library/user-event'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { HandmadeWorkspace, HandmadeProductEditor } from './handmade-workspace'
import { demoData } from '../lib/demo'

it('keeps handmade products independent of food recipes and store-page imports', async () => {
  render(
    <HandmadeProductEditor
      item={null}
      workspace={demoData()}
      role="Owner"
      mutate={vi.fn()}
      onWorkspace={vi.fn()}
      close={vi.fn()}
      onDirty={vi.fn()}
    />,
  )
  await userEvent.click(screen.getByRole('tab', { name: /^Bill of Materials$/ }))
  expect(
    screen.getByRole('heading', { name: 'Bill of materials' }),
  ).toBeVisible()
  expect(
    screen.getByLabelText('Finished units per production run'),
  ).toBeVisible()
  expect(screen.queryByText(/Have a product link/)).not.toBeInTheDocument()
  expect(
    screen.queryByLabelText('Saved handmade design'),
  ).not.toBeInTheDocument()
  expect(screen.getByText(/Cost incomplete:/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Add material' }))
  expect(screen.getByLabelText('Material or shared packaging')).toBeVisible()
})
it('saves dedicated material details without food fields or changing stock', async () => {
  const mutate = vi.fn().mockResolvedValue(undefined)
  render(
    <HandmadeWorkspace
      workspace={demoData()}
      role="Owner"
      mutate={mutate}
      open={vi.fn()}
      tab="Materials & Supplies"
      onWorkspace={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Add material' }))
  fireEvent.change(screen.getByLabelText('Material name'), {
    target: { value: 'Cotton cord' },
  })
  expect(screen.queryByLabelText(/Allergens/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save material' }))
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      'handmadeMaterialSave',
      'ingredients',
      expect.objectContaining({
        name: 'Cotton cord',
        usedAs: 'material',
        unit: 'each',
      }),
    ),
  )
})
