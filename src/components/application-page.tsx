import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './application-page.css'

const PageSlots = createContext<{
  overview: HTMLDivElement | null
  actions: HTMLDivElement | null
  setOverview: (node: HTMLDivElement | null) => void
  setActions: (node: HTMLDivElement | null) => void
} | null>(null)

/** Page slots keep specialized workflows mounted beside their own state. */
export function ApplicationPage({
  children,
  className,
}: {
  children: ReactNode
  className: string
}) {
  const [overview, setOverview] = useState<HTMLDivElement | null>(null)
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  return (
    <PageSlots.Provider value={{ overview, actions, setOverview, setActions }}>
      <main className={`${className} application-page`}>{children}</main>
    </PageSlots.Provider>
  )
}
export function PageOverviewOutlet() {
  const slots = useContext(PageSlots)
  return <div className="page-overview" ref={slots?.setOverview} />
}
export function PageActionsOutlet() {
  const slots = useContext(PageSlots)
  return <div className="page-action-toolbar" ref={slots?.setActions} />
}
export function PageOverview({ children }: { children: ReactNode }) {
  const slots = useContext(PageSlots)
  return slots ? (
    slots.overview && createPortal(children, slots.overview)
  ) : (
    <>{children}</>
  )
}
export function PageActions({ children }: { children: ReactNode }) {
  const slots = useContext(PageSlots)
  return slots ? (
    slots.actions && createPortal(children, slots.actions)
  ) : (
    <>{children}</>
  )
}
