import { useState, type ComponentProps } from 'react'
import { ActionTip } from './action-tip'
import './inventory-tools.css'
import './pantry-cards.css'
import './catalog-controls.css'

export function CatalogAction({
  label,
  children,
  primary,
  ...props
}: ComponentProps<'button'> & { label: string; primary?: boolean }) {
  return (
    <ActionTip label={label}>
      <button
        {...props}
        type="button"
        aria-label={label}
        className={`btn secondary${primary ? ' catalog-primary' : ''}`}
      >
        {children}
      </button>
    </ActionTip>
  )
}

export function useCatalogView(
  savedView: string | undefined,
  onView: (view: 'cards' | 'table') => void,
) {
  const [choice, setChoice] = useState<{
    source: string | undefined
    view: 'cards' | 'table'
  } | null>(null)
  const view =
    choice?.source === savedView && choice
      ? choice.view
      : savedView === 'table'
        ? 'table'
        : 'cards'
  return [
    view,
    (next: 'cards' | 'table') => {
      setChoice({ source: savedView, view: next })
      onView(next)
    },
  ] as const
}

export function CatalogViewToggle({
  view,
  onView,
  label,
}: {
  view: 'cards' | 'table'
  onView: (view: 'cards' | 'table') => void
  label: string
}) {
  return (
    <div className="pantry-view-toggle" role="group" aria-label={label}>
      {(['cards', 'table'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onView(v)}
        >
          {v === 'cards' ? 'Cards' : 'Table'}
        </button>
      ))}
    </div>
  )
}
