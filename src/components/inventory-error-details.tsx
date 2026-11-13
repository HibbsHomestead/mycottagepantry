import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  createInventoryErrorDetails,
  inventoryErrorLocation,
  inventoryErrorSnapshot,
  subscribeInventoryErrors,
} from '@/lib/inventory-error-details'
import { Button } from './ui/button'

const serverSnapshot = () => null
const serverInventoryLocation = () => false
const clientInventoryLocation = () => !!inventoryErrorLocation()
function subscribeInventoryLocation(listener: () => void) {
  window.addEventListener('hashchange', listener)
  window.addEventListener('popstate', listener)
  return () => {
    window.removeEventListener('hashchange', listener)
    window.removeEventListener('popstate', listener)
  }
}

function Details({ error }: { error: unknown }) {
  const snapshot = useSyncExternalStore(
    subscribeInventoryErrors,
    useCallback(() => inventoryErrorSnapshot(error), [error]),
    serverSnapshot,
  )
  const initial = useMemo(() => createInventoryErrorDetails(error), [error])
  const report = JSON.stringify(snapshot || initial, null, 2)
  const text = useRef<HTMLTextAreaElement>(null)
  const [status, setStatus] = useState('')
  return (
    <details className="mt-6 max-w-full text-left">
      <summary className="cursor-pointer rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">
        Inventory error details
      </summary>
      <p className="my-3 text-sm text-muted-foreground">
        Sanitized technical details only. Nothing is sent automatically.
      </p>
      <Button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(report)
            setStatus('Error details copied.')
          } catch {
            text.current?.focus()
            text.current?.select()
            setStatus('Copy is unavailable. Select and copy the details below.')
          }
        }}
      >
        Copy error details
      </Button>
      <p role="status" aria-live="polite" className="my-2 text-sm">
        {status}
      </p>
      <label className="block text-sm">
        Sanitized error details
        <textarea
          ref={text}
          readOnly
          value={report}
          rows={10}
          className="mt-2 block w-full min-w-0 rounded-md border bg-background p-3 text-left font-mono text-xs focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      </label>
    </details>
  )
}

/** Hashes are browser-only. Keep server markup and initial hydration identical. */
export function InventoryErrorDetails({ error }: { error: unknown }) {
  const enabled = useSyncExternalStore(
    subscribeInventoryLocation,
    clientInventoryLocation,
    serverInventoryLocation,
  )
  return enabled ? <Details error={error} /> : null
}
