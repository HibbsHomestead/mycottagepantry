import { useState } from 'react'
import { PublicSite } from './public-site'
import { registrationRequest } from '@/lib/registration-client'
import { safeWorkspaceReturn } from '@/lib/access-state'

export function WorkspacePicker({
  memberships,
}: {
  memberships: { id: string; name: string; role: string }[]
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function select(workspaceId: string) {
    setBusy(true)
    setError('')
    try {
      await registrationRequest('access', { workspaceId })
      window.location.replace(
        safeWorkspaceReturn(
          new URLSearchParams(location.search).get('returnTo') ||
            location.pathname + location.search + location.hash,
        ),
      )
    } catch {
      setError('Your oven could not be opened. Please retry.')
      setBusy(false)
    }
  }
  return (
    <PublicSite>
      <section className="public-auth">
        <h1>Choose your oven</h1>
        <p>Open a business you belong to.</p>
        {error && <p role="alert">{error}</p>}
        <ul>
          {memberships.map((membership) => (
            <li key={membership.id}>
              <button
                className="public-button"
                disabled={busy}
                onClick={() => void select(membership.id)}
              >
                {membership.name} · {membership.role}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </PublicSite>
  )
}
