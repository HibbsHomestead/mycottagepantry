import type { ReactNode } from 'react'
import { DialogContent, DialogTitle, DialogDescription } from './ui/dialog'

/** Shared bounded confirmation presentation; callers retain their permission,
 * dependency, asset and request handling. */
export function DestructiveConfirmationContent({
  title,
  description,
  children,
  actions,
  busy = false,
}: {
  title: ReactNode
  description: ReactNode
  children?: ReactNode
  actions: ReactNode
  busy?: boolean
}) {
  return (
    <DialogContent
      className="app-dialog item-delete-dialog"
      showCloseButton={!busy}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      <div className="item-delete-body">{children}</div>
      <div className="button-row">{actions}</div>
    </DialogContent>
  )
}
