import { useEffect, useState } from 'react'
import { adminRequest } from './admin-portal'
import type { AdminMetadata } from '@/lib/platform-admin-types'
import { catalogSnapshotSchema } from '@/lib/catalog'
export function AdminCatalog() {
  const [data, setData] = useState<AdminMetadata | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [id, setId] = useState(''),
    [revision, setRevision] = useState(''),
    [snapshot, setSnapshot] = useState(
      JSON.stringify(
        { kind: 'ingredient', entryType: 'generic', fields: { name: '' } },
        null,
        2,
      ),
    ),
    [sourceUrl, setSourceUrl] = useState(''),
    [license, setLicense] = useState(''),
    [scope, setScope] = useState(''),
    [rights, setRights] = useState(false),
    [submission, setSubmission] = useState<AdminMetadata | null>(null)
  async function load() {
    try {
      const result = await adminRequest('action=catalog')
      if (!Array.isArray(result?.items) || !Array.isArray(result?.submissions))
        throw new Error(
          'Catalog administration returned an invalid response. Retry; the editor is preserved.',
        )
      setData(result)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [])
  function edit(item: AdminMetadata) {
    setId(item.id)
    setRevision(item.revision_id)
    setSnapshot(
      JSON.stringify(
        {
          kind: item.data.kind,
          entryType: item.data.entryType,
          fields: item.data.fields,
        },
        null,
        2,
      ),
    )
    setSourceUrl(item.data.sources?.[0]?.url || '')
    setLicense(item.data.sources?.[0]?.license || '')
    setScope('')
    setRights(false)
    setSubmission(null)
  }
  async function send(operation: string, status?: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await adminRequest('action=catalog', {
        operation,
        id: id || undefined,
        expectedRevision: revision || undefined,
        ...(operation === 'publish'
          ? { snapshot: catalogSnapshotSchema.parse(JSON.parse(snapshot)) }
          : {}),
        sources: sourceUrl ? [{ url: sourceUrl, license }] : [],
        reviewScope: scope,
        rights,
        status,
        submission,
      })
      await load()
      setRights(false)
      setSubmission(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="admin-panel">
      <h2>Shared ingredient and supply catalog</h2>
      <p>
        Reviewed means the stated fields were compared with the cited source.
        Publication does not certify allergens or update private records.
        Uploaded images are not accepted in this phase.
      </p>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <button type="button" onClick={() => void load()}>
          Retry catalog administration
        </button>
      ) : (
        <>
          <h3>Pending contributions</h3>
          {!data.submissions.length && <p>No pending contributions.</p>}
          {data.submissions.map((s: AdminMetadata) => (
            <div className="catalog-result" key={s.id}>
              <strong>{s.data.snapshot.fields.name}</strong>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  const existing = data.items.find(
                    (i: AdminMetadata) => i.id === s.data.targetId,
                  )
                  setId(existing?.id || '')
                  setRevision(existing?.revision_id || '')
                  setSnapshot(JSON.stringify(s.data.snapshot, null, 2))
                  setSourceUrl('')
                  setLicense('')
                  setScope('')
                  setRights(false)
                  setSubmission({ id: s.id, businessId: s.business_id })
                }}
              >
                Review submitted fields
              </button>
            </div>
          ))}
          <h3>Published reference entries</h3>
          <label className="field">
            <span>Entry to revise</span>
            <select
              value={id}
              onChange={(e) => {
                const item = data.items.find(
                  (i: AdminMetadata) => i.id === e.target.value,
                )
                if (item) edit(item)
                else {
                  setId('')
                  setRevision('')
                  setSubmission(null)
                }
              }}
            >
              <option value="">New entry</option>
              {data.items.map((i: AdminMetadata) => (
                <option key={i.id} value={i.id}>
                  {i.data.fields.name} · {i.status}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Shared snapshot (only listed fields are permitted)</span>
            <textarea
              rows={12}
              value={snapshot}
              onChange={(e) => setSnapshot(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Cited HTTPS source</span>
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Storage and redistribution permission / license</span>
            <input
              value={license}
              onChange={(e) => setLicense(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Fields checked, review scope or withdrawal reason</span>
            <textarea
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              rows={2}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={rights}
              onChange={(e) => setRights(e.target.checked)}
            />
            I checked these fields against the cited source and confirmed
            permission for shared reuse.
          </label>
          <div className="button-row">
            <button
              type="button"
              className="btn"
              disabled={busy || !rights || scope.trim().length < 10}
              onClick={() => void send('publish')}
            >
              Publish reviewed revision
            </button>
            {submission && (
              <button
                type="button"
                className="btn secondary"
                disabled={busy || !rights || scope.trim().length < 10}
                onClick={() => void send('reject')}
              >
                Reject submission
              </button>
            )}
            {id && (
              <>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy || !rights || scope.trim().length < 10}
                  onClick={() => void send('status', 'withdrawn')}
                >
                  Withdraw entry
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy || !rights || scope.trim().length < 10}
                  onClick={() => void send('status', 'superseded')}
                >
                  Mark superseded
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy || !rights || scope.trim().length < 10}
                  onClick={() => void send('status', 'active')}
                >
                  Restore entry
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  )
}
