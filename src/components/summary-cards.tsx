import type { ReactNode } from 'react'

export function SummaryCards({
  cards,
  className = '',
  label,
}: {
  cards: { label: string; value: ReactNode; icon: ReactNode }[]
  className?: string
  label?: string
}) {
  return (
    <div
      className={`pantry-summary ${className}`}
      role="group"
      aria-label={label}
    >
      {cards.map((card) => (
        <span key={card.label}>
          {card.icon}
          <span>
            {card.label}
            <strong>{card.value}</strong>
          </span>
        </span>
      ))}
    </div>
  )
}
