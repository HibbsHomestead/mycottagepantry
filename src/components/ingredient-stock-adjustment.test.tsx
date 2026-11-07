import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceApp } from './workspace-app'
import { IngredientStockAdjustment } from './ingredient-stock-adjustment'
import { IngredientCostCards } from './ingredient-cost-cards'
import { TooltipProvider } from './ui/tooltip'
import { inventoryAdjustmentPlan } from '@/lib/inventory-adjustment'
import { demoData } from '@/lib/demo'
import type { Item } from '@/lib/domain'

vi.mock('@netlify/identity', () => ({ onAuthChange: () => () => {} }))
afterEach(() => vi.unstubAllGlobals())

it.each(['each', 'g'])(
  'opens the existing popup in each, submits a total, then reopens six each with canonical %s stock',
  async (unit) => {
    history.replaceState({}, '', '/workspace#Pantry/Ingredients')
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const workspace = demoData()
    workspace.ingredients = [
      {
        id: 'count-cups',
        name: 'Applesauce test cups',
        usedAs: 'ingredient',
        unit,
        storageUnit: 'each',
        recipeUnit: 'each',
        quantity: unit === 'g' ? 200 : 2,
        cost: unit === 'g' ? 0.004 : 0.4,
        threshold: 0,
        inventoryRevision: 'initial',
        conversions:
          unit === 'g'
            ? [
                {
                  from: 'each',
                  to: 'g',
                  amountFrom: 1,
                  amountTo: 100,
                  verified: true,
                },
              ]
            : [],
      },
    ]
    workspace.recipes = []
    workspace.products = []
    workspace.batches = []
    workspace.ledger = []
    const mutations: { action: string; data: Item }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options?: RequestInit) => {
        if (options?.method === 'POST') {
          const mutation = JSON.parse(String(options.body))
          mutations.push(mutation)
          if (mutation.action === 'adjust') {
            const item = workspace.ingredients[0]
            const plan = inventoryAdjustmentPlan(item, mutation.data)
            item.quantity = plan.resultingQuantity
            item.inventoryRevision = 'after-save'
            workspace.ledger.push({
              id: 'new-adjustment',
              name: item.name,
              ingredientId: item.id,
              quantity: plan.change,
              unit: item.unit,
              inventoryQuantity: plan.inventoryQuantity,
              inventoryUnit: plan.inventoryUnit,
              resultingInventoryQuantity: plan.resultingInventoryQuantity,
              type: 'adjustment',
              reason: mutation.data.reason,
            })
          }
        }
        return Response.json({ workspace, role: 'Owner', demo: false })
      }),
    )
    const user = userEvent.setup()
    const app = render(
      <TooltipProvider>
        <WorkspaceApp />
      </TooltipProvider>,
    )
    await waitFor(() =>
      expect(screen.queryByText('Opening your oven…')).not.toBeInTheDocument(),
    )
    async function openAdjustment() {
      await user.click(
        screen.getByRole('button', {
          name: 'Actions for Applesauce test cups',
        }),
      )
      await user.click(
        screen.getByRole('menuitem', { name: 'Adjust / record waste' }),
      )
      return within(screen.getByRole('dialog'))
    }
    let modal = await openAdjustment()
    expect(screen.getByRole('dialog')).toHaveClass('app-dialog')
    expect(modal.getByText('2 each on hand')).toBeVisible()
    expect(modal.getByLabelText(/Quantity change \(each\)/)).toHaveValue(null)
    expect(modal.queryByText(/200 g on hand/)).not.toBeInTheDocument()
    await user.selectOptions(modal.getByLabelText('Adjustment method'), 'total')
    expect(
      modal.getByText(/Sets the entire balance to this count/),
    ).toBeVisible()
    await user.type(modal.getByLabelText(/Total on hand \(each\)/), '6')
    expect(
      modal.getByText('Resulting balance: 6 each (4 each change).'),
    ).toBeVisible()
    await user.type(
      modal.getByLabelText('Reason (required)'),
      'Opening count reviewed',
    )
    await user.click(modal.getByRole('button', { name: 'Save adjustment' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(mutations.filter((m) => m.action === 'adjust')).toHaveLength(1)
    expect(mutations.find((m) => m.action === 'adjust')?.data).toMatchObject({
      id: 'count-cups',
      quantity: 6,
      unit: 'each',
      adjustmentMode: 'total',
      expectedInventoryRevision: 'initial',
    })
    // Remount to exercise GET/reopening, not just the optimistic response.
    app.unmount()
    render(
      <TooltipProvider>
        <WorkspaceApp />
      </TooltipProvider>,
    )
    await waitFor(() =>
      expect(screen.queryByText('Opening your oven…')).not.toBeInTheDocument(),
    )
    modal = await openAdjustment()
    expect(modal.getByText('6 each on hand')).toBeVisible()
    await user.click(modal.getByRole('button', { name: 'Cancel' }))
    history.replaceState({}, '', '/workspace#Pantry/Inventory%20ledger')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await waitFor(() =>
      expect(screen.getByText('Opening count reviewed')).toBeVisible(),
    )
    const row = screen.getByText('Opening count reviewed').closest('tr')!
    expect(within(row).getByText('4')).toBeVisible()
    expect(within(row).getByText('each')).toBeVisible()
  },
)
it('does not relabel a grams balance when no verified weight-per-each relationship exists', () => {
  render(
    <IngredientStockAdjustment
      item={{
        id: 'legacy',
        name: 'Legacy cups',
        unit: 'g',
        storageUnit: 'each',
        quantity: 34,
        conversions: [],
      }}
      draft={{ quantity: 6, unit: 'each', adjustmentMode: 'total' }}
      change={vi.fn()}
    />,
  )
  expect(screen.getByText('Balance unavailable')).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent(
    /verified unit conversion/,
  )
  expect(screen.queryByText('34 each on hand')).not.toBeInTheDocument()
  expect(screen.queryByText(/Resulting balance/)).not.toBeInTheDocument()
})
it('labels the converted cost and quantity together as each, even when the internal basis is grams', () => {
  render(
    <IngredientCostCards
      ingredient={{
        id: 'cost-cups',
        name: 'Test cups',
        unit: 'g',
        storageUnit: 'each',
        recipeUnit: 'each',
        quantity: 600,
        cost: 0.004,
        currentCost: 0.005,
        purchaseQuantity: 1,
        purchaseUnit: 'case',
        packagePrice: 18,
        conversions: [
          {
            from: 'case',
            to: 'each',
            amountFrom: 1,
            amountTo: 36,
            verified: true,
          },
          {
            from: 'each',
            to: 'g',
            amountFrom: 1,
            amountTo: 100,
            verified: true,
          },
        ],
      }}
    />,
  )
  expect(screen.getByText('Cost per each')).toBeVisible()
  expect(screen.getAllByText('$0.50 / each').length).toBeGreaterThan(0)
  expect(screen.getByText('6 each')).toBeVisible()
  expect(screen.queryByText('$0.005 / each')).not.toBeInTheDocument()
})
