import { useEffect, useState } from 'react'
import type { AdminMetadata } from './platform-admin-types'
import { restoreIdentitySession } from './identity-session'

export async function billingRequest(body?: unknown) {
  // The server independently verifies cookies if SDK restoration is unavailable.
  await restoreIdentitySession().catch(() => {})
  const response = await fetch('/api/stripe/billing', {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const result = await response.json()
  if (!response.ok)
    throw Object.assign(
      new Error(result.error || 'Billing could not be verified. Please retry.'),
      { code: result.code, status: response.status },
    )
  if (
    !result.workspace?.name &&
    !result.url &&
    !result.preview &&
    !result.verifying
  )
    throw new Error(
      'The billing response could not be verified. Refresh to retry.',
    )
  return result as AdminMetadata
}

/** Public pricing stays public; a verified owner response adds current-business actions. */
export function usePricingBilling() {
  const [state, setState] = useState<{
    data: AdminMetadata | null
    loading: boolean
    error: string
    member: boolean
  }>({ data: null, loading: true, error: '', member: false })
  useEffect(() => {
    let active = true
    billingRequest({ action: 'refresh' })
      .then((data) => {
        if (active) setState({ data, loading: false, error: '', member: false })
      })
      .catch((error) => {
        if (active)
          setState({
            data: null,
            loading: false,
            member: error.code === 'OWNER_REQUIRED',
            error:
              error.status === 401 ||
              [
                'OWNER_REQUIRED',
                'BUSINESS_SETUP_REQUIRED',
                'EMAIL_UNVERIFIED',
              ].includes(error.code)
                ? ''
                : error.message,
          })
      })
    return () => {
      active = false
    }
  }, [])
  return state
}
