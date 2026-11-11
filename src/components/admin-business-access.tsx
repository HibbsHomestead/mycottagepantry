import { useState } from 'react'
import { adminRequest } from './admin-portal'
import type { AdminMetadata } from '@/lib/platform-admin-types'
export function AdminBusinessAccess({ data }: { data: AdminMetadata }) {
  const [plan, setPlan] = useState(data.manualGrant?.plan_id || '')
  const [source, setSource] = useState(data.manualGrant?.grant_source || 'test')
  const [expiration, setExpiration] = useState('')
  const [noExpiration, setNoExpiration] = useState(true)
  const [reason, setReason] = useState('')
  const [operation, setOperation] = useState('grant')
  const [preview, setPreview] = useState<AdminMetadata | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const describe = (a: AdminMetadata) =>
    `${a.plan || 'Unassigned'} · ${a.source}${a.legacy ? ' · Existing legacy workspace access' : ''}${a.suspended ? ' · Suspended' : ''}`
  const currentTier = data.tierCatalog.find(
    (p: AdminMetadata) => p.id === data.effective.plan,
  )
  const activeIdentities = new Set(
    (data.memberships || [])
      .filter((m: AdminMetadata) => m.active)
      .map((m: AdminMetadata) => m.identity_id),
  )
  activeIdentities.add(data.oven.identity_owner)
  const overLimit =
    typeof currentTier?.users === 'number' &&
    activeIdentities.size > currentTier.users
  return (
    <section className="admin-panel">
      <h2>Manage internal access</h2>
      <p>
        Effective: <strong>{describe(data.effective)}</strong>
      </p>
      <p>
        Assigned override: {data.effective.assigned || 'Unassigned'}.
        Billing-linked tier: {data.billing?.plan_id || 'Unassigned'} ·{' '}
        {data.billing?.status || 'No billing subscription'}.
      </p>
      <p>
        Security suspension takes precedence, followed by a valid manual
        override, billing entitlement, and the existing unassigned registration
        model. Public tier availability is unchanged.
      </p>
      {data.manualGrant && (
        <p>
          Latest manual event: {data.manualGrant.operation} ·{' '}
          {data.manualGrant.grant_source} · {data.manualGrant.reason} · Expires{' '}
          {data.manualGrant.expires_at
            ? new Date(data.manualGrant.expires_at).toLocaleString()
            : 'Never'}
        </p>
      )}
      {overLimit && (
        <p role="status">
          {activeIdentities.size} active users exceeds the configured{' '}
          {currentTier.users}-user allowance. Existing members remain; new
          additions are blocked.
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (busy) return
          setBusy(true)
          setError('')
          try {
            const input = {
              businessId: data.oven.id,
              operation,
              plan,
              source,
              expiresAt: noExpiration
                ? null
                : new Date(expiration).toISOString(),
              reason,
            }
            const result = await adminRequest('action=business-access', {
              ...input,
              ...(preview ? { confirmation: preview.confirmation } : {}),
            })
            if (result.applied) window.location.reload()
            else setPreview(result)
          } catch (e) {
            setError((e as Error).message)
            setPreview(null)
          } finally {
            setBusy(false)
          }
        }}
      >
        <fieldset disabled={busy || !!preview} className="form-grid">
          <label className="field">
            <span>Action</span>
            <select
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
            >
              <option value="grant">Assign / update manual tier</option>
              <option value="revoke">Revoke manual override</option>
            </select>
          </label>
          <label className="field">
            <span>Internal tier</span>
            <select
              value={plan}
              required={operation === 'grant'}
              onChange={(e) => setPlan(e.target.value)}
            >
              <option value="">Choose approved tier…</option>
              {data.tierCatalog.map((p: AdminMetadata) => (
                <option key={p.id} value={p.id} disabled={!!p.issue}>
                  {p.name}
                  {p.issue ? ` — ${p.issue}` : ` · ${p.users} users`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Manual source</span>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="owner_internal">Owner/internal</option>
              <option value="test">Test</option>
              <option value="complimentary">Complimentary</option>
              <option value="support_override">
                Temporary support override
              </option>
            </select>
          </label>
          <label className="field">
            <span>Reason</span>
            <textarea
              required
              minLength={3}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {operation === 'grant' && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={noExpiration}
                  onChange={(e) => setNoExpiration(e.target.checked)}
                />{' '}
                No expiration
              </label>
              {!noExpiration && (
                <label className="field">
                  <span>Expiration (local time)</span>
                  <input
                    type="datetime-local"
                    required
                    value={expiration}
                    onChange={(e) => setExpiration(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
        </fieldset>
        {preview && (
          <div className="calculation-box" role="status">
            <h3>Confirm resolved business</h3>
            <p>
              {preview.preview.business.business_name} ·{' '}
              {preview.preview.business.id}
            </p>
            <p>Owner: {preview.preview.business.identity_owner}</p>
            <p>Current: {describe(preview.preview.current)}</p>
            <p>New: {describe(preview.preview.after)}</p>
            <p>
              Source: {source} · Expiration:{' '}
              {preview.preview.expiresAt || 'No expiration'} · Reason: {reason}
            </p>
            <p>{preview.preview.billingNotice}</p>
            {preview.preview.overLimit && (
              <p>
                Existing membership exceeds the new limit. Members remain; new
                additions are blocked until within the configured limit.
              </p>
            )}
            <button
              type="button"
              className="btn secondary"
              onClick={() => setPreview(null)}
            >
              Change selection
            </button>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        <button className="btn" type="submit" disabled={busy}>
          {busy
            ? 'Checking…'
            : preview
              ? 'Confirm access change'
              : 'Preview access change'}
        </button>
      </form>
      <h3>Access history</h3>
      {!data.manualHistory.length && <p>No explicit manual overrides.</p>}
      {data.manualHistory.map((g: AdminMetadata) => (
        <p key={g.id}>
          {new Date(g.created_at).toLocaleString()} · {g.operation} ·{' '}
          {g.plan_id} · {g.grant_source} · Actor {g.actor_identity} · {g.reason}{' '}
          · Expiration {g.expires_at || 'None'}
        </p>
      ))}
    </section>
  )
}
