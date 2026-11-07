import { useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronDown, Sparkles } from 'lucide-react'
import {
  assistantDraftPatch,
  assistantFieldLabels,
  assistantResult,
  assistantStatus,
  readAssistantResponse,
  type AssistantField,
  type AssistantResult,
  type AssistantStatus,
} from '@/lib/cottage-assistant'
import './cottage-assistant.css'

export function CottageAssistant({
  draft,
  apply,
  existing = false,
}: {
  draft: Record<string, any>
  apply: (patch: Record<string, any>) => void
  existing?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<AssistantStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [result, setResult] = useState<AssistantResult | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [approved, setApproved] = useState(false)
  const [busy, setBusy] = useState<'paste' | 'research' | null>(null)
  const pending = useRef(false)
  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    setStatusError('')
    fetch('/api/workspace?assistant=1', {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(readAssistantResponse)
      .then((body) => {
        const parsed = assistantStatus.safeParse(body)
        if (!parsed.success)
          throw new Error(
            'Assistant connection status is unavailable. Continue with manual entry.',
          )
        if (!controller.signal.aborted) setStatus(parsed.data)
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setStatusError(failure.message)
      })
    return () => controller.abort()
  }, [expanded])

  async function generate(mode: 'paste' | 'research') {
    if (pending.current) return
    pending.current = true
    setBusy(mode)
    setError('')
    setNotice('')
    setResult(null)
    setSelected([])
    setApproved(false)
    try {
      const response = await fetch('/api/workspace?assistant=1', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          text: mode === 'paste' ? text.trim() : query.trim(),
        }),
        signal: AbortSignal.timeout(40000),
      })
      const parsed = assistantResult.safeParse(
        await readAssistantResponse(response),
      )
      if (!parsed.success || parsed.data.mode !== mode)
        throw new Error(
          'The assistant returned invalid suggestions. Your draft is preserved.',
        )
      setResult(parsed.data)
      setStatus({
        configured: true,
        model: parsed.data.model,
        status: 'Connection successful',
        checkedAt: parsed.data.checkedAt,
        sourcesReturned: parsed.data.sources.length > 0,
        message: null,
      })
    } catch (failure) {
      const message =
        (failure as Error).name === 'TimeoutError'
          ? 'The assistant timed out. The request may still count toward usage. Retry explicitly or continue manually.'
          : (failure as Error).message
      setError(message + ' Your ingredient draft is preserved.')
      setStatus((old) =>
        old ? { ...old, status: 'Last request failed', message } : old,
      )
    } finally {
      pending.current = false
      setBusy(null)
    }
  }
  function commit() {
    if (!result || !approved || !selected.length || pending.current) return
    apply(assistantDraftPatch(result, selected))
    setResult(null)
    setSelected([])
    setApproved(false)
    setNotice(
      'Selected fields applied to your unsaved draft. Review the form, then use Save ingredient or Save changes when ready.',
    )
  }
  const canRequest = !!status?.configured && !statusError && !busy
  return (
    <details
      className="cottage-assistant"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <Sparkles size={18} aria-hidden="true" />
        <span>
          Cottage Pantry Assistant
          <small>Turn product text into a draft you can review</small>
        </span>
        <ChevronDown
          className="assistant-chevron"
          size={16}
          aria-hidden="true"
        />
      </summary>
      {expanded && (
        <div className="assistant-body">
          <div className="assistant-connection" role="status">
            <span
              className="assistant-status-dot"
              data-success={
                !statusError && status?.status === 'Connection successful'
              }
            />
            <strong>
              {statusError
                ? 'Connection status unavailable'
                : status?.status || 'Checking connection status…'}
            </strong>
            <span>Perplexity Sonar · via Netlify</span>
          </div>
          {statusError && (
            <p role="alert">
              {statusError} Close and reopen this panel to check status again.
            </p>
          )}
          {status?.message && (
            <p className="assistant-hint">{status.message}</p>
          )}
          {status?.checkedAt && (
            <p className="assistant-hint">
              Last request: {new Date(status.checkedAt).toLocaleString()}
              {status.sourcesReturned !== null
                ? ` · ${status.sourcesReturned ? 'Source metadata returned' : 'No source metadata returned'}`
                : ''}
            </p>
          )}
          <p className="assistant-hint">
            Only text you enter here is sent. Requests use your Netlify team’s
            AI credits. Sonar may search the web even for pasted text. Nothing
            runs in the background or retries automatically.
          </p>
          <label className="field">
            <span>Paste product information</span>
            <textarea
              rows={4}
              maxLength={12000}
              value={text}
              disabled={!!busy}
              onChange={(event) => {
                setText(event.target.value)
                setResult(null)
                setApproved(false)
              }}
              placeholder="Product name, package size, price and the exact label wording…"
            />
          </label>
          <button
            type="button"
            className="btn secondary"
            disabled={!canRequest || text.trim().length < 10}
            onClick={() => generate('paste')}
          >
            {busy === 'paste'
              ? 'Reading product information…'
              : 'Suggest ingredient fields'}
          </button>
          <details className="assistant-research">
            <summary>
              <BookOpen size={16} aria-hidden="true" />
              Web product research
              <ChevronDown
                className="assistant-chevron"
                size={16}
                aria-hidden="true"
              />
            </summary>
            <p className="assistant-hint">
              Separate research test. Enter a brand, exact product and package
              size, or a public URL. Retailer pages may be inaccessible; results
              may describe another variant. Research does not apply fields.
            </p>
            <label className="field">
              <span>Product to research</span>
              <textarea
                rows={2}
                maxLength={12000}
                value={query}
                disabled={!!busy}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn secondary"
              disabled={!canRequest || query.trim().length < 10}
              onClick={() => generate('research')}
            >
              {busy === 'research'
                ? 'Researching web sources…'
                : 'Research web sources'}
            </button>
          </details>
          <details className="assistant-usage">
            <summary>Usage &amp; limits</summary>
            <p className="assistant-hint">
              Limits: 10 requests/hour and 30/day per user; 30/hour and 100/day
              per oven. Failed requests count. Netlify currently converts $1 of
              model usage to 180 credits; search charges can apply. View team
              Billing → Usage for actual charges.
            </p>
          </details>
          {busy && (
            <p role="status">
              {busy === 'paste'
                ? 'Preparing suggestions for review…'
                : 'Waiting for a web research response…'}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {result && (
            <section
              className="assistant-review"
              aria-label={
                result.mode === 'paste'
                  ? 'Review ingredient suggestions'
                  : 'Web research result'
              }
            >
              <h4>
                {result.mode === 'paste'
                  ? 'Review suggested fields'
                  : 'Web research result'}
              </h4>
              <p className="assistant-hint">
                {result.model} · {new Date(result.checkedAt).toLocaleString()}
                {result.usage.costUsd !== null
                  ? ` · Reported model usage: $${result.usage.costUsd.toFixed(6)}`
                  : ' · Request cost was not returned'}
              </p>
              {result.mode === 'paste' ? (
                <>
                  <p>
                    Select the fields to copy. Suggestions use quoted evidence
                    from your pasted text and still need review against the
                    package.
                  </p>
                  {Object.entries(result.fields).map(([key, value]) => (
                    <label className="assistant-field-option" key={key}>
                      <input
                        type="checkbox"
                        checked={selected.includes(key)}
                        onChange={(event) => {
                          setSelected((old) =>
                            event.target.checked
                              ? [...old, key]
                              : old.filter((entry) => entry !== key),
                          )
                          setApproved(false)
                        }}
                      />
                      <span>
                        <strong>
                          {assistantFieldLabels[key as AssistantField]}
                        </strong>
                        <span className="assistant-field-change">
                          {String(draft[key] ?? 'Not set')} →{' '}
                          <b>{String(value)}</b>
                        </span>
                        <small>
                          From pasted text: “{result.evidence[key]}”
                        </small>
                      </span>
                    </label>
                  ))}
                  {!!Object.keys(result.fields).length && (
                    <>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={approved}
                          onChange={(event) =>
                            setApproved(event.target.checked)
                          }
                        />
                        I reviewed and approve copying the selected fields into
                        this unsaved draft.
                        {existing
                          ? ' Saving package changes can change future cost estimates.'
                          : ''}
                      </label>
                      <p className="assistant-hint">
                        Allergen review remains unapproved. Costing and unit
                        conversions use the existing calculation engine. Saving
                        is a separate action.
                      </p>
                      <button
                        type="button"
                        className="btn"
                        disabled={!selected.length || !approved || !!busy}
                        onClick={commit}
                      >
                        Apply selected fields to draft
                      </button>
                    </>
                  )}
                </>
              ) : (
                <p className="assistant-answer">{result.answer}</p>
              )}
              {result.warnings.map((warning, index) => (
                <p className="warning-text" key={index}>
                  {warning}
                </p>
              ))}
              {result.sources.length ? (
                <details
                  className="assistant-sources"
                  open={result.mode === 'research'}
                >
                  <summary>
                    Web references returned ({result.sources.length})
                  </summary>
                  {result.mode === 'paste' && (
                    <p>
                      These references were returned by Sonar. Field suggestions
                      are based on the pasted text; a reference does not verify
                      a suggestion.
                    </p>
                  )}
                  <ol>
                    {result.sources.map((source) => (
                      <li key={source.url}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {source.title}
                        </a>
                        <small>{new URL(source.url).hostname}</small>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : (
                <p className="assistant-hint">
                  No web source metadata returned.
                </p>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setResult(null)
                  setSelected([])
                  setApproved(false)
                }}
              >
                Discard {result.mode === 'paste' ? 'suggestions' : 'research'}
              </button>
            </section>
          )}
        </div>
      )}
    </details>
  )
}
