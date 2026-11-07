import type { ReactNode } from 'react'
import './cost-cards.css'

/** Display precision only; costing continues to use the original numbers. */
export function costMoney(value: number, currency = 'USD') {
  if (!Number.isFinite(value)) return 'Cost needs setup'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits:
      value !== 0 && Math.abs(value) < 1
        ? Math.min(8, Math.max(2, 2 - Math.floor(Math.log10(Math.abs(value)))))
        : 2,
    ...(value !== 0 && Math.abs(value) < 0.00000001
      ? { minimumSignificantDigits: 2, maximumSignificantDigits: 3 }
      : {}),
  }).format(value)
}

export function CostCard({
  label,
  value,
  note,
  tone = 'lavender',
}: {
  label: string
  value: ReactNode
  note: ReactNode
  tone?: 'lavender' | 'blue' | 'peach' | 'green' | 'rose' | 'neutral'
}) {
  return (
    <span className={`cost-card cost-card-${tone}`}>
      <small className="cost-card-label">{label}</small>
      <strong>{value}</strong>
      <small className="cost-card-note">{note}</small>
    </span>
  )
}
