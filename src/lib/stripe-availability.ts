import { useEffect, useState } from 'react'
/** Public IDs and approved amounts only. No credentials, account IDs or Price IDs. */
export function useStripeAvailability() {
  const [plans, setPlans] = useState<string[]>([])
  useEffect(() => {
    let active = true
    fetch('/api/stripe/billing?view=availability', {
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (!response.ok) return
        const result = await response.json()
        if (active && Array.isArray(result.plans))
          setPlans(result.plans.filter((p: unknown) => typeof p === 'string'))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return plans
}
