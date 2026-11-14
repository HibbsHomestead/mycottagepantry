import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supportAiRequest } from '@/lib/support-client'
import {
  supportAiDefaults,
  sanitizeSupportDiagnostics,
  type SupportAiConversation,
  type SupportAiMessage,
} from '@/lib/support-ai'
import { supportKnowledge } from '@/lib/support-knowledge'
import {
  createInventoryErrorDetails,
  latestInventoryErrorDetails,
} from '@/lib/inventory-error-details'
import './support-helper.css'

export function SupportTranscript({
  messages,
  requesterLabel = 'You',
}: {
  messages: SupportAiMessage[]
  requesterLabel?: string
}) {
  return (
    <ol className="ai-messages" aria-label="AI support conversation">
      {messages.map((m, i) => (
        <li key={i} className={m.role}>
          <strong>
            {m.role === 'assistant' ? 'AI support helper' : requesterLabel}
          </strong>
          <p>{m.text}</p>
          {!!m.articles?.length && (
            <ul className="ai-links">
              {supportKnowledge
                .filter((a) => m.articles?.includes(a.id))
                .map((a) => (
                  <li key={a.id}>
                    <a
                      href={
                        requesterLabel === 'Requester'
                          ? 'https://mycottagepantry.com' + a.href
                          : a.href
                      }
                    >
                      {a.title}
                    </a>
                  </li>
                ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}
export function SupportHelper() {
  const [chats, setChats] = useState<SupportAiConversation[]>([])
  const [id, setId] = useState(''),
    [draft, setDraft] = useState(''),
    [summary, setSummary] = useState('')
  const [consent, setConsent] = useState(false),
    [attach, setAttach] = useState(false)
  const [diagnostics, setDiagnostics] =
    useState<ReturnType<typeof sanitizeSupportDiagnostics>>(null)
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [review, setReview] = useState(false),
    [deleting, setDeleting] = useState(false),
    [policy, setPolicy] = useState(supportAiDefaults)
  const end = useRef<HTMLDivElement>(null)
  const chat = chats.find((c) => c.id === id)
  useEffect(() => {
    let active = true
    supportAiRequest()
      .then((v) => {
        if (active) {
          setChats(v.conversations)
          setId(v.conversations[0]?.id || '')
          setPolicy(v.policy)
          setReady(true)
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (chat?.messages.length)
      end.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' })
  }, [chat?.messages.length])
  async function send(e: FormEvent) {
    e.preventDefault()
    if (busy || !draft.trim() || !consent) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const v = await supportAiRequest(false, {
        action: 'chat',
        requestId: crypto.randomUUID(),
        conversationId: id || undefined,
        message: draft,
        consent: true,
        ...(attach ? { diagnostics } : {}),
      })
      setChats((old) => [
        v.conversation,
        ...old.filter((c) => c.id !== v.conversation.id),
      ])
      setId(v.conversation.id)
      setDraft('')
      setAttach(false)
      if (v.providerFailed)
        setNotice(
          'AI reply unavailable. Your question is saved; Contact support remains available.',
        )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function escalate(e: FormEvent) {
    e.preventDefault()
    if (!chat || busy) return
    setBusy(true)
    setError('')
    try {
      const v = await supportAiRequest(false, {
        action: 'escalate',
        conversationId: chat.id,
        summary,
      })
      setChats((old) =>
        old.map((c) => (c.id === chat.id ? { ...c, ticketId: v.ticketId } : c)),
      )
      setReview(false)
      setNotice(
        'Support request created. Continue with a person in Your tickets.',
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!chat || busy) return
    setBusy(true)
    setError('')
    try {
      await supportAiRequest(false, {
        action: 'delete',
        conversationId: chat.id,
      })
      setChats((old) => old.filter((c) => c.id !== chat.id))
      setId('')
      setDeleting(false)
      setReview(false)
      setNotice(
        'Conversation and its diagnostic attachment deleted. Any support ticket summary and replies remain in Your tickets.',
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="support-helper" aria-label="AI support helper">
      <h3>AI support helper</h3>
      <p>
        Short steps from Cottage Pantry’s help guides. AI can make mistakes and
        cannot inspect or change your account, stock, billing, or permissions.
      </p>
      <div className="ai-toolbar">
        <a href="/help">Help guides</a>
        <a href="/support">Your tickets</a>
        {ready && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setId('')
              setDraft('')
              setReview(false)
              setDeleting(false)
              setNotice(
                'New conversation. Previous conversations remain in the list.',
              )
            }}
          >
            New conversation
          </button>
        )}
      </div>
      {!!chats.length && (
        <label>
          Conversation
          <select
            aria-label="Conversation"
            value={id}
            disabled={busy}
            onChange={(e) => {
              setId(e.target.value)
              setReview(false)
              setDeleting(false)
            }}
          >
            <option value="">New conversation</option>
            {chats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.messages[0]?.text.slice(0, 65) || 'Conversation'}
              </option>
            ))}
          </select>
        </label>
      )}
      <details>
        <summary>AI data, limits & retention</summary>
        <p>
          When you choose Send, your redacted messages and recent conversation
          are sent to OpenAI through Netlify AI Gateway with the relevant help
          guides. The helper does not fetch or attach account records, inventory
          or payment details. Diagnostic attachments are excluded from AI
          requests. Avoid private details in messages. The provider processes
          these messages under its service data policies.
        </p>
        <p>
          Conversations and optional diagnostics are stored privately for{' '}
          {policy.retentionDays} days from creation. They become unavailable at
          expiry and are deleted by the daily cleanup. Contact support shares
          them and your reviewed summary with authorized support staff. Staff
          can request AI summaries of your issue and public replies through the
          same provider. Delete conversation removes that attachment, including
          from a support request. The support ticket summary and staff replies
          remain under the existing ticket record policy. Usage counts and token
          totals contain no conversation text and expire after 30 days.
        </p>
        <p>
          Up to {policy.userDaily} requests per person and{' '}
          {policy.businessDaily} per oven in 24 hours, with{' '}
          {policy.cooldownSeconds} seconds between requests. A platform cap also
          applies. Failed attempts count toward limits.
        </p>
      </details>
      {error && (
        <p role="alert" className="ai-notice">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="ai-notice">
          {notice}
        </p>
      )}
      {chat && (
        <>
          <SupportTranscript messages={chat.messages} />
          <div ref={end} />
          <small>Expires {new Date(chat.expiresAt).toLocaleDateString()}</small>
        </>
      )}
      {ready && (
        <form onSubmit={send} aria-label="Ask AI support">
          <label>
            Your app question
            <textarea
              rows={2}
              maxLength={2000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="How do I receive stock?"
              required
            />
          </label>
          <label className="ai-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I agree to send my messages to the AI provider as described above.
          </label>
          <label className="ai-check">
            <input
              type="checkbox"
              checked={attach}
              onChange={(e) => {
                setAttach(e.target.checked)
                if (e.target.checked)
                  setDiagnostics(
                    sanitizeSupportDiagnostics(
                      latestInventoryErrorDetails() || {
                        ...createInventoryErrorDetails(null),
                        pathname:
                          window.location.pathname + window.location.hash,
                      },
                    ),
                  )
              }}
            />
            Attach sanitized error details for support review
          </label>
          {attach && (
            <details open>
              <summary>Review diagnostic attachment</summary>
              <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
              <small>
                Only allowlisted error details, app version, page and time. No
                raw error text or business records.
              </small>
            </details>
          )}
          <button
            className="btn primary"
            disabled={busy || !consent || !policy.enabled}
          >
            {busy ? 'Preparing reply…' : 'Send to AI'}
          </button>
        </form>
      )}
      {chat ? (
        <div className="ai-toolbar">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setSummary(
                chat.messages
                  .filter((m) => m.role === 'user')
                  .map((m) => m.text)
                  .join('\n')
                  .slice(0, 1500),
              )
              setReview(true)
              setDeleting(false)
            }}
          >
            Contact support
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDeleting(true)
              setReview(false)
            }}
          >
            Delete conversation
          </button>
          {chat.ticketId && (
            <a href={'/support#ticket=' + chat.ticketId}>
              Open support request
            </a>
          )}
        </div>
      ) : (
        <a href="/support">Contact support without AI</a>
      )}
      {review && (
        <form onSubmit={escalate} aria-label="Review support request">
          <label>
            Issue summary for support
            <textarea
              required
              minLength={3}
              maxLength={1500}
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </label>
          <p>
            Review this summary before sharing it with support. The conversation
            and any diagnostic attachment are included until deleted or expired.
            Support staff may use AI to summarize your report and public replies
            for review. Diagnostics are excluded from AI requests.
          </p>
          <div className="ai-toolbar">
            <button className="btn primary" disabled={busy}>
              Create support request
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {deleting && (
        <div className="ai-notice">
          <p>
            Delete this conversation and its diagnostic attachment? Support
            ticket summaries and replies remain.
          </p>
          <div className="ai-toolbar">
            <button type="button" disabled={busy} onClick={() => void remove()}>
              Confirm deletion
            </button>
            <button type="button" onClick={() => setDeleting(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
