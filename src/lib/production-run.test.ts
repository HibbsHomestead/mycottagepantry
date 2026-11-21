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

import { combinedProductionRequirements } from './production-run'
import { productionDefinition } from './production'
import { cardCost } from './product-list'
import { demoData } from './demo'

function plannedKit() {
  const state = demoData()
  const component = state.products[0]
  component.quantity = 0
  component.stockCostKnown = false
  const kit: Item = {
    id: 'isolated-kit',
    name: 'Isolated kit',
    workflow: 'kit',
    assemblyMinutes: 6,
    assemblyRate: 10,
    kitComponents: [{ productId: component.id, quantity: 2, basis: 'package' }],
    packagingLines: [],
  }
  state.products.push(kit)
  const line: Item = {
    id: 'isolated-line',
    name: kit.name,
    productId: kit.id,
    quantity: 3,
    laborMinutes: '',
    definition: productionDefinition(kit, state, {} as Item),
  }
  return { state, component, kit, line }
}
it('uses the All Products package estimate without stock, aggregates repeated kits and charges assembly once', () => {
  const { state, component, line } = plannedKit()
  component.unitsPerPackage = 4
  const before = structuredClone(state)
  const result = combinedProductionRequirements(
    [line, { ...line, id: 'second-line' }],
    state,
  )
  expect(result.requirements).toHaveLength(1)
  expect(result.requirements[0]).toMatchObject({
    quantity: 12,
    unit: 'package',
    costKnown: true,
    costBasis: 'Current product estimate',
    inventoryCostKnown: false,
  })
  expect(result.requirements[0].unitCost).toBe(cardCost(component, state).cost)
  expect(result.total).toBeCloseTo(cardCost(component, state).cost! * 12 + 6)
  expect(result.shortages).toHaveLength(1)
  expect(() => combinedProductionRequirements([line], state, true)).toThrow(
    'stock cost',
  )
  expect(state).toEqual(before)
})
it('prefers inventory valuation and retains strict available-stock checks', () => {
  const { state, component, line } = plannedKit()
  Object.assign(component, { cost: 7, stockCostKnown: true, quantity: 6 })
  expect(combinedProductionRequirements([line], state).total).toBeCloseTo(45)
  expect(combinedProductionRequirements([line], state, true).total).toBeCloseTo(
    45,
  )
  component.quantity = 0
  expect(combinedProductionRequirements([line], state).total).toBeCloseTo(45)
  expect(() => combinedProductionRequirements([line], state, true)).toThrow(
    'available stock',
  )
})
it('retains known subtotal when another exact component lacks cost or its relationship is unavailable', () => {
  const { state, component, kit, line } = plannedKit()
  const missing: Item = {
    id: 'isolated-missing',
    name: component.name,
    workflow: 'resale',
    quantity: 0,
  }
  state.products.push(missing)
  kit.kitComponents.push({
    productId: missing.id,
    quantity: 1,
    basis: 'package',
  })
  line.definition = productionDefinition(kit, state, {} as Item)
  const result = combinedProductionRequirements([line], state)
  expect(result.costKnown).toBe(false)
  expect(result.total).toBeGreaterThan(0)
  expect(
    result.requirements.find((r) => r.itemId === missing.id),
  ).toMatchObject({ costKnown: false })
  state.products = state.products.filter((p) => p.id !== missing.id)
  const unavailable = combinedProductionRequirements([line], state)
  expect(
    unavailable.requirements.find((r) => r.itemId === missing.id)?.costReason,
  ).toContain(missing.id)
  expect(unavailable.total).toBe(result.total)
})
it('keeps an invalid saved line diagnostic without hiding other known lines or mutating the draft', () => {
  const { state, line } = plannedKit()
  const saved = { ...line, id: 'unresolved-line', definition: undefined }
  const before = structuredClone(saved)
  const result = combinedProductionRequirements([line, saved], state)
  expect(result.costKnown).toBe(false)
  expect(result.products[1].error).toContain('relationship')
  expect(result.total).toBeGreaterThan(0)
  expect(saved).toEqual(before)
})

it('adds kit-only packaging and labor once and respects an explicit zero labor override', () => {
  const { state, component, kit, line } = plannedKit()
  state.ingredients.push({
    id: 'isolated-wrap',
    name: 'Isolated wrap',
    usedAs: 'packaging',
    unit: 'each',
    quantity: 50,
    cost: 0.5,
  })
  kit.packagingLines = [
    { ingredientId: 'isolated-wrap', quantity: 1, unit: 'each' },
  ]
  line.definition = productionDefinition(kit, state, {} as Item)
  const material = cardCost(component, state).cost! * 6
  expect(combinedProductionRequirements([line], state).total).toBeCloseTo(
    material + 1.5 + 3,
  )
  expect(
    combinedProductionRequirements([{ ...line, laborMinutes: 0 }], state).total,
  ).toBeCloseTo(material + 1.5)
})
it('labels resale defaults as estimates and never multiplies intact multipack contents', () => {
  const { state, component, line } = plannedKit()
  Object.assign(component, {
    workflow: 'resale',
    name: 'Intact 15-pack',
    purchaseDefaults: { packPrice: 12, itemsPerPack: 1, unit: 'pack' },
  })
  const result = combinedProductionRequirements([line], state)
  expect(result.requirements[0]).toMatchObject({
    quantity: 6,
    unitCost: 12,
    cost: 72,
    costKnown: true,
    costBasis: 'Estimated cost',
  })
  expect(result.total).toBe(75)
})
