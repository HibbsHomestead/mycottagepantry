import { useCallback, useEffect, useState } from 'react'
import {
  assistantStatus,
  readAssistantResponse,
  type AssistantStatus,
} from '@/lib/cottage-assistant'

export function AssistantConnectionStatus({
  canManage,
}: {
  canManage: boolean
}) {
  const [status, setStatus] = useState<AssistantStatus | null>(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setChecking(true)
    setStatus(null)
    setError('')
    try {
      const response = await fetch('/api/workspace?assistant=1', {
        cache: 'no-store',
        signal,
      })
      const parsed = assistantStatus.safeParse(
        await readAssistantResponse(response),
      )
      if (!parsed.success)
        throw new Error('Assistant configuration status is unavailable.')
      if (!signal?.aborted) setStatus(parsed.data)
    } catch (e) {
      if (!signal?.aborted) setError((e as Error).message)
    } finally {
      if (!signal?.aborted) setChecking(false)
    }
  }, [])
  useEffect(() => {
    if (!canManage) return
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [canManage, refresh])
  return (
    <section className="calculation-box" aria-label="AI assistant connection">
      <h3>Cottage Pantry Assistant</h3>
      {canManage ? (
        <>
          <p role="status">
            {status?.status ||
              (checking
                ? 'Checking assistant configuration…'
                : 'Status unavailable')}
          </p>
          {status?.checkedAt && (
            <p>
              Last request in this deployment:{' '}
              {new Date(status.checkedAt).toLocaleString()}
            </p>
          )}
          {status?.message && <p>{status.message}</p>}
          <button
            className="btn secondary"
            disabled={checking}
            onClick={() => void refresh()}
          >
            Refresh AI status
          </button>
          {error && (
            <p role="alert" className="warning-text">
              {error}
            </p>
          )}
        </>
      ) : (
        <p>
          An Owner or Manager can check AI configuration in a signed-in oven.
        </p>
      )}
      <p>
        Ingredient text suggestions and explicit web research use Netlify AI
        Gateway → Perplexity Sonar. A successful request by your signed-in user
        in this deployment is required for “Connection successful.”
      </p>
      <p>
        Open Add or Edit Ingredient to request suggestions, review the result
        and apply selected fields to the unsaved form. Requests may use Netlify
        credits and incur search charges. Status refreshes make no AI requests.
      </p>
    </section>
  )
}
