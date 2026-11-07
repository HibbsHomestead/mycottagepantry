import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceApp } from './workspace-app'
import { TooltipProvider } from './ui/tooltip'
import { IngredientDetail } from './ingredient-detail'
import { demoData } from '@/lib/demo'
import type { Item } from '@/lib/domain'
import { updateIngredient } from '@/lib/ingredients'

vi.mock('@netlify/identity', () => ({ onAuthChange: () => () => {} }))
afterEach(() => vi.unstubAllGlobals())

async function start(section = 'Pantry') {
  history.replaceState({}, '', '/workspace#' + section)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  const workspace = demoData()
  const mutations: { action: string; table: string; data: Item }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('productImport'))
        return Response.json({
          products: [
            {
              title: 'Imported bags',
              fields: {
                purchaseQuantity: 3,
                purchaseUnit: 'box',
                subingredients: 'Stored imported declaration',
              },
              imageUrl: '',
              sourceUrl: 'https://example.org/bags',
              checkedAt: '2026-11-02T00:00:00Z',
              warnings: [],
              conditions: [],
            },
          ],
        })
      if (options?.method === 'POST') {
        const mutation = JSON.parse(String(options.body))
        mutations.push(mutation)
        if (mutation.action === 'save' && mutation.table === 'ingredients')
          workspace.ingredients.push({
            ...mutation.data,
            quantity: mutation.data.purchaseQuantity,
            cost: mutation.data.packagePrice / mutation.data.purchaseQuantity,
          })
        if (mutation.action === 'ingredientUpdate') {
          const index = workspace.ingredients.findIndex(
            (i) => i.id === mutation.data.id,
          )
          workspace.ingredients[index] = updateIngredient(
            workspace.ingredients[index],
            mutation.data,
          )
        }
      }
      return Response.json({ workspace, role: 'Owner', demo: false })
    }),
  )
  render(
    <TooltipProvider>
      <WorkspaceApp />
    </TooltipProvider>,
  )
  await waitFor(() =>
    expect(screen.queryByText('Opening your oven…')).not.toBeInTheDocument(),
  )
  return { workspace, mutations, user: userEvent.setup() }
}

