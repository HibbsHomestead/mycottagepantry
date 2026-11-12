import {
  ArrowRight,
  Package,
  TriangleAlert,
  CookingPot,
  Boxes,
  Plus,
  Receipt,
  StickyNote,
  ArrowDownLeft,
  Tag,
} from 'lucide-react'
import { money, unitLabel, type Workspace, type Item } from '@/lib/domain'
import { dashboardData, knownNumber } from '@/lib/dashboard'
import { MonthlyFinanceCard } from './monthly-finance-card'
import './workspace-dashboard.css'
type Props = {
  workspace: Workspace
  financialReady?: boolean
  canWrite?: boolean
  go: (page: string, sub?: string) => void
  open: (kind: string, item?: Item) => void
}
const quantity = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)
export function WorkspaceDashboard({
  workspace: w,
  go,
  open,
  financialReady = true,
  canWrite = false,
}: Props) {
  const d = dashboardData(w),
    max = Math.max(1, ...d.trend.map(([, value]) => value)),
    materialCount = w.ingredients.filter((i) => i.usedAs === 'material').length,
    finishedCount = w.products.filter((p) =>
      ['handmade', 'resale'].includes(p.workflow),
    ).length
  return (
    <div className="dashboard-preview">
      <a className="btn secondary" href="#Inventory/Counts">Set up opening inventory / resume physical count</a>
      <section
        className="dashboard-welcome"
        aria-label="Welcome and quick actions"
      >
        <div>
          <span className="eyebrow">A LITTLE ORDER. MORE ROOM TO CREATE.</span>
          <h2>Your pantry, at a glance.</h2>
          <p>
            Keep the next bake moving, from what’s on the shelf to what’s on the
            schedule.
          </p>
        </div>
        <div
          className="dashboard-quick-actions"
          aria-label="Dashboard quick actions"
        >
          {canWrite && (
            <>
              <button className="btn" onClick={() => open('ingredient')}>
                <Plus size={17} />
                Add Item
              </button>
              <button className="btn secondary" onClick={() => open('product')}>
                <Tag size={17} />
                Add product
              </button>
              <button
                className="btn secondary"
                onClick={() => open('receive-picker')}
              >
                <Receipt size={17} />
                Receive stock
              </button>
              <button className="btn secondary" onClick={() => open('batch')}>
                <CookingPot size={17} />
                Start production
              </button>
            </>
          )}
          <button className="btn secondary" onClick={() => go('Labels')}>
            <StickyNote size={17} />
            Open Label Studio
          </button>
        </div>
      </section>
      <section
        className="dashboard-metrics"
        aria-label="Inventory and production overview"
        aria-busy={!financialReady}
      >
        {[
          {
            label: 'Ingredient inventory value',
            value: d.inventoryValue === null ? '—' : money(d.inventoryValue),
            note:
              d.inventoryValue === null
                ? 'Unavailable · quantity or cost needs review'
                : `${d.ingredients.length} tracked ingredients`,
            definition:
              'Sum of on-hand quantity × saved unit cost for tracked ingredients. Packaging and supplies are separate.',
            icon: Package,
            action: () => go('Pantry', 'Ingredients'),
          },
          {
            label: 'Low-stock ingredients',
            value: String(d.low.length),
            note: d.unconfigured
              ? `${d.unconfigured} items need a quantity or reorder point`
              : 'At or below the saved reorder point',
            definition:
              'Count of tracked ingredients with known quantity and threshold, where quantity ≤ threshold. Unconfigured items are excluded and identified.',
            icon: TriangleAlert,
            action: () => go('Pantry', 'Low stock'),
          },
          {
            label: 'Packaging to reorder',
            value: String(d.packagingLow.length),
            note: d.packagingUnconfigured
              ? `${d.packagingUnconfigured} items need a reorder point`
              : 'Packaging at or below its reorder point',
            definition:
              'Count of tracked packaging records at or below their saved threshold. Incoming orders are not deducted.',
            icon: Boxes,
            action: () => go('Pantry', 'Packaging'),
          },
          {
            label: 'Upcoming production',
            value: String(d.upcoming.length),
            note: d.undatedBatches
              ? `${d.undatedBatches} open runs need a valid date`
              : 'Today and the next six calendar days',
            definition:
              'Scheduled and in-progress runs in the next seven calendar days. Completed and cancelled runs are excluded.',
            icon: CookingPot,
            action: () => go('Production'),
          },
        ].map(({ label, value, note, definition, icon: Icon, action }) => (
          <article className="dashboard-metric" key={label}>
            <button onClick={action}>
              <span>
                <Icon size={19} />
                {label}
              </span>
              <strong>{financialReady ? value : '—'}</strong>
              <small>
                {financialReady ? note : 'Loading private records…'}
              </small>
              <ArrowRight className="metric-arrow" size={17} />
            </button>
            <details>
              <summary>How it’s counted</summary>
              <p>{definition}</p>
            </details>
          </article>
        ))}
      </section>
      {(materialCount > 0 || finishedCount > 0) && (
        <section
          className="panel dashboard-stock-strip"
          aria-labelledby="dashboard-stock-title"
        >
          <div className="dashboard-stock-copy">
            <h2 id="dashboard-stock-title">Materials & finished stock</h2>
            <p>
              Input stock and sellable goods have separate balances in one
              inventory.
            </p>
          </div>
          <div className="dashboard-stock-links">
            <button
              className="btn secondary"
              onClick={() => go('Inventory', 'Craft Materials')}
            >
              <Boxes size={17} />
              {materialCount} craft materials
            </button>
            <button
              className="btn secondary"
              onClick={() => go('Inventory', 'Finished Goods')}
            >
              <Package size={17} />
              {finishedCount} finished-stock products
            </button>
          </div>
        </section>
      )}
      <div className="dashboard-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ON YOUR SHELVES</span>
              <h2>Restock watch</h2>
            </div>
            <button
              className="text-button"
              onClick={() => go('Pantry', 'Low stock')}
            >
              View stock <ArrowRight size={16} />
            </button>
          </div>
          {[...d.low, ...d.packagingLow].slice(0, 5).map((i) => (
            <button
              className="dashboard-record"
              key={i.id}
              onClick={() => open('ingredient-detail', i)}
            >
              <span className="dashboard-icon">
                <Package size={20} />
              </span>
              <span>
                <strong>{i.name}</strong>
                <small>
                  {quantity(i.quantity)} {unitLabel(i.unit)} on hand · reorder
                  point {quantity(i.threshold)}
                </small>
              </span>
              <span className="status amber">
                {i.quantity === 0 ? 'Out of stock' : 'Low stock'}
              </span>
            </button>
          ))}
          {!d.low.length && !d.packagingLow.length && (
            <p className="dashboard-empty">
              {d.unconfigured || d.packagingUnconfigured
                ? 'No low stock identified. Complete the missing reorder points to check every item.'
                : 'No tracked items are at or below their reorder point.'}
            </p>
          )}
        </section>
        <MonthlyFinanceCard
          month={new Date()}
          revenue={d.revenue}
          cogs={d.cogs}
          costs={d.costs}
          ready={financialReady}
          incomplete={d.incomplete}
          onFinances={() => go('Finances')}
        />
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">THE NEXT SEVEN DAYS</span>
              <h2>On the bake list</h2>
            </div>
            <button className="text-button" onClick={() => go('Production')}>
              Planner <ArrowRight size={16} />
            </button>
          </div>
          {d.upcoming.slice(0, 4).map((b) => (
            <button
              className="dashboard-record"
              key={b.id}
              onClick={() => go('Production', 'Batch planner')}
            >
              <span className="dashboard-icon">
                <CookingPot size={20} />
              </span>
              <span>
                <strong>{b.name}</strong>
                <small>
                  {b.date} · {String(b.status).replaceAll('_', ' ')}
                </small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
          {!d.upcoming.length && (
            <p className="dashboard-empty">
              No production scheduled in this window. Open the planner to review
              or plan a batch.
            </p>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">RECORDED STOCK MOVEMENTS</span>
              <h2>Recent inventory activity</h2>
            </div>
            <button
              className="text-button"
              onClick={() => go('Pantry', 'Inventory ledger')}
            >
              Ledger <ArrowRight size={16} />
            </button>
          </div>
          {d.activity.map((l) => (
            <div className="dashboard-record" key={l.id}>
              <span className="dashboard-icon">
                <ArrowDownLeft size={20} />
              </span>
              <span>
                <strong>{l.name}</strong>
                <small>
                  {l.date} · {String(l.type || 'movement').replaceAll('_', ' ')}
                </small>
              </span>
              <b>
                {knownNumber(l.quantity)
                  ? `${l.quantity > 0 ? '+' : ''}${quantity(l.quantity)} ${unitLabel(l.unit || '')}`
                  : 'Quantity unavailable'}
              </b>
            </div>
          ))}
          {!d.activity.length && (
            <p className="dashboard-empty">
              No inventory movements recorded yet. Stock receipts and production
              usage appear here after confirmation.
            </p>
          )}
          {!!d.activity.length && (
            <p className="dashboard-caption">
              Newest recorded dates first. Same-day movements may share a date.
            </p>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">CURRENT INVENTORY</span>
              <h2>What’s in the pantry</h2>
            </div>
            <Package size={20} />
          </div>
          <p className="dashboard-caption">
            Tracked item records by saved category. Each record counts once;
            quantities in different units are kept separate.
          </p>
          {d.categories.map(([name, count]) => (
            <div className="dashboard-category" key={name}>
              <span>{name}</span>
              <span className="dashboard-category-bar" aria-hidden="true">
                <i
                  style={{
                    width: `${(count / Math.max(1, ...d.categories.map(([, n]) => n))) * 100}%`,
                  }}
                />
              </span>
              <b>{count}</b>
            </div>
          ))}
          {!d.categories.length && (
            <p className="dashboard-empty">
              Add tracked pantry items to see your category breakdown.
            </p>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">MONTH TO DATE</span>
              <h2>Recorded sales</h2>
            </div>
            <button
              className="text-button"
              onClick={() => go('Finances', 'Sales')}
            >
              Sales <ArrowRight size={16} />
            </button>
          </div>
          <p className="dashboard-caption">
            Recorded revenue excluding collected tax, grouped by sale date. Only
            dates with recorded sales are shown.
          </p>
          {d.invalidSales ? (
            <p className="dashboard-empty">
              Sales amounts are incomplete. Review the sales records.
            </p>
          ) : d.trend.length ? (
            <div
              className="dashboard-sales"
              aria-label="Sales by recorded date"
            >
              {d.trend.map(([date, value]) => (
                <div key={date}>
                  <span>{date.slice(5)}</span>
                  <span className="dashboard-category-bar" aria-hidden="true">
                    <i
                      style={{ width: `${(Math.max(0, value) / max) * 100}%` }}
                    />
                  </span>
                  <b>{money(value)}</b>
                </div>
              ))}
            </div>
          ) : (
            <p className="dashboard-empty">
              No sales recorded this month. A trend appears when dated sales are
              available.
            </p>
          )}
        </section>
      </div>
      <div className="dashboard-footer-actions">
        <span>Keep your costs and purchase orders in view.</span>
        <button
          className="text-button"
          onClick={() => go('Products & Pricing')}
        >
          Review product pricing <ArrowRight size={16} />
        </button>
        <button
          className="text-button"
          onClick={() => go('Pantry', 'Purchase orders')}
        >
          Purchase orders <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}
