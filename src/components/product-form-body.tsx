import type { ReactNode } from 'react'

/** Only the food product dialog opts into this bounded scroll region. */
export function ProductFormBody({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  return enabled ? (
    <div className="food-product-scroll">{children}</div>
  ) : (
    <>{children}</>
  )
}
