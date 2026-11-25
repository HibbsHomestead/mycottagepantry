// @vitest-environment node
import { expect, it } from 'vitest'
import { handleAssortmentLabel } from '../../netlify/lib/assortment-label-handler'
import { assortmentFixture } from '../test/fixtures/assortment'
import {
  assortmentJobCurrent,
  assortmentLabel,
  assortmentSignature,
} from './assortment-labels'
import { basketComponentCosts, type Item } from './domain'
import { kitEstimate } from './kit-estimate'
import { productListMetrics } from './product-list'

it('uses recipe, BOM and resale costs once; cards and details update together and never value missing components at zero', () => {
  const { workspace, basket, flavors, craft, tea } = assortmentFixture()
  const lines = basketComponentCosts(basket, workspace)
  expect(
    lines.map(({ component, unitCost, cost }) => [
      component?.id,
      unitCost,
      cost,
    ]),
  ).toEqual([
    [flavors[0].id, 1.25, 2.5],
    [craft.id, 3, 3],
    [tea.id, 2, 2],
  ])
  expect(kitEstimate(basket, workspace).cost).toMatchObject({
    perPackage: 10.5,
    packagingCost: 1,
    labor: 2,
    overhead: 0,
  })
  flavors[0].ingredient.cost = 0.1
  expect(productListMetrics(basket, workspace).cost).toBe(
    kitEstimate(basket, workspace).cost?.perPackage,
  )
  expect(productListMetrics(basket, workspace).cost).toBe(12.5)
  delete craft.bom
  expect(basketComponentCosts(basket, workspace)[1]).toMatchObject({
    issue: 'Tea towel: Bill of materials is missing.',
  })
  expect(kitEstimate(basket, workspace)).toMatchObject({
    cost: undefined,
    pricing: undefined,
  })
  expect(productListMetrics(basket, workspace)).toMatchObject({
    cost: undefined,
    pricing: undefined,
  })
})

it('keeps one, two, and three flavor declarations separate, including subingredients and intentional allergens', () => {
  const { workspace, spec, flavors } = assortmentFixture()
  for (const size of [1, 2, 3]) {
    const { snapshot } = assortmentLabel(workspace, {
      ...spec,
      expectedLoose: size * 2,
      lines: spec.lines.slice(0, size),
    })
    expect(snapshot.warnings).toEqual([])
    expect(snapshot.sections.map((section) => section.name)).toEqual(
      flavors.slice(0, size).map((flavor) => flavor.name),
    )
    expect(
      snapshot.sections.every(
        (section) => section.contents === '2 loose items',
      ),
    ).toBe(true)
    if (size > 1)
      expect(snapshot.sections[1]).toMatchObject({
        declaration:
          'Ingredients: Chocolate blend (cocoa, chips (sugar, milk))',
        contains: 'CONTAINS: MILK',
        advisory: '',
      })
  }
  flavors[1].ingredient.reviewed = false
  const result = assortmentLabel(workspace, spec)
  expect(result.snapshot.warnings.join(' ')).toMatch(
    /Chocolate muffins:.*verify allergens/,
  )
  expect(() =>
    assortmentLabel(workspace, { ...spec, expectedLoose: 4 }),
  ).toThrow(/intended/)
})

it('uses the fixed basket’s whole selling packages and keeps reviewed supplier allergens separate from cross-contact', () => {
  const { workspace, spec, basket } = assortmentFixture()
  const selection = {
    ...spec,
    productId: basket.id,
    expectedLoose: 0,
    expectedPackages: 4,
    lines: [
      { productId: 'blueberry', quantity: 2, unit: 'package' as const },
      { productId: 'tea-towel', quantity: 1, unit: 'package' as const },
      {
        productId: 'tea',
        quantity: 1,
        unit: 'package' as const,
        declaration: 'Ingredients: black tea, milk powder',
        contains: 'Milk',
        advisory: 'May contain soy.',
        supplierReviewed: true,
      },
    ],
  }
  const { snapshot } = assortmentLabel(workspace, selection)
  expect(snapshot.warnings).toEqual([])
  expect(snapshot.sections.map((section) => section.quantity)).toEqual([
    2, 1, 1,
  ])
  expect(snapshot.sections[1].declaration).toBe('')
  expect(snapshot.sections[2]).toMatchObject({
    contains: 'Contains: Milk',
    advisory: 'May contain soy.',
  })
  expect(() =>
    assortmentLabel(workspace, {
      ...selection,
      lines: [
        { ...selection.lines[0], productId: 'lemon' },
        ...selection.lines.slice(1),
      ],
    }),
  ).toThrow(/Fixed basket contents/)
})

