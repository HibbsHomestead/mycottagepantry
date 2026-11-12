import { restoreIdentitySession } from './identity-session'
import { useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { resumeSelectedPlan } from './signup-plan-client'
import { signupPlan } from './signup-plan'
import type { PlanId } from './launch-plans'
import {
  accessDestination,
  hasIdentityCallback,
  safeWorkspaceReturn,
  tracePattern,
  type AccountAccess,
  type AccountPage,
} from './access-state'

export function accessTraceId() {
  const supplied = new URLSearchParams(location.search).get('accessTrace')
  return supplied && tracePattern.test(supplied)
    ? supplied
    : crypto.randomUUID()
}
export async function readAccountAccess(
  traceId: string,
): Promise<AccountAccess> {
  await restoreIdentitySession()
  const response = await fetch('/api/account-access', {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    headers: { 'X-Access-Trace': traceId },
  })
  if (
    !response.ok ||
    !response.headers.get('content-type')?.includes('application/json')
  )
    throw new Error('ACCESS_TRANSPORT_FAILED')
  const value = await response.json()
  if (
    ![
      'signed_out',
      'email_unverified',
      'workspace',
      'workspace_selection',
      'no_workspace',
      'access_denied',
      'identity_error',
      'membership_error',
    ].includes(value.status) ||
    !tracePattern.test(value.traceId) ||
    !Array.isArray(value.memberships) ||
    !Array.isArray(value.events)
  )
    throw new Error('ACCESS_RESPONSE_INVALID')
  return value
}
export const accountNavigation = {
  replace: (destination: string) => window.location.replace(destination),
}

export function navigateAccount(
  destination: string,
  traceId: string,
  returnTo?: string | null,
  planId?: PlanId,
  replace = accountNavigation.replace,
) {
  const allowed = [
    '/oven',
    '/oven/billing',
    '/workspace',
    '/workspace/billing',
    '/login',
    '/onboarding',
    '/verify-email',
  ]
  const url = new URL(
    destination.startsWith('/') && !destination.startsWith('//')
      ? destination
      : '/oven',
    location.origin,
  )
  if (url.origin !== location.origin || !allowed.includes(url.pathname))
    throw new Error('INVALID_ACCESS_DESTINATION')
  if (['/workspace', '/workspace/billing'].includes(url.pathname))
    url.pathname = url.pathname.replace('/workspace', '/oven')
  url.searchParams.set('accessTrace', traceId)
  // Forward only an explicitly resolved preference for new-business setup.
  // Ambient URL state must not steer existing-account access or throw here.
  if (planId) url.searchParams.set('plan', signupPlan(planId))
  if (url.pathname !== '/oven' && returnTo)
    url.searchParams.set('returnTo', safeWorkspaceReturn(returnTo))
  replace(url.pathname + url.search + url.hash)
}
export function useAccountAccess(page: AccountPage) {
  const router = useRouter({ warn: false })
  const [access, setAccess] = useState<AccountAccess | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [traceId, setTraceId] = useState('')
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((old) => old + 1), [])
  useEffect(() => {
    let active = true
    // Callback fragments must reach the provider handler before any access decision,
    // including routes whose loading view intentionally omits the public header.
    if (hasIdentityCallback(location.hash)) {
      accountNavigation.replace('/login' + location.search + location.hash)
      return
    }
    const reference = accessTraceId()
    Promise.resolve()
      .then(() => {
        if (!active) return null
        setTraceId(reference)
        setLoading(true)
        setError(false)
        setErrorMessage('')
        return readAccountAccess(reference)
      })
      .then(async (value) => {
        if (!active || !value) return
        let selection: Awaited<ReturnType<typeof resumeSelectedPlan>>
        try {
          selection =
            page !== 'workspace' && value.status === 'no_workspace'
              ? await resumeSelectedPlan()
              : null
        } catch (failure) {
          if (active) {
            setAccess(value)
            setErrorMessage((failure as Error).message)
            setError(true)
            setLoading(false)
          }
          return
        }
        if (!active) return
        setAccess(value)
        const returnTo =
          new URLSearchParams(location.search).get('returnTo') ||
          (page === 'workspace'
            ? location.pathname + location.search + location.hash
            : null)
        const destination = accessDestination(value, page, returnTo)
        if (destination) {
          navigateAccount(
            destination,
            reference,
            returnTo,
            selection?.planId,
            router
              ? (href) => {
                  void router.navigate({ href, replace: true })
                }
              : undefined,
          )
          return
        }
        setLoading(false)
      })
      .catch(() => {
        if (active) {
          setError(true)
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [page, attempt, router])
  return { access, loading, error, errorMessage, traceId, retry }
}
