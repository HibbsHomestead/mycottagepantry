import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProductionRun } from './production-run'
import { demoData } from '../lib/demo'
import { productionDefinition } from '../lib/production'
import type { Item } from '../lib/domain'
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
it('changing a saved line confirms lost actuals and recalculates from the new BOM', () => {
  const state = demoData()
  const p = state.products[0]
  const r = state.recipes.find((r) => r.id === p.recipeId)!
  r.yieldUnit = 'each'
  const mapping = {
    id: '',
    name: '',
    quantity: 1,
    unit: 'each',
    verified: true,
  }
  const definition = productionDefinition(p, state, mapping)
  const material = state.ingredients[0]
  material.usedAs = 'material'
  const craft: Item = {
    id: 'craft-product',
    name: 'Craft card',
    workflow: 'handmade',
    bom: {
      id: 'craft-bom',
      name: 'Craft card BOM',
      output: 1,
      laborMinutes: 5,
      laborRate: 10,
      overhead: 0,
      scrapPercent: 0,
      lines: [{ ingredientId: material.id, quantity: 1, unit: material.unit }],
    },
  }
  state.products.push(craft)
  const run: Item = {
    id: 'saved-run',
    name: 'Saved run',
    productionVersion: 2,
    revision: 1,
    status: 'draft',
    date: '2026-11-16',
    lines: [
      {
        id: 'saved-line',
        name: p.name,
        productId: p.id,
        quantity: 2,
        output: 2,
        laborMinutes: 10,
        usage: { [material.id]: 5 },
        mapping,
        definition,
      },
    ],
  }
  state.batches.push(run)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(
    <ProductionRun
      state={state}
      run={run}
      mutate={vi.fn()}
      edit={vi.fn()}
      startComponent={vi.fn()}
      busy={false}
    />,
  )
  fireEvent.change(
    screen.getByRole('combobox', { name: 'Product' }),
    { target: { value: craft.id } },
  )
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByText(/BOM: Craft card BOM/)).toBeTruthy()
  expect(screen.queryByText(new RegExp(`Recipe: ${r.name}`))).toBeNull()
  expect(
    (screen.getByLabelText('Actual labor (minutes)') as HTMLInputElement).value,
  ).toBe('')
  expect(
    (
      screen.getByLabelText(
        'Actual good output (selling packages / finished units)',
      ) as HTMLInputElement
    ).value,
  ).toBe('')
})
