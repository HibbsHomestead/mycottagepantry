import { useEffect, useState } from 'react'
import { registrationRequest } from '@/lib/registration-client'
import { PublicSite } from './public-site'
import './registration.css'
export function RegistrationOperations() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState('')
  useEffect(() => {
    let active = true
    registrationRequest('operations')
      .then((v) => {
        if (active) setData(v)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [])
  return (
    <PublicSite>
      <section className="registration-shell">
        <div className="registration-paper">
          <p className="public-eyebrow">Restricted platform operations</p>
          <h1>Signup & billing readiness</h1>
          <p>
            Private test metadata only. Oven Owner status does not provide
            platform administration access.
          </p>
          {error && <p role="alert">{error}</p>}
          {!data && !error && (
            <p role="status">Verifying administrator access…</p>
          )}
          {data && (
            <>
              <h2>Signup stages</h2>
              <ul>
                {data.drafts.length ? (
                  data.drafts.map((r: any) => (
                    <li key={r.stage}>
                      {r.stage}: {r.count}
                    </li>
                  ))
                ) : (
                  <li>No private test drafts.</li>
                )}
              </ul>
              <h2>Complimentary grant audit</h2>
              <ul>
                {data.grants.length ? (
                  data.grants.map((r: any) => (
                    <li key={r.id}>
                      Oven {r.business_id} · Owner {r.owner_identity} · actor{' '}
                      {r.actor_identity} · {r.created_at}
                    </li>
                  ))
                ) : (
                  <li>
                    No complimentary grants recorded. Existing oven and Owner
                    verification and confirmation remain required.
                  </li>
                )}
              </ul>
            </>
          )}
          <a className="public-text-link" href="/help">
            Need help?
          </a>
        </div>
      </section>
    </PublicSite>
  )
}
