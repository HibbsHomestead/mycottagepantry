import { expect, it } from 'vitest'
import { mixedPackFixture } from '../test/fixtures/mixed-pack'
import { assortmentJobCurrent, assortmentLabel, assortmentLabelText, fixedAssortmentContents, type AssortmentSpec } from './assortment-labels'
import { productCosting, validateKit } from './domain'
import { productionDefinition, productionRequirements } from './production'
import { basketDefinitionChanged } from './production-checklist'
import { emptyGrocerySources, generateGroceryList } from './grocery-list'

it('uses recipe output cost, or full wrapped stock cost only when explicitly chosen', () => {
  const { workspace, pack, outputs, wrapped, wrap } = mixedPackFixture()
  const cost = productCosting(pack, workspace)
  expect(cost.ingredient).toBeCloseTo(3.75)
  expect(cost.packagingCost).toBeCloseTo(0.8)
  expect(cost.labor).toBeCloseTo(0.2)
  expect(cost.total).toBeCloseTo(4.75)
  const packaged = { ...pack, kitComponents: [{ productId: wrapped.id, basis: 'package', quantity: 3 }, pack.kitComponents[1]] }
  expect(productCosting(packaged, workspace).total - cost.total).toBeCloseTo(1.05)
  expect(() => validateKit({ ...pack, kitComponents: [{ ...pack.kitComponents[0], productId: wrapped.id }, pack.kitComponents[1]] }, workspace)).toThrow(/separate unpackaged recipe output/i)
  const run = productionDefinition(outputs[0], workspace, { quantity: 6, unit: 'each', verified: true })
  expect(run.product.unitsPerPackage).toBe(1)
  expect(productionRequirements(run, 30).requirements.some((row) => row.itemId === wrap.id)).toBe(false)
  const withPackingOverhead = { ...pack, assemblyOverhead: 0.15 }
  expect(productCosting(withPackingOverhead, workspace).total).toBeCloseTo(4.9)
  expect(productionRequirements(productionDefinition(withPackingOverhead, workspace, {}), 10).cost.overhead).toBeCloseTo(1.5)
})

it('requires fresh review for a changed combination or reviewed ingredient source', () => {
  const { workspace, pack, container, labels, template, flour } = mixedPackFixture()
  const spec: AssortmentSpec = { name: pack.name, productId: pack.id, batchId: '', group: '', componentId: '', templateId: template.id, packagingId: labels.id, mode: 'fixed', containers: 10, copies: 20, ...fixedAssortmentContents(pack) }
  const { snapshot } = assortmentLabel(workspace, spec)
  const text = assortmentLabelText(snapshot).join('\n')
  expect(text).toContain('3 blueberry muffins + 3 cranberry muffins')
  expect(text).toMatch(/Ingredients:.*blueberry fruit/)
  expect(text).toMatch(/Ingredients:.*cranberry fruit/)
  expect(text).toContain('MILK')
  expect(snapshot.warnings).toEqual([])
  const job = { id: 'mixed-job', name: pack.name, assortmentSpec: spec, assortmentSnapshot: snapshot }
  expect(assortmentJobCurrent(workspace, job)).toBe(true)
  flour.reviewed = false
  expect(assortmentJobCurrent(workspace, job)).toBe(false)
  flour.reviewed = true
  const before = productionDefinition(pack, workspace, {})
  pack.kitComponents[0].quantity = 2
  pack.kitComponents[1].quantity = 4
  const after = productionDefinition(pack, workspace, {})
  expect(basketDefinitionChanged({ id: 'line', name: pack.name, productId: pack.id, quantity: 10, definition: before }, after, workspace)).toBe(true)
  expect(assortmentJobCurrent(workspace, job)).toBe(false)
  const needs = productionRequirements(before, 10).requirements
  expect(needs.find((row) => row.itemId === container.id)?.quantity).toBe(10)
  expect(needs.find((row) => row.itemId === labels.id)?.quantity).toBe(20)
})

it('combines shared prep demand from both loose flavors and uses available prep before expanding purchases', () => {
  const { workspace, recipes, pack } = mixedPackFixture()
  workspace.ingredients.push(
    { id: 'mixed-prep-stock', name: 'Prepared muffin base', unit: 'g', quantity: 80, cost: 0.02, compoundRecipeId: 'mixed-prep' },
    { id: 'mixed-prep-input', name: 'Muffin base blend', unit: 'g', quantity: 0, cost: 0.01 },
  )
  workspace.recipes.push({ id: 'mixed-prep', name: 'Prepare muffin base', yield: 80, yieldUnit: 'g', compound: true, lines: [{ ingredientId: 'mixed-prep-input', quantity: 80, unit: 'g' }] })
  for (const recipe of recipes)
    recipe.lines.push({ ingredientId: 'mixed-prep-stock', quantity: 40, unit: 'g' })
  const id = 'mixed-prep-parent'
  workspace.batches.push({ id, name: pack.name, status: 'draft', productionVersion: 2, lines: [{ id: 'mixed-prep-line', name: pack.name, productId: pack.id, quantity: 10, definition: productionDefinition(pack, workspace, {}), basketPlan: {} }] })
  const grocery = generateGroceryList(workspace, { ...emptyGrocerySources, runs: [id] }, 'mixed-prep-use', '2026-11-25')
  expect(grocery.prep.find((row) => row.name === 'Prepared muffin base')).toMatchObject({ needed: 200, onHand: 80, toMake: 120 })
  expect(grocery.lines.find((row) => row.name === 'Muffin base blend')).toMatchObject({ needed: 120, toBuy: 120 })
})
