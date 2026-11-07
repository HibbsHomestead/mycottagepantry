import { createServerFn } from '@tanstack/react-start'

/** Navigation hint only. Account pages use the authoritative account-access endpoint. */
export const getSessionStatus = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getRequest, setResponseHeader } =
      await import('@tanstack/react-start/server')
    const { verifiedSession } =
      await import('../../netlify/lib/verified-session')
    setResponseHeader('Cache-Control', 'private, no-store')
    setResponseHeader('Vary', 'Cookie')
    try {
      return {
        signedIn: !!(await verifiedSession(getRequest())),
        unavailable: false,
      }
    } catch {
      return { signedIn: false, unavailable: true }
    }
  },
)
