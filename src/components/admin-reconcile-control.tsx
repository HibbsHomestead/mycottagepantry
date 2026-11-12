import { useState } from 'react'
import type { AdminMetadata } from '@/lib/platform-admin-types'
export function AdminReconcileControl({
  businessId,
  request,
}: {
  businessId: string
  request: (query: string, body?: unknown) => Promise<AdminMetadata>
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  async function reconcile() {
    setBusy(true)
    try {
      await request('action=business-reconcile', { businessId })
      setMessage(
        'Provider state reconciled. Reload business details to view verified access. No charge or subscription was created.',
      )
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <button className="btn secondary" disabled={busy} onClick={reconcile}>
        Reconcile verified billing
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  )
}
