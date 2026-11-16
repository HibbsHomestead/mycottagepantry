import { expect, it } from 'vitest'
import { productionRunLines } from './production-run'
import type { Item } from './domain'
it('adapts old single-product runs repeatedly without rewriting finalized data or inventory links', () => {
  const run: Item = {
    id: 'historical-run',
    name: 'Historical batch',
    productionVersion: 1,
    productId: 'product',
    status: 'completed',
    quantity: 4,
    actualYield: 3,
    waste: 1,
    historicalCost: 28,
    completedAt: '2026-01-01',
    usage: [{ id: 'original-movement', quantity: 7 }],
    costSnapshot: { total: 28 },
  }
  const before = structuredClone(run)
  expect(productionRunLines(run)).toEqual(productionRunLines(run))
  expect(productionRunLines(run)[0]).toMatchObject({
    productId: 'product',
    quantity: 4,
    output: 3,
    status: 'completed',
    historicalCost: 28,
    historicalUsage: before.usage,
    costSnapshot: before.costSnapshot,
  })
  expect(run).toEqual(before)
})
it('preserves recipe-only legacy runs for explicit product mapping rather than inferring a product', () => {
  expect(
    productionRunLines({
      id: 'legacy-recipe',
      name: 'Recipe plan',
      recipeId: 'recipe',
    }),
  ).toEqual([])
})

it('uses the saved complete-run estimate in variance reports without requiring one recipe', async () => {
  const { reportRows } = await import('./reports')
  const { demoData } = await import('./demo')
  const w = demoData()
  w.batches = [
    {
      id: 'multi-product',
      name: 'Mixed run',
      productionVersion: 2,
      estimatedCost: 24,
      historicalCost: 26,
      status: 'completed',
    },
  ]
  expect(reportRows('Batch cost variance', w)[0]).toMatchObject({
    plannedCost: 24,
    historicalCost: 26,
    variance: 2,
  })
})
