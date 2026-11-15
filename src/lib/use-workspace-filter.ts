import { useEffect, useState } from 'react'

/** Presentation state belongs in shareable URLs, never business-data storage. */
export function useWorkspaceFilter(key: string, fallback = '', enabled = true) {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined' || !enabled) return fallback
    return new URLSearchParams(location.hash.split('?')[1]).get(key) ?? fallback
  })
  useEffect(() => {
    if (!enabled) return
    const [path, query] = location.hash.split('?')
    const params = new URLSearchParams(query)
    if (value === fallback) params.delete(key)
    else params.set(key, value)
    const hash = path + (params.size ? '?' + params.toString() : '')
    if (hash !== location.hash) history.replaceState(history.state, '', hash)
  }, [key, value, fallback, enabled])
  return [value, setValue] as const
}
