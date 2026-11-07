import { useEffect } from 'react'
/** Fallback for client navigation; hosting redirects handle initial requests. */
export function OvenAlias() {
  useEffect(() => {
    window.location.replace(
      location.pathname.replace(/^\/(workspace|studio)(?=\/|$)/, '/oven') +
        location.search +
        location.hash,
    )
  }, [])
  return <p role="status">Opening My Oven…</p>
}
