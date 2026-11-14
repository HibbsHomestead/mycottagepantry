import { useEffect, useState, type FormEvent } from 'react'
import { supportAiRequest } from '@/lib/support-client'
import {
  supportAiPolicySchema,
  supportTokenEstimate,
  type supportAiDefaults,
} from '@/lib/support-ai'
import { supportKnowledge } from '@/lib/support-knowledge'
import './support-helper.css'

type Policy = typeof supportAiDefaults
export function SupportAiSuggestion({
  ticketId,
  onDraft,
  consent,
}: {
  ticketId: string
  consent: boolean
  onDraft: (text: string) => void
}) {
  const [sources, setSources] = useState<string[]>([])
  const [suggestion, setSuggestion] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <section className="support-helper">
      <h3>AI review assistant</h3>
      <p>
        Shares the reported summary, public replies, and any retained AI
        conversation with OpenAI via Netlify AI Gateway. Diagnostic attachments
        and private notes are excluded. Review all suggestions; no reply or
        account change is made.
      </p>
      {!consent && (
        <p>
          The requester has not agreed to AI review. Use the conversation and
          guides manually.
        </p>
      )}
      <button
        type="button"
        className="support-button"
        disabled={busy || !consent}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            const v = await supportAiRequest(true, {
              action: 'summarize',
              ticketId,
            })
            setSuggestion(v.suggestion)
            setSources(v.articles || [])
          } catch (e) {
            setError((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Preparing suggestion…' : 'Summarize & suggest troubleshooting'}
      </button>
      {error && <p role="alert">{error}</p>}
      {suggestion && (
        <div className="ai-notice">
          <p style={{ whiteSpace: 'pre-wrap' }}>{suggestion}</p>
          <ul className="ai-links">
            {supportKnowledge
              .filter((a) => sources.includes(a.id))
              .map((a) => (
                <li key={a.id}>
                  <a href={'https://mycottagepantry.com' + a.href}>{a.title}</a>
                </li>
              ))}
          </ul>
          <button
            type="button"
            className="support-button"
            onClick={() => onDraft(suggestion)}
          >
            Use as reply draft
          </button>
          <p>Review and edit the reply below before sending.</p>
        </div>
      )}
    </section>
  )
}
export function SupportAiUsage({ admin }: { admin: boolean }) {
  const [policyConfirmed, setPolicyConfirmed] = useState(false)
  const [policy, setPolicy] = useState<Policy | null>(null),
    [usage, setUsage] = useState<
      {
        day: string
        requests: number
        failures: number
        input_tokens: number
        output_tokens: number
      }[]
    >([])
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    supportAiRequest(true)
      .then((v) => {
        setPolicy(v.policy)
        setUsage(v.usage)
      })
      .catch((e) => setError(e.message))
  }, [])
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!policyConfirmed) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const p = supportAiPolicySchema.parse(policy)
      await supportAiRequest(true, {
        action: 'policy',
        policy: p,
        consent: true,
      })
      setNotice(
        'AI limits saved. Existing conversations keep their original expiry; new conversations use this retention period.',
      )
    } catch {
      setError(
        'Could not save. Check the allowed limits and your verified admin session, then retry.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="support-panel support-helper">
      <summary>AI usage & limits</summary>
      <p>
        Last 30 days · request attempts, failures and provider-reported tokens.
        No message text is included. Requests use gpt-4.1-mini through Netlify
        AI Gateway and consume account credits. Each question uses at most three
        provider requests of 550 output tokens each, with at most four tool
        calls. There are no automatic retries.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {policy && (
        <form onSubmit={save}>
          <div className="ai-admin-policy">
            {(
              [
                ['userDaily', 'Per person / 24 hours', 1, 100],
                ['businessDaily', 'Per oven / 24 hours', 1, 500],
                ['globalDaily', 'Platform / 24 hours', 1, 2000],
                ['cooldownSeconds', 'Seconds between requests', 5, 300],
                ['retentionDays', 'New conversation retention (days)', 1, 90],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  required
                  disabled={!admin}
                  value={policy[key]}
                  onChange={(e) =>
                    setPolicy({ ...policy, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <label className="ai-check">
            <input
              type="checkbox"
              disabled={!admin}
              checked={policy.enabled}
              onChange={(e) =>
                setPolicy({ ...policy, enabled: e.target.checked })
              }
            />
            Enable AI replies (guides and support tickets remain available when
            paused)
          </label>
          {admin && (
            <>
              <label className="ai-check">
                <input
                  type="checkbox"
                  checked={policyConfirmed}
                  onChange={(e) => setPolicyConfirmed(e.target.checked)}
                />
                I reviewed the usage, spending limits and retention change.
              </label>
              <button
                className="support-button"
                disabled={busy || !policyConfirmed}
              >
                Save AI limits
              </button>
            </>
          )}
        </form>
      )}
      <ul>
        {usage.map((row) => (
          <li key={row.day}>
            {new Date(row.day).toLocaleDateString()}: {row.requests} attempts ·{' '}
            {row.failures} failed · {row.input_tokens || 0} input /{' '}
            {row.output_tokens || 0} output tokens · estimated API tokens $
            {supportTokenEstimate(
              row.input_tokens || 0,
              row.output_tokens || 0,
            ).toFixed(4)}
          </li>
        ))}
      </ul>
      <p>
        Reference estimate: $0.40 per million input tokens and $1.60 per million
        output tokens for gpt-4.1-mini; not an invoice. Check Netlify AI usage
        for actual account credits and hosting charges. Token totals may be
        incomplete if a provider response is interrupted.
      </p>
      {!usage.length && <p>No AI usage recorded in this period.</p>}
    </details>
  )
}
