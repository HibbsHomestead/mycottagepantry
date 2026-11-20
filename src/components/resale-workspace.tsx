import { useState } from 'react'
import type { Item, Workspace } from '@/lib/domain'
import { inventoryQuantity } from '@/lib/inventory-quantity'
import { ModuleProductList, ModuleStockSummary } from './module-product-list'
import { SectionCategoryTools } from './section-categories'
import { PageOverview } from './application-page'
import { stockUnitLabel } from '@/lib/resale-stock'

export function ResaleWorkspace({
  workspace,
  role,
  tab,
  open,
  onSettings,
}: {
  workspace: Workspace
  role: string
  tab: string
  open: (kind: string, item?: Item) => void
  onSettings: (patch: Partial<Item>) => void
}) {
  const [search, setSearch] = useState('')
  const manage = ['Owner', 'Manager'].includes(role)
  const products = workspace.products.filter((p) => p.workflow === 'resale')
  return (
    <div className="handmade-workspace catalog-page">
      <PageOverview>
        <ModuleStockSummary workspace={workspace} workflow="resale" />
      </PageOverview>
      <h2>{tab}</h2>
      <p>
        Purchased merchandise · the same sellable records shown in All Products.
        Receiving uses the existing purchase and stock ledger.
      </p>
      {tab === 'Categories' ? (
        <SectionCategoryTools
          workspace={workspace}
          scope="resale-products"
          canManage={manage}
          onSettings={onSettings}
        />
      ) : tab === 'Receiving' ? (
        <section className="panel">
          <label>
            Find resale item
            <input
              aria-label="Find resale item"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {products
            .filter(
              (p) =>
                !p.archived &&
                p.name.toLowerCase().includes(search.toLowerCase()),
            )
            .map((p) => (
              <div className="handmade-run" key={p.id}>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {inventoryQuantity(p.quantity)}{' '}
                    {stockUnitLabel(p, Number(p.quantity || 0))} on hand
                  </small>
                </span>
                {manage && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => open('receive', p)}
                  >
                    Receive stock
                  </button>
                )}
              </div>
            ))}
          {!products.length && (
            <p>Create a resale item before receiving stock.</p>
          )}
        </section>
      ) : (
        <ModuleProductList
          workspace={workspace}
          workflow="resale"
          manage={manage}
          onSettings={onSettings}
          open={open}
        />
      )}
    </div>
  )
}
