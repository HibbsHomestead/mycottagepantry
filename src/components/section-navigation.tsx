import { useId, useRef, useState, type ReactNode } from 'react'
import './section-navigation.css'

/** A single destination list, collapsed behind a disclosure on small screens. */
export function SectionNavigation({
  name,
  active,
  children,
}: {
  name: string
  active: string
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const toggle = useRef<HTMLButtonElement>(null)
  return (
    <nav
      className="internal-section-nav"
      aria-label={`${name} sections`}
      data-expanded={expanded}
    >
      <button
        type="button"
        ref={toggle}
        className="internal-section-toggle"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        {name} · {active}
        <span aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>
      <div
        id={id}
        className="internal-section-links"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a, button')) {
            setExpanded(false)
            if (window.matchMedia('(max-width: 1000px)').matches)
              toggle.current?.focus()
          }
        }}
      >
        {children}
      </div>
    </nav>
  )
}

export function SectionWorkspace({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  return enabled ? (
    <div className="section-workspace">{children}</div>
  ) : (
    <>{children}</>
  )
}
export function SectionContent({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  return enabled ? (
    <div className="section-workspace-content">{children}</div>
  ) : (
    <>{children}</>
  )
}
