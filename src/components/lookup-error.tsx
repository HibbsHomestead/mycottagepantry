import { X } from 'lucide-react'
import { createContext } from 'react'
import type { ProductImportDiagnostics } from '@/lib/product-import-diagnostics'
import { customerMessage } from '@/lib/customer-message'

export const LookupActionContext = createContext<{
  active: string
  start: (action: string) => void
} | null>(null)

/** Display only allowlisted references, never raw exception messages, headers or traces. */
export function LookupError({
  message,
  children,
}: {
  message: string
  code?: string
  diagnostics?: ProductImportDiagnostics | null
  status?: number
  children?: React.ReactNode
}) {
  return (
    <div className="lookup-error">
      <p role="alert">
        <X size={15} aria-hidden="true" />
        <span>{customerMessage(message)}</span>
      </p>
      {children}
      <a href="/support">Contact support</a>
    </div>
  )
}
