import { useEffect, useRef, useState, type FormEvent } from 'react'
import { adminRequest } from './admin-portal'
import {
  registrationPolicySchema,
  type RegistrationPolicy,
} from '@/lib/free-registration-policy'

export function AdminRegistrationPolicies() {
  const [current, setCurrent] = useState<RegistrationPolicy | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState('')
  const [terms, setTerms] = useState('')
  const [privacy, setPrivacy] = useState('')
  const [approved, setApproved] = useState(false)
  const lock = useRef(false)
  const [reading, setReading] = useState(0)
  async function load() {
    setError('')
    try {
      const result = await adminRequest('action=registration-policies')
      if (!Object.hasOwn(result, 'policy'))
        throw new Error(
          'Invalid policy response. Retry loading published policies.',
        )
      setCurrent(
        result.policy === null
          ? null
          : registrationPolicySchema.parse(result.policy),
      )
      setLoaded(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [])
  async function upload(file: File | undefined, kind: 'terms' | 'privacy') {
    if (!file) return
    setError('')
    if (!/\.(txt|md)$/i.test(file.name) || file.size > 400000) {
      setError(
        'Upload a UTF-8 .txt or .md document up to 400 KB, or paste the approved text below. PDF and Word files must first be exported as plain text.',
      )
      return
    }
    setReading((n) => n + 1)
    try {
      const content = await file.text()
      if (
        !content.trim() ||
        content.length > 100000 ||
        content.includes('\u0000') ||
        content.includes('\ufffd')
      )
        throw new Error('Use nonempty UTF-8 text up to 100,000 characters.')
      if (kind === 'terms') setTerms(content)
      else setPrivacy(content)
      setApproved(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setReading((n) => n - 1)
    }
  }
  async function publish(event: FormEvent) {
    event.preventDefault()
    if (lock.current || !loaded || !approved || reading) return
    setError('')
    setMessage('')
    const parsed = registrationPolicySchema.safeParse({
      revision,
      terms,
      privacy,
    })
    if (!parsed.success) {
      setError(
        'Enter a revision and both approved documents, each up to 100,000 characters.',
      )
      return
    }
    lock.current = true
    setBusy(true)
    try {
      const result = await adminRequest('action=registration-policies', {
        policy: parsed.data,
        approved: true,
        expectedRevision: current?.revision ?? null,
      })
      setCurrent(registrationPolicySchema.parse(result.policy))
      setApproved(false)
      setMessage(
        'Terms and Privacy published. Registration can now request consent to this revision. Existing accounts and businesses were preserved.',
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      lock.current = false
    }
  }
  return (
    <section className="admin-panel">
      <h2>Registration policies</h2>
      <p>
        Upload or paste your owner-approved Terms and Privacy text, review both
        documents, and publish a new revision. Published versions remain
        unchanged so past consent can be traced. Uploads fill this editor;
        publishing makes the text public.
      </p>
      <p>
        {loaded
          ? current
            ? `Published revision: ${current.revision}`
            : 'No policies published. Business creation is paused.'
          : 'Loading published policies…'}
      </p>
      {current && (
        <details>
          <summary>
            Review published Terms and Privacy · {current.revision}
          </summary>
          <h3>Terms</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{current.terms}</p>
          <h3>Privacy</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{current.privacy}</p>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button type="button" disabled={busy} onClick={() => void load()}>
        Reload published policies
      </button>
      <form className="admin-policy-form" onSubmit={publish}>
        <label>
          New policy revision
          <input
            required
            maxLength={100}
            value={revision}
            disabled={busy}
            onChange={(e) => {
              setRevision(e.target.value)
              setApproved(false)
            }}
            placeholder="For example: 2026-11-v1"
          />
        </label>
        <label>
          Upload approved Terms (.txt or .md)
          <input
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            disabled={busy || !!reading}
            onChange={(e) => void upload(e.target.files?.[0], 'terms')}
          />
        </label>
        <label>
          Terms text
          <textarea
            required
            rows={10}
            maxLength={100000}
            value={terms}
            disabled={busy || !!reading}
            onChange={(e) => {
              setTerms(e.target.value)
              setApproved(false)
            }}
          />
        </label>
        <label>
          Upload approved Privacy (.txt or .md)
          <input
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            disabled={busy || !!reading}
            onChange={(e) => void upload(e.target.files?.[0], 'privacy')}
          />
        </label>
        <label>
          Privacy text
          <textarea
            required
            rows={10}
            maxLength={100000}
            value={privacy}
            disabled={busy || !!reading}
            onChange={(e) => {
              setPrivacy(e.target.value)
              setApproved(false)
            }}
          />
        </label>
        {reading > 0 && <p role="status">Reading document…</p>}
        <label>
          <span>
            <input
              type="checkbox"
              required
              checked={approved}
              disabled={busy || !!reading}
              onChange={(e) => setApproved(e.target.checked)}
            />{' '}
            I have reviewed both documents and authorize publication of this
            owner-approved revision.
          </span>
        </label>
        <button
          className="admin-primary"
          disabled={!loaded || busy || !!reading || !approved}
        >
          {busy ? 'Publishing…' : 'Publish Terms and Privacy'}
        </button>
      </form>
    </section>
  )
}
