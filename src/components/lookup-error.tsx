import { X } from 'lucide-react'
import { createContext } from 'react'
import {
  diagnosticUrl,
  type ProductImportDiagnostics,
} from '@/lib/product-import-diagnostics'

export const LookupActionContext = createContext<{
  active: string
  start: (action: string) => void
} | null>(null)

/** Display only allowlisted references, never raw exception messages, headers or traces. */
export function LookupError({
  message,
  code,
  diagnostics,
  status,
  children,
}: {
  message: string
  code?: string
  diagnostics?: ProductImportDiagnostics | null
  status?: number
  children?: React.ReactNode
}) {
  const safeCode =
    typeof code === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(code) ? code : ''
  const reference = diagnostics?.requestId
  const hops = Array.isArray(diagnostics?.hops) ? diagnostics.hops : []
  return (
    <div className="lookup-error">
      <p role="alert">
        <X size={15} aria-hidden="true" />
        <span>{message}</span>
      </p>
      <details key={`${message}-${reference || ''}`}>
        <summary>Error details</summary>
        <div className="lookup-error-references">
          <p>
            {safeCode
              ? `Error code: ${safeCode}`
              : 'No error code was provided.'}
          </p>
          {status && <p>Service response: HTTP {status}</p>}
          {reference && /^[a-zA-Z0-9_-]{1,120}$/.test(reference) && (
            <p>Reference: {reference}</p>
          )}
          {diagnostics?.requestedAt &&
            Number.isFinite(Date.parse(diagnostics.requestedAt)) && (
              <p>{new Date(diagnostics.requestedAt).toISOString()}</p>
            )}
          {diagnostics?.normalizedUrl &&
            (() => {
              try {
                return (
                  <p>
                    Requested product:{' '}
                    {diagnosticUrl(diagnostics.normalizedUrl)}
                  </p>
                )
              } catch {
                return null
              }
            })()}
          {hops.slice(0, 8).map((hop, index) => {
            let url = ''
            try {
              url = diagnosticUrl(hop.url)
            } catch {
              /* Invalid references are omitted. */
            }
            return url ? (
              <p key={index}>
                {url}
                {Number.isInteger(hop.status) ? ` · HTTP ${hop.status}` : ''}
                {hop.attempt ? ` · attempt ${hop.attempt}` : ''}
                {hop.browserRedirect?.kind === 'error'
                  ? ' · error-page browser redirect was not followed'
                  : ''}
              </p>
            ) : null
          })}
          {children}
        </div>
      </details>
    </div>
  )
}
