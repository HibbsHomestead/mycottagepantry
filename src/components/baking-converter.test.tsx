import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BakingConverter } from './baking-converter'
const ref = {
  id: 'flour',
  ingredientName: 'Flour',
  description: 'US cup basis',
  referenceWeightG: 125,
  referenceVolumeMl: 236.5882365,
  originalQuantity: 1,
  originalUnit: 'US cup',
  scope: 'shared',
  sourceName: 'Weekend Bakery',
  sourceUrl: 'https://www.weekendbakery.com/cooking-conversions/',
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('recalculates for each ingredient and switches across all four working tools without mutations', async () => {
  const request = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      references: [
        ref,
        {
          ...ref,
          id: 'butter',
          ingredientName: 'Butter',
          referenceWeightG: 226,
        },
      ],
    }),
  })
  vi.stubGlobal('fetch', request)
  render(<BakingConverter ready canSave ingredients={[]} />)
  await screen.findByText('125 g · Flour')
  fireEvent.change(screen.getByLabelText('Ingredient'), {
    target: { value: 'butter' },
  })
  expect(screen.getByText('226 g · Butter')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Quantity'), {
    target: { value: '1 1/2' },
  })
  expect(screen.getByText('339 g · Butter')).toBeInTheDocument()
  const activate = (name: string) =>
    fireEvent.mouseDown(screen.getByRole('tab', { name }), {
      button: 0,
      ctrlKey: false,
    })
  activate('Weight & Volume')
  expect(await screen.findByText('16 oz (weight)')).toBeInTheDocument()
  expect(screen.getByText('16 US tbsp')).toBeInTheDocument()
  activate('Oven Temperature')
  fireEvent.change(await screen.findByLabelText('Temperature'), {
    target: { value: '32' },
  })
  expect(screen.getByText('0 °C')).toBeInTheDocument()
  activate('Yeast')
  expect(
    await screen.findByText('Approximately 4 g Active dry yeast'),
  ).toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][1].method).toBe('GET')
})
it('saves a measured override only after explicit submission and copies the active result', async () => {
  const custom = {
    ...ref,
    id: 'custom',
    referenceId: 'flour',
    scope: 'private',
    referenceWeightG: 150,
    sourceName: 'Your measured conversion',
    sourceUrl: '',
  }
  const request = vi.fn().mockImplementation((_url, init) =>
    Promise.resolve({
      ok: true,
      json: async () => ({
        references: init.method === 'POST' ? [ref, custom] : [ref],
      }),
    }),
  )
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  vi.stubGlobal('fetch', request)
  render(<BakingConverter ready canSave ingredients={[]} />)
  await screen.findByText('125 g · Flour')
  fireEvent.change(screen.getByLabelText('Measured weight (grams)'), {
    target: { value: '150' },
  })
  expect(request).toHaveBeenCalledTimes(1)
  fireEvent.click(
    screen.getByRole('button', { name: 'Save custom conversion' }),
  )
  await screen.findByText('150 g · Flour')
  expect(screen.getByText('Your custom conversion')).toBeInTheDocument()
  expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({
    referenceId: 'flour',
    referenceWeightG: 150,
    referenceVolumeMl: 236.5882365,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Copy Result' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('150 g · Flour'))
  expect(await screen.findByText('Copied')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Swap units' }))
  expect(screen.getByLabelText('Quantity')).toHaveValue('150')
  expect(screen.getByText('1 US cup · Flour')).toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(2)
})
