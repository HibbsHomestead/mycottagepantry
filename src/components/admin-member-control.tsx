import { AdminStepUp } from './admin-step-up'
import { useState } from 'react'
import type { AdminMetadata } from '@/lib/platform-admin-types'
export function AdminMemberControl({
  data,
  request,
}: {
  data: AdminMetadata
  request: (query: string, body?: unknown) => Promise<AdminMetadata>
}) {
  const [member, setMember] = useState(''),
    [role, setRole] = useState('Production Staff'),
    [active, setActive] = useState(true),
    [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [identity, setIdentity] = useState<AdminMetadata | null>(null)
  async function save() {
    setBusy(true)
    try {
      await request('action=membership', {
        businessId: data.oven.id,
        memberId: member,
        role,
        active,
        reason,
        confirm: confirmed,
      })
      setMessage(
        'Membership updated and audited. Reload this business to refresh the member list.',
      )
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function verify() {
    const m = data.memberships.find((r: AdminMetadata) => r.id === member)
    if (!m) return
    setBusy(true)
    try {
      setIdentity(
        await request(
          'action=identity-status&identity=' +
            encodeURIComponent(m.identity_id),
        ),
      )
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stripe-settings">
      <h3>Manage existing membership</h3>
      <AdminStepUp request={request} />
      <label>
        Member
        <select
          value={member}
          onChange={(e) => {
            setMember(e.target.value)
            setIdentity(null)
            setConfirmed(false)
          }}
        >
          <option value="">Select member</option>
          {data.memberships.map((r: AdminMetadata) => (
            <option key={r.id} value={r.id}>
              {r.identity_id} · {r.role}
            </option>
          ))}
        </select>
      </label>
      <button disabled={busy || !member} onClick={verify}>
        Verify Identity status
      </button>
      {identity && (
        <p>
          {identity.email} ·{' '}
          {identity.confirmedAt ? 'Verified' : 'Not verified'} ·{' '}
          {identity.memberships.length} business memberships
        </p>
      )}
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {['Owner', 'Manager', 'Production Staff', 'Read-only Accountant'].map(
            (r) => (
              <option key={r}>{r}</option>
            ),
          )}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />{' '}
        Active membership
      </label>
      <label>
        Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{' '}
        Confirm this member receives the selected role and access status.
        Existing billing continues unchanged.
      </label>
      <button
        disabled={busy || !member || !confirmed || reason.trim().length < 3}
        onClick={save}
      >
        Apply membership change
      </button>
      {message && <p role="status">{message}</p>}
      <p>
        New-user invitation and resend are unavailable: this app has no secure
        business invitation acceptance mechanism. No account is created or taken
        over here.
      </p>
    </div>
  )
}
