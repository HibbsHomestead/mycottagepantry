import { activeDemoSession } from './demo-client'
/** One restoration/renewal at a time. Tokens stay inside the provider SDK. */
let pending: Promise<void> | null = null
export function restoreIdentitySession() {
  pending ??= (async () => {
    if (await activeDemoSession()) return
    const identity = await import('@netlify/identity')
    await identity.hydrateSession()
    await identity.refreshSession()
  })().finally(() => {
    pending = null
  })
  return pending
}
