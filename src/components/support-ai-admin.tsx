import { SubmissionForm } from './submission-form'
import { FormErrorNotice } from './form-error-notice'
import { useEffect, useState, type FormEvent } from 'react'
import { supportAiRequest } from '@/lib/support-client'
import {
  supportAiPolicySchema,
  supportAiModels,
  type supportAiDefaults,
} from '@/lib/support-ai'
import { supportKnowledge } from '@/lib/support-knowledge'
import './support-helper.css'

type Policy = typeof supportAiDefaults
export function SupportAiSuggestion({
  ticketId,
  onDraft,
  consent,
  reply = '',
}: {
  ticketId: string
  consent: boolean
  reply?: string
  onDraft: (text: string) => void
}) {
  const [assistance, setAssistance] = useState('summary')
  const [resultMode, setResultMode] = useState('summary')
  const [sources, setSources] = useState<string[]>([])
  const [suggestion, setSuggestion] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <section className="support-helper">
      <h3>AI review assistant</h3>
      <p>
        Shares the reported summary, latest 40 public replies, and any retained
        AI conversation with OpenAI via Netlify AI Gateway. Diagnostic
        attachments and private notes are excluded. Review all suggestions; no
        reply or account change is made.
      </p>
      {!consent && (
        <p>
          The requester has not agreed to AI review. Use the conversation and
          guides manually.
        </p>
      )}
      <label className="support-field">
        AI assistance
        <select
          value={assistance}
          onChange={(e) => setAssistance(e.target.value)}
        >
          <option value="summary">Summarize conversation</option>
          <option value="category">Suggest category</option>
          <option value="draft">Draft reply</option>
          <option value="rewrite">Rewrite current reply</option>
        </select>
      </label>
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
              assistance,
              ...(assistance === 'rewrite' ? { draft: reply } : {}),
            })
            setResultMode(assistance)
            setSuggestion(v.suggestion)
            setSources(v.articles || [])
          } catch (e) {
            setError((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Preparing suggestion…' : 'Generate AI suggestion'}
      </button>
      {error && <FormErrorNotice message={error} />}
      {suggestion && (
        <div className="ai-notice">
          <strong>AI suggestion · review required · not sent</strong>
          <p style={{ whiteSpace: 'pre-wrap' }}>{suggestion}</p>
          <p>Supporting help sources</p>
          {!sources.length && (
            <p>
              No matching approved help source. Verify the suggestion before
              using it.
            </p>
          )}
          <ul className="ai-links">
            {supportKnowledge
              .filter((a) => sources.includes(a.id))
              .map((a) => (
                <li key={a.id}>
                  <a href={'https://mycottagepantry.com' + a.href}>{a.title}</a>
                </li>
              ))}
          </ul>
          {(resultMode === 'draft' || resultMode === 'rewrite') && (
            <button
              type="button"
              className="support-button"
              onClick={() => onDraft(suggestion)}
            >
              Use as reply draft
            </button>
          )}
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
  const [metering, setMetering] = useState<
    {
      model: string
      calls: number
      cost_nano_usd: string | null
      uncertain_nano_usd: string | null
      uncertain_calls: number
      cached_tokens: string | null
    }[]
  >([])
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    supportAiRequest(true)
      .then((v) => {
        const loaded = supportAiPolicySchema.parse(v.policy)
        setPolicy({
          ...loaded,
          descriptionBusinessIds: loaded.descriptionBusinessIds ?? [
            ...loaded.evaluationBusinessIds,
          ],
        })
        setUsage(v.usage)
        setMetering(v.metering || [])
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
        No message text is included. The configured candidate uses OpenAI
        through Netlify AI Gateway. Each question uses at most{' '}
        {policy?.maxProviderCalls || 4} provider requests of 1,000 output tokens
        each, with at most {policy?.maxToolCalls || 6} tool calls. There are no
        automatic retries. Customer AI access is restricted to explicitly listed
        evaluation businesses; general subscriber access is closed.
      </p>

      {notice && <p role="status">{notice}</p>}
      {policy && (
        <SubmissionForm onSubmit={save}>
          <label>
            AI model (support and descriptions)
            <select
              disabled={!admin}
              value={policy.model}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  model: e.target.value as Policy['model'],
                })
              }
            >
              {supportAiModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            Support evaluation business IDs (one per line; leave empty to keep
            customer AI closed)
            <textarea
              disabled={!admin}
              value={policy.evaluationBusinessIds.join('\n')}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  evaluationBusinessIds: e.target.value
                    .split(/\s+/)
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label>
            Product description evaluation business IDs (one per line; leave
            empty to keep generation closed)
            <textarea
              disabled={!admin}
              value={(
                policy.descriptionBusinessIds ?? policy.evaluationBusinessIds
              ).join('\n')}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  descriptionBusinessIds: e.target.value
                    .split(/\s+/)
                    .filter(Boolean),
                })
              }
            />
          </label>
          <p>
            Existing description permissions are retained until explicitly
            changed here. Support access is managed separately. Both tools
            retain the shared pause switch and spending limits.
          </p>
          <div className="ai-admin-policy">
            {(
              [
                ['maxToolCalls', 'Maximum tool calls', 1, 6],
                ['maxProviderCalls', 'Maximum provider calls', 1, 4],
                [
                  'businessDailyUsd',
                  'Business spending cutoff / 24 hours (USD)',
                  0.01,
                  10,
                ],
                [
                  'globalDailyUsd',
                  'Global spending cutoff / 24 hours (USD)',
                  0.01,
                  100,
                ],
                ['lifetimeUsd', 'Lifetime spending cutoff (USD)', 0.01, 1000],
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
                  step={key.endsWith('Usd') ? 0.01 : 1}
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
            Enable AI replies and product descriptions (guides and support tickets remain available when paused)
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

              <FormErrorNotice message={error} />
              <button
                className="support-button"
                disabled={busy || !policyConfirmed}
              >
                Save AI limits
              </button>
            </>
          )}
        </SubmissionForm>
      )}
      <ul>
        {usage.map((row) => (
          <li key={row.day}>
            {new Date(row.day).toLocaleDateString()}: {row.requests} attempts ·{' '}
            {row.failures} failed · {row.input_tokens || 0} input /{' '}
            {row.output_tokens || 0} output tokens
          </li>
        ))}
      </ul>
      {metering.map((row) => (
        <p key={row.model}>
          {row.model}: {row.calls} provider calls · $
          {(Number(row.cost_nano_usd || 0) / 1e9).toFixed(6)} in token cost from
          reported usage · {row.cached_tokens || 0} cached input tokens ·{' '}
          {row.uncertain_calls} pending/uncertain calls holding $
          {(Number(row.uncertain_nano_usd || 0) / 1e9).toFixed(6)} in
          reservations.
        </p>
      ))}
      <p>
        GPT-5.4 mini reference rates: $0.75 / million input, $0.075 cached
        input, $4.50 output tokens. Cost is computed from actual
        provider-reported tokens and stored per call with the model.
        Provider-reported charges are retained separately when supplied. This is
        not a Netlify invoice; account credits and hosting charges may differ.
        Unknown usage retains its full reservation against the spending cutoff.
        Lifetime metering is retained independently of chat and 30-day request
        history.
      </p>
      {!usage.length && <p>No AI usage recorded in this period.</p>}
    </details>
  )
}