it('saves fixed definitions and separate approved packing groups, confirms reprints and application, and never mutates production, stock or earlier snapshots', async () => {
  const { workspace, spec, basket } = assortmentFixture()
  const unchanged = JSON.stringify([
    workspace.products,
    workspace.recipes,
    workspace.ingredients,
    workspace.batches,
    workspace.ledger,
  ])
  const save = async (table: string, item: Item) => {
    expect(table).toBe('label_print_jobs')
    workspace.label_print_jobs!.push(JSON.parse(assortmentSignature(item)))
  }
  const act = (data: Record<string, unknown>) =>
    handleAssortmentLabel(workspace, data, 'Fixture owner', save)
  const approve = (selection: typeof spec) =>
    act({
      op: 'approve',
      spec: selection,
      reviewed: true,
      signature: assortmentSignature(
        assortmentLabel(workspace, selection).snapshot,
      ),
    })
  await act({ op: 'save-fixed', spec })
  const group = {
    ...spec,
    mode: 'variable' as const,
    group: 'Morning',
    productId: basket.id,
    batchId: 'fixture-run',
    expectedPackages: 2,
    expectedLoose: 2,
    lines: [spec.lines[0], { ...spec.lines[1], unit: 'package' as const }],
  }
  await approve(group)
  const outer = workspace.label_print_jobs!.at(-1)!
  const frozen = structuredClone(outer)
  await act({ op: 'check-print', jobId: outer.id, copies: 2 })
  expect(workspace.label_print_jobs!.at(-1)).toEqual(frozen)
  expect(outer.assortmentSnapshot.sections[1].contents).toBe(
    '2 individually packaged selling units',
  )
  await approve({ ...group, componentId: 'chocolate', copies: 4 })
  expect(
    workspace.label_print_jobs!.at(-1)!.assortmentSnapshot.sections,
  ).toHaveLength(1)
  await expect(
    act({ op: 'applied', jobId: outer.id, copies: 1 }),
  ).rejects.toThrow(/Confirm printing/)
  await act({ op: 'printed', jobId: outer.id, copies: 2 })
  await act({ op: 'printed', jobId: outer.id, copies: 1 })
  await act({ op: 'applied', jobId: outer.id, copies: 2 })
  await expect(
    act({ op: 'applied', jobId: outer.id, copies: 1 }),
  ).rejects.toThrow(/approved copy/)
  await approve({
    ...group,
    group: 'Afternoon',
    containers: 3,
    lines: [{ ...group.lines[0], productId: 'lemon' }, group.lines[1]],
  })
  await expect(
    approve({ ...group, group: 'Too many', containers: 1 }),
  ).rejects.toThrow(/exceed/)
  await approve({
    ...group,
    lines: [{ ...group.lines[0], productId: 'lemon' }, group.lines[1]],
  })
  expect(assortmentJobCurrent(workspace, outer)).toBe(false)
  await expect(
    act({ op: 'check-print', jobId: outer.id, copies: 1 }),
  ).rejects.toThrow(/packing selection changed/)
  const revised = workspace.label_print_jobs!.at(-1)!
  expect(revised.assortmentSupersedes).toContain(outer.id)
  expect(
    JSON.stringify([
      workspace.products,
      workspace.recipes,
      workspace.ingredients,
      workspace.batches,
      workspace.ledger,
    ]),
  ).toBe(unchanged)
  workspace.ingredients[1].statement = 'New chocolate supplier blend'
  expect(assortmentJobCurrent(workspace, revised)).toBe(false)
  await expect(
    act({ op: 'printed', jobId: revised.id, copies: 1 }),
  ).rejects.toThrow(/changed/)
  expect(outer).toEqual(frozen)
})
