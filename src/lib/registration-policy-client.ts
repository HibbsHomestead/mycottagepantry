import { useCallback, useEffect, useState } from 'react'
import { registrationRequest } from './registration-client'
import {
  registrationPolicySchema,
  type RegistrationPolicy,
} from './free-registration-policy'

export function useRegistrationPolicy() {
  const [policy, setPolicy] = useState<RegistrationPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError('')
    registrationRequest('policies')
      .then((result) => {
        if (!Object.hasOwn(result, 'policy'))
          throw new Error('Invalid policy response')
        const current =
          result.policy === null
            ? null
            : registrationPolicySchema.parse(result.policy)
        if (active) setPolicy(current)
      })
      .catch(() => {
        if (active)
          setError(
            'Terms and Privacy could not be checked. Retry; your business details are preserved.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [attempt])
  return { policy, loading, error, retry }
}
