/** Development-only browser harness. No production route or authentication bypass. */
import '../styles.css'
import { createRoot } from 'react-dom/client'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { getRouter } from '../router'
import { PantryInventory } from '../components/pantry-inventory'
import { fetchWorkspaceWithDiagnostics } from '../lib/inventory-error-details'

export async function mountInventoryErrorFixture() {
  // Synthetic failed request, followed by a real render-time unit-conversion error.
  // Neither is intended to assert the cause of the customer's reported failure.
  await fetchWorkspaceWithDiagnostics()
  const root = createRootRoute()
  function InventoryFixturePage() {
    return (
      <PantryInventory
        ingredients={[
          {
            id: 'fixture-only',
            name: 'PRIVATE_ITEM_SENTINEL',
            unit: 'lb',
            storageUnit: 'ml',
            quantity: 4,
            cost: 2,
            threshold: 1,
            usedAs: 'ingredient',
          },
        ]}
        filter="All items"
        search=""
        setFilter={() => {}}
        setSearch={() => {}}
        open={() => {}}
      />
    )
  }
  const oven = createRoute({
    getParentRoute: () => root,
    path: '/oven',
    component: InventoryFixturePage,
  })
  const defaults = getRouter().options
  const router = createRouter({
    routeTree: root.addChildren([oven]),
    defaultErrorComponent: defaults.defaultErrorComponent,
    defaultOnCatch: defaults.defaultOnCatch,
    history: createMemoryHistory({ initialEntries: ['/oven'] }),
  })
  const host = document.createElement('div')
  document.body.replaceChildren(host)
  createRoot(host).render(<RouterProvider router={router} />)
}
