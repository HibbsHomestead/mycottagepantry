import { signupPlan, type SignupSelection } from './signup-plan'

export async function signupPlanRequest(input: {
  action: 'prepare' | 'resume'
  planId?: string
}): Promise<{ intentId?: string; selection: SignupSelection | null }> {
  const response = await fetch('/api/signup-plan', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error(
      'Your plan choice could not be saved. Please retry without creating a second account.',
    )
  const result = await response.json()
  if (!response.ok)
    throw new Error(
      result.error || 'Your plan choice could not be saved. Please retry.',
    )
  if (!Object.hasOwn(result, 'selection'))
    throw new Error(
      'Your saved plan choice could not be checked. Please retry.',
    )
  if (result.selection) signupPlan(result.selection.planId)
  return result
}

export async function resumeSelectedPlan() {
  const value = new URLSearchParams(location.search).get('plan')
  const planId = value === null ? undefined : signupPlan(value)
  return (
    await signupPlanRequest({ action: 'resume', ...(planId ? { planId } : {}) })
  ).selection
}
