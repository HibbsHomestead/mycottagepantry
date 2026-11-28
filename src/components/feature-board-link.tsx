import { useEffect, useState } from 'react'

export function FeatureBoardLink({
  moderator = false,
}: {
  moderator?: boolean
}) {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/feature-requests?availability=1', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => setAvailable(result?.enabled === true))
      .catch(() => undefined)
    return () => controller.abort()
  }, [])
  return available ? (
    <a
      className="public-text-link"
      href={'/feature-requests' + (moderator ? '?admin=1' : '')}
    >
      Feature requests
    </a>
  ) : null
}
