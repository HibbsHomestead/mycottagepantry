import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AddItemDialog } from './add-item-dialog'
import { demoData } from '@/lib/demo'
import type { Item, Workspace } from '@/lib/domain'
import { TooltipProvider } from './ui/tooltip'
import { ScopedCategorySelect } from './section-categories'

vi.mock('./ingredient-lookup-tools', () => ({
  IngredientLookupTools: ({
    apply,
  }: {
    apply: (patch: Partial<Item>) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        apply({
          name: 'Catalog draft',
          imageAssetId: 'fixture-photo',
          categoryId: 'external-aisle',
          subingredients: 'Verified package statement',
        })
      }
    >
      Apply catalog fixture
    </button>
  ),
}))
vi.mock('./product-link-import', () => ({
  ProductLinkImport: ({
    apply,
    afterLookup,
  }: {
    apply: (patch: Partial<Item>) => void
    afterLookup?: (select: () => void) => React.ReactNode
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          apply({
            brand: 'URL brand',
            category: 'External shop aisle',
            imageAssetId: 'fixture-photo',
          })
        }
      >
        Apply URL fixture
      </button>
      {afterLookup?.(() => {})}
    </>
  ),
}))
afterEach(() => vi.unstubAllGlobals())
function setup(initialValues?: Item) {
  const w = demoData()
  w.settings[0].pantryCategories = [
    {
      id: 'current-managed',
      name: 'Managed fixture name',
      scope: 'food-ingredients',
      active: true,
    },
  ]
  w.graphic_assets ||= []
  w.graphic_assets.push({
    id: 'fixture-photo',
    name: 'Fixture photo',
    url: '/fixture.png',
  })
  const save = vi.fn(async () => {})
  function Harness() {
    const [workspace, setWorkspace] = useState(w)
    return (
      <TooltipProvider>
        <AddItemDialog
          workspace={workspace}
          initialType="ingredient"
          initialValues={initialValues}
          onWorkspace={setWorkspace}
          close={vi.fn()}
          save={save}
        />
      </TooltipProvider>
    )
  }
  return { w, save, start: () => render(<Harness />) }
}
it('catalog and URL imports preserve a deliberate durable category and imported draft fields', async () => {
  const f = setup()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        categories: f.w.settings[0].pantryCategories,
        revision: 3,
      }),
    ),
  )
  f.start()
  const category = screen.getByRole('combobox', {
    name: 'Category',
  })
  await waitFor(() => expect(category).toBeEnabled())
  fireEvent.change(category, { target: { value: 'current-managed' } })
  fireEvent.click(screen.getByText('Apply catalog fixture'))
  fireEvent.click(screen.getByText('Apply URL fixture'))
  expect(category).toHaveValue('current-managed')
  expect(screen.getByLabelText('Item name', { exact: true })).toHaveValue(
    'Catalog draft',
  )
  expect(screen.getByRole('button', { name: 'Remove photo' })).toBeVisible()
  expect(
    screen.getByText(/External category suggestion: External shop aisle/),
  ).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Save item' }))
  await waitFor(() => expect(f.save).toHaveBeenCalled())
  expect(f.save.mock.calls[0]).toMatchObject([
    'ingredients',
    {
      sectionCategoryId: 'current-managed',
      categoryId: 'current-managed',
      category: 'Managed fixture name',
      imageAssetId: 'fixture-photo',
      name: 'Catalog draft',
      brand: 'URL brand',
      subingredients: 'Verified package statement',
    },
  ])
})
it('preserves legacy draft assignment through loading, request failure and retry without selecting the first category', async () => {
  const f = setup({
    id: 'legacy-draft',
    name: 'Legacy draft',
    categoryId: 'retired-fixture',
    category: 'Retired fixture label',
  })
  let release!: (value: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        }),
    ),
  )
  f.start()
  const category = screen.getByRole('combobox', {
    name: 'Category',
  })
  expect(category).toBeDisabled()
  expect(category).toHaveValue('retired-fixture')
  release(Response.json({}, { status: 503 }))
  await screen.findByRole('alert')
  expect(category).toHaveValue('retired-fixture')
  fireEvent.click(screen.getByRole('button', { name: 'Retry categories' }))
  release(
    Response.json({
      categories: f.w.settings[0].pantryCategories,
      revision: 4,
    }),
  )
  await waitFor(() => expect(category).toBeEnabled())
  expect(category).toHaveValue('retired-fixture')
  fireEvent.change(category, { target: { value: 'current-managed' } })
  expect(category).toHaveValue('current-managed')
})
it('clears previous business options while loading another business and distinguishes empty eligible categories', async () => {
  const w = demoData()
  const settings = vi.fn()
  let release!: (value: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        }),
    ),
  )
  const component = (workspace: Workspace) => (
    <ScopedCategorySelect
      workspace={workspace}
      scope="resale-products"
      item={{ id: 'draft', name: 'Draft' }}
      canManage={false}
      onSettings={settings}
      onChange={vi.fn()}
    />
  )
  const result = render(component(w))
  release(Response.json({ categories: [], revision: 1 }))
  await screen.findByText('No active categories configured in this section.')
  const next = {
    ...w,
    settings: [
      {
        ...w.settings[0],
        id: 'second-isolated-business',
        productCategories: [],
      },
    ],
  }
  result.rerender(component(next))
  expect(screen.getByRole('combobox', { name: 'Category' })).toBeDisabled()
  expect(screen.getByText('Loading current categories…')).toBeVisible()
  release(Response.json({ categories: [], revision: 2 }))
  await screen.findByText('No active categories configured in this section.')
})

it('summarizes recorded module balances without counting resale or shared packaging in handmade value', async () => {
  const { ModuleStockSummary } = await import('./module-product-list')
  const w = demoData()
  w.products = [
    {
      id: 'made',
      name: 'Made fixture',
      workflow: 'handmade',
      quantity: 2,
      cost: 3,
      stockCostKnown: true,
      price: 99,
    },
    {
      id: 'bought',
      name: 'Bought fixture',
      workflow: 'resale',
      quantity: 4,
      cost: 7,
      stockCostKnown: true,
    },
  ]
  w.ingredients = [
    {
      id: 'material',
      name: 'Material fixture',
      usedAs: 'material',
      quantity: 3,
      cost: 2,
    },
    {
      id: 'shared',
      name: 'Shared packaging fixture',
      usedAs: 'packaging',
      quantity: 100,
      cost: 5,
    },
  ]
  const before = structuredClone(w)
  const rendered = render(
    <ModuleStockSummary workspace={w} workflow="handmade" />,
  )
  expect(screen.getAllByText('$6.00')).toHaveLength(2)
  expect(screen.queryByText('$28.00')).not.toBeInTheDocument()
  expect(screen.queryByText('$500.00')).not.toBeInTheDocument()
  expect(w).toEqual(before)
  w.products[0].quantity = undefined
  rendered.rerender(<ModuleStockSummary workspace={w} workflow="handmade" />)
  expect(screen.getByText('Review needed')).toBeVisible()
})
