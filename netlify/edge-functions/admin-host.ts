import type { Config } from '@netlify/edge-functions'

/** Presentation routing only. Every data request is independently authorized. */
export default async (request: Request) => {
  const url = new URL(request.url)
  if (
    url.pathname === '/admin' &&
    [
      'mycottagepantry.com',
      'mycottagepantry.netlify.app',
      'main--mycottagepantry.netlify.app',
    ].includes(url.hostname)
  ) {
    return Response.redirect(
      'https://admin.mycottagepantry.com/admin' + url.search,
      302,
    )
  }
  if (url.hostname !== 'admin.mycottagepantry.com') return
  if (url.pathname === '/') {
    url.pathname = '/admin'
    return Response.redirect(url, 302)
  }
  // Identity email links can use these paths. Redirect on the same host so the
  // browser retains its fragment without sending recovery material to the edge.
  if (['/login', '/recover', '/verify-email'].includes(url.pathname)) {
    url.pathname = '/admin'
    return Response.redirect(url, 302)
  }
  const application =
    url.pathname === '/admin' ||
    url.pathname === '/api/admin' ||
    url.pathname === '/platform-support' ||
    url.pathname === '/api/support' ||
    url.pathname === '/.netlify/functions/platform-admin'
  // The provider enforces its own authentication. Blocking its namespace also
  // blocks password verification, recovery and SDK session cleanup on this host.
  const identity = url.pathname.startsWith('/.netlify/identity/')
  const asset =
    /^\/(?:assets\/|label-fonts\/|favicon[^/]*\.(?:png|ico)$|apple-touch-icon\.png$|app-version\.json$)/.test(
      url.pathname,
    )
  if (application || identity || asset) return
  // The admin host never serves My Oven APIs or a second customer application.
  return new Response('Not found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
export const config: Config = { path: '/*' }
