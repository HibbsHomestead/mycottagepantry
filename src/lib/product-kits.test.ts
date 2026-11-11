// @vitest-environment node
import { expect, it } from 'vitest'
import { demoData } from './demo'
import { productCosting, profitability, validateKit, type Item } from './domain'

it('costs two products with multiple packages, additional packaging and assembly; tracks changes without changing stock', () => {
  const workspace = demoData()
  const [a, b] = workspace.products
  const packaging = workspace.ingredients.find((i) => i.usedAs === 'packaging')!
  const kit: Item = {
    id: 'holiday-kit',
    name: 'Holiday bake drop',
    workflow: 'kit',
    price: 40,
    assemblyMinutes: 15,
    assemblyRate: 20,
    kitComponents: [
      { productId: a.id, quantity: 2, basis: 'package' },
      { productId: b.id, quantity: 1, basis: 'package' },
    ],
    packagingLines: [
      { ingredientId: packaging.id, quantity: 1, unit: packaging.unit },
    ],
  }
  const before = JSON.stringify(workspace)
  const estimate = productCosting(kit, workspace)
  expect(estimate.ingredient).toBeCloseTo(
    productCosting(a, workspace).perPackage * 2 +
      productCosting(b, workspace).perPackage,
    10,
  )
  expect(estimate.labor).toBe(5)
  expect(estimate.total).toBeCloseTo(
    estimate.ingredient + estimate.packagingCost + 5,
    10,
  )
  expect(estimate.perPackage).toBe(estimate.total)
  expect(
    profitability(kit, estimate.total, workspace.settings[0]).profit,
  ).toBeCloseTo(40 - estimate.total)
  expect(JSON.stringify(workspace)).toBe(before)
  const reopened = JSON.parse(JSON.stringify(kit))
  expect(productCosting(reopened, workspace)).toEqual(estimate)
  const input = workspace.ingredients.find(
    (i) =>
      i.id ===
      workspace.recipes.find((r) => r.id === a.recipeId)!.lines[0].ingredientId,
  )!
  input.currentCost = Number(input.currentCost ?? input.cost) * 2
  expect(productCosting(kit, workspace).total).toBeGreaterThan(estimate.total)
  a.archived = true
  expect(productCosting(kit, workspace).lines[0].name).toBe(a.name)
  input.needsCostSetup = true
  expect(() => productCosting(kit, workspace)).toThrow(/incomplete/)
})
it('rejects unsupported contents, fractional packages, missing components, duplicates and kit nesting', () => {
  const w = demoData(),
    p = w.products[0]
  const kit: Item = {
    id: 'kit',
    name: 'Kit',
    workflow: 'kit',
    kitComponents: [{ productId: p.id, quantity: 1, basis: 'package' }],
  }
  expect(() => validateKit(kit, w)).not.toThrow()
  for (const patch of [
    { basis: 'content', quantity: 6 },
    { quantity: 0 },
    { quantity: 0.5 },
  ])
    expect(() =>
      validateKit(
        { ...kit, kitComponents: [{ ...kit.kitComponents[0], ...patch }] },
        w,
      ),
    ).toThrow()
  expect(() =>
    validateKit(
      { ...kit, kitComponents: [...kit.kitComponents, ...kit.kitComponents] },
      w,
    ),
  ).toThrow(/duplicate/)
  expect(() =>
    validateKit(
      {
        ...kit,
        kitComponents: [
          { productId: 'missing', quantity: 1, basis: 'package' },
        ],
      },
      w,
    ),
  ).toThrow(/unavailable/)
  w.products.push(kit)
  expect(() =>
    validateKit(
      {
        ...kit,
        kitComponents: [{ productId: kit.id, quantity: 1, basis: 'package' }],
      },
      w,
    ),
  ).toThrow(/Kits cannot contain kits/)
})
