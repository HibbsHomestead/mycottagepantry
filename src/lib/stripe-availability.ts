import { useEffect, useState } from 'react'
import type { PlanId } from './launch-plans'
export type TierAvailability = {
  id: PlanId
  purchasable: boolean
  reason: string
}
/** Public IDs and approved amounts only. No credentials, account IDs or Price IDs. */
export function useStripePurchaseAvailability() {
  const [state, setState] = useState<{
    plans: string[]
    tiers: TierAvailability[]
    loading: boolean
    error: boolean
  }>({ plans: [], tiers: [], loading: true, error: false })
  useEffect(() => {
    let active = true
    fetch('/api/stripe/billing?view=availability&details=1', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Availability unavailable')
        const result = await response.json()
        if (!Array.isArray(result.plans))
          throw new Error('Availability invalid')
        if (active)
          setState({
            plans: result.plans.filter((p: unknown) => typeof p === 'string'),
            tiers: Array.isArray(result.tiers) ? result.tiers : [],
            loading: false,
            error: false,
          })
      })
      .catch(() => {
        if (active)
          setState({ plans: [], tiers: [], loading: false, error: true })
      })
    return () => {
      active = false
    }
  }, [])
  return state
}
export function useStripeAvailability() {
  return useStripePurchaseAvailability().plans
}

export function purchaseStatus(
  state: ReturnType<typeof useStripePurchaseAvailability>,
  plan: PlanId,
) {
  if (plan === 'free') return 'Free account setup. No payment method required.'
  if (state.loading) return 'Checking purchase availability…'
  if (state.error)
    return 'Purchase availability could not be verified. Refresh to retry.'
  return (
    state.tiers.find((p) => p.id === plan)?.reason ||
    (state.plans.includes(plan)
      ? 'Available monthly subscription.'
      : 'Purchase availability needs verification for this tier.')
  )
}