it('creates packaging through Add Item with optional initial stock and reopens the saved item', async () => {
  const { user, mutations } = await start('Pantry/Packaging')
  await user.click(screen.getAllByRole('button', { name: 'Add Item' })[0])
  const modal = within(screen.getByRole('dialog'))
  expect(modal.getByLabelText('Item Type')).toHaveValue('packaging')
  await user.click(modal.getByRole('tab', { name: 'Purchase & Stock' }))
  expect(
    modal.getByLabelText('Purchase unit', { exact: true, selector: 'select' }),
  ).toHaveValue('each')
  expect(modal.getByLabelText('Stock / display unit')).toHaveValue('each')
  expect(modal.queryByLabelText('Ingredient statement')).not.toBeInTheDocument()
  await user.click(modal.getByRole('tab', { name: 'Details' }))
  fireEvent.change(modal.getByLabelText('Item name'), {
    target: { value: 'Pantry test bags' },
  })
  await user.click(modal.getByRole('tab', { name: 'Purchase & Stock' }))
  await user.click(
    modal.getByLabelText('Add opening stock / record a purchase now.'),
  )
  fireEvent.change(modal.getByLabelText('Quantity received'), {
    target: { value: '100' },
  })
  fireEvent.change(modal.getByLabelText('Opening stock value'), {
    target: { value: '12' },
  })
  await user.click(modal.getByRole('button', { name: 'Save item' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(mutations.at(-1)!.data).toMatchObject({
    inventoryCreation: true,
    usedAs: 'packaging',
    purchaseUnit: 'each',
    unit: 'each',
    purchaseQuantity: '100',
    packagePrice: '12',
  })
  await user.click(
    within(screen.getByRole('article', { name: 'Pantry test bags' })).getByRole(
      'button',
      { name: 'Edit Packaging' },
    ),
  )
  const edit = within(screen.getByRole('dialog'))
  expect(edit.getByRole('heading', { name: 'Edit Packaging' })).toBeVisible()
  expect(edit.getByLabelText('Purchase unit')).toHaveValue('each')
  expect(edit.getByLabelText('Purchase package quantity')).toHaveValue('100')
})
it('keeps shared edits and food drafts when changing Item Type without requiring hidden fields', async () => {
  const { user, mutations } = await start()
  await user.click(screen.getAllByRole('button', { name: 'Add Item' })[0])
  const modal = within(screen.getByRole('dialog'))
  expect(modal.getByLabelText('Item Type')).toHaveValue('')
  await user.selectOptions(modal.getByLabelText('Item Type'), 'ingredient')
  fireEvent.change(modal.getByLabelText('Item name'), {
    target: { value: 'Shared name' },
  })
  await user.click(modal.getByRole('tab', { name: 'Ingredients & allergens' }))
  fireEvent.change(modal.getByLabelText('Ingredient statement'), {
    target: { value: 'Saved food declaration' },
  })
  await user.selectOptions(modal.getByLabelText('Item Type'), 'packaging')
  expect(modal.getByLabelText('Item name')).toHaveValue('Shared name')
  expect(modal.queryByLabelText('Ingredient statement')).not.toBeInTheDocument()
  await user.selectOptions(modal.getByLabelText('Item Type'), 'ingredient')
  expect(modal.getByLabelText('Ingredient statement')).toHaveValue(
    'Saved food declaration',
  )
  await user.selectOptions(modal.getByLabelText('Item Type'), 'packaging')
  await user.click(modal.getByRole('button', { name: 'Save item' }))
  await waitFor(() => expect(mutations).toHaveLength(1))
  expect(mutations[0].data).not.toHaveProperty('statement')
  expect(mutations[0].data.initialStock).toBe(false)
})
it('reviews URL imports before applying values to the selected type', async () => {
  const { user } = await start('Pantry/Packaging')
  await user.click(screen.getAllByRole('button', { name: 'Add Item' })[0])
  const modal = within(screen.getByRole('dialog'))
  await user.click(modal.getByRole('button', { name: 'URL' }))
  fireEvent.change(modal.getByLabelText('Product URL'), {
    target: { value: 'https://example.org/bags' },
  })
  await user.click(modal.getByRole('button', { name: 'Import details' }))
  expect(
    modal.getByLabelText('Purchase unit', { exact: true, selector: 'select' }),
  ).toHaveValue('each')
  await user.click(modal.getByRole('checkbox', { name: 'Purchase unit' }))
  await user.click(modal.getByRole('button', { name: 'Apply selected fields' }))
  expect(
    modal.getByLabelText('Purchase unit', { exact: true, selector: 'select' }),
  ).toHaveValue('box')
  expect(modal.getByLabelText('Item Type')).toHaveValue('packaging')
  expect(modal.queryByLabelText('Ingredient statement')).not.toBeInTheDocument()
})

it.each(['box', 'case', 'roll'])(
  'preserves an existing %s and its costs when saving and reopening',
  async (purchaseUnit) => {
    const workspace = demoData()
    let item = {
      ...workspace.ingredients.find((i) => i.id === 'bags')!,
      categoryId: 'packaging',
      purchaseQuantity: 2,
      purchaseUnit,
      packagePrice: 24,
      currentCost: 0.13,
      subingredients: 'Retain declaration',
      allergens: ['Wheat'],
      reviewed: true,
      conversions: [
        {
          from: purchaseUnit,
          to: 'each',
          amountFrom: 1,
          amountTo: 100,
          verified: true,
        },
      ],
    }
    const original = { ...item }
    const save = vi.fn(async (_action, data) => {
      item = updateIngredient(item, data) as typeof item
    })
    const props = {
      workspace,
      canEdit: true,
      save,
      close: vi.fn(),
      open: vi.fn(),
      onWorkspace: vi.fn(),
    }
    const { rerender } = render(
      <IngredientDetail ingredient={item} initialEditing {...props} />,
    )
    expect(screen.getByLabelText('Purchase unit')).toHaveValue(purchaseUnit)
    expect(
      screen.queryByLabelText('Ingredient statement name'),
    ).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Save packaging' }),
    )
    expect(save).toHaveBeenCalledOnce()
    expect(item).toMatchObject(original)
    rerender(<IngredientDetail ingredient={item} {...props} />)
    expect(
      screen.getByRole('heading', { name: 'Packaging details' }),
    ).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit Packaging' }),
    )
    expect(screen.getByLabelText('Purchase unit')).toHaveValue(purchaseUnit)
    expect(screen.getByLabelText('Category')).toHaveValue('packaging')
    expect(screen.getByLabelText('Package price')).toHaveValue(24)
  },
)
