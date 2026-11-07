import { ArrowRight, Sprout, ReceiptText, Coins, Wallet } from 'lucide-react'
import { money } from '@/lib/domain'
import './monthly-finance-card.css'
type Props = {
  month: Date
  revenue: number
  cogs: number
  costs: number
  ready: boolean
  incomplete: boolean
  onFinances: () => void
}
export function MonthlyFinanceCard({
  month,
  revenue,
  cogs,
  costs,
  ready,
  incomplete,
  onFinances,
}: Props) {
  const known =
    ready && !incomplete && [revenue, cogs, costs].every(Number.isFinite)
  const profit = revenue - cogs - costs
  const tone = !known
    ? 'unknown'
    : profit < 0
      ? 'loss'
      : profit === 0
        ? 'neutral'
        : 'positive'
  const segments = [
    { label: 'Cost of goods sold', value: cogs, key: 'cogs' },
    { label: 'Expenses & fees', value: costs, key: 'expenses' },
    { label: 'Estimated net profit', value: profit, key: 'profit' },
  ]
  const reconciles =
    known &&
    revenue > 0 &&
    segments.every((s) => s.value >= 0) &&
    Math.abs(segments.reduce((sum, s) => sum + s.value, 0) - revenue) < 0.005
  return (
    <section
      className="panel month-panel monthly-finance"
      aria-labelledby="monthly-finance-title"
      aria-busy={!ready}
    >
      <header className="monthly-finance-heading">
        <div>
          <span className="eyebrow">
            {month
              .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
              .toUpperCase()}{' '}
            · MONTH TO DATE
          </span>
          <h2 id="monthly-finance-title">Your month in the making</h2>
          <p>A little look at the business you’re building.</p>
        </div>
        <Sprout size={22} aria-hidden="true" />
      </header>
      <div className={`monthly-profit ${tone}`}>
        <span>Estimated net profit</span>
        <strong>{known ? money(profit) : '—'}</strong>
        <small>
          {!ready
            ? 'Loading financial details…'
            : !known
              ? 'Cost incomplete — some financial amounts or cost snapshots are missing.'
              : profit < 0
                ? 'Estimated loss after costs, expenses and fees.'
                : 'After cost of goods sold, expenses and fees.'}
        </small>
      </div>
      {!known && ready && (
        <p className="monthly-warning" role="status">
          Some details are missing. Review finances before relying on this
          estimate.
        </p>
      )}
      <dl className="monthly-metrics">
        {[
          { label: 'Sales excluding tax', value: revenue, Icon: Wallet },
          { label: 'Cost of goods sold', value: cogs, Icon: Coins },
          { label: 'Expenses & fees', value: costs, Icon: ReceiptText },
        ].map(({ label, value, Icon }) => (
          <div key={label}>
            <dt>
              <Icon size={16} aria-hidden="true" />
              {label}
            </dt>
            <dd>{known ? money(value) : '—'}</dd>
          </div>
        ))}
      </dl>
      {reconciles ? (
        <div className="monthly-breakdown">
          <div
            className="monthly-segments"
            role="img"
            aria-label={segments
              .map(
                (s) =>
                  `${s.label}: ${money(s.value)} (${((s.value / revenue) * 100).toFixed(1)}% of sales)`,
              )
              .join('; ')}
          >
            {segments.map((s) => (
              <span
                key={s.key}
                className={s.key}
                style={{ width: `${(s.value / revenue) * 100}%` }}
              />
            ))}
          </div>
          <ul className="monthly-legend">
            {segments.map((s) => (
              <li key={s.key}>
                <i className={s.key} aria-hidden="true" />
                {s.label}
              </li>
            ))}
          </ul>
        </div>
      ) : known ? (
        <p className="monthly-numeric">
          {money(revenue)} sales − {money(cogs)} cost of goods sold −{' '}
          {money(costs)} expenses & fees = {money(profit)} estimated net profit.
        </p>
      ) : null}
      <footer>
        <button className="btn" onClick={onFinances}>
          View finances <ArrowRight size={16} aria-hidden="true" />
        </button>
      </footer>
    </section>
  )
}
