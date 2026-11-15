import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supportAiRequest } from '@/lib/support-client'
import {
  supportAiDefaults,
  sanitizeSupportDiagnostics,
  type SupportAiConversation,
  type SupportAiMessage,
  type SupportCorrection,
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
          {m.stage && <small>{m.stage}</small>}
          <p>{m.text}</p>
          {!!m.articles?.length && (
            <ul className="ai-links">
              {supportKnowledge
                .filter((a) => m.articles?.includes(a.id))
                .map((a) => (
                  <li key={a.id}>
                    <a
                      href={
                        requesterLabel !== 'You'
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
export function SupportHelper({
  staff = false,
  contextTicketId,
  screenshots = [],
}: {
  staff?: boolean
  contextTicketId?: string
  screenshots?: { id: string; label: string }[]
} = {}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  const [screenshot, setScreenshot] = useState('')
  const [screenshotConsent, setScreenshotConsent] = useState(false)
  const [contextConsent, setContextConsent] = useState(false)
  const [shareDiagnostics, setShareDiagnostics] = useState(false)
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
    supportAiRequest(staff)
      .then((v) => {
        if (active) {
          const available = staff
            ? v.conversations.filter(
                (c: SupportAiConversation) =>
                  (c.contextTicketId || undefined) === contextTicketId,
              )
            : v.conversations
          setChats(available)
          setId(available[0]?.id || '')
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
  }, [staff, contextTicketId])
  useEffect(() => {
    if (chat?.messages.length)
      end.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' })
  }, [chat?.messages.length])
  async function correction(
    action: 'confirm' | 'undo',
    proposal: SupportCorrection,
  ) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await supportAiRequest(false, {
        action,
        actionId: proposal.id,
        ...(action === 'confirm'
          ? {
              confirmation: 'APPLY_TIMEZONE',
              timezone: proposal.after.timezone,
            }
          : {}),
      })
      setNotice(
        `${result.stage}: ${result.message || 'Review the new undo proposal below; nothing is undone until approved.'}`,
      )
      const refreshed = await supportAiRequest(false)
      setChats(refreshed.conversations)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function send(e: FormEvent) {
    e.preventDefault()
    if (busy || !draft.trim() || !consent) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const v = await supportAiRequest(staff, {
        action: 'chat',
        requestId: crypto.randomUUID(),
        conversationId: id || undefined,
        message: draft,
        consent: true,
        contextConsent,
        ...(screenshot && screenshotConsent
          ? { screenshotAttachmentId: screenshot, screenshotConsent: true }
          : {}),
        ...(staff ? { ticketId: contextTicketId } : {}),
        ...(attach ? { diagnostics } : {}),
      })
      setChats((old) => [
        v.conversation,
        ...old.filter((c) => c.id !== v.conversation.id),
      ])
      setId(v.conversation.id)
      setDraft('')
      setScreenshot('')
      setScreenshotConsent(false)
      setAttach(false)
      setContextConsent(false)
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
      const v = await supportAiRequest(staff, {
        action: 'escalate',
        conversationId: chat.id,
        summary,
        diagnostics: shareDiagnostics
          ? attach
            ? diagnostics
            : chat.diagnostics
          : null,
      })
      setChats((old) =>
        old.map((c) =>
          c.id === chat.id
            ? {
                ...c,
                ticketId: v.ticketId,
                diagnostics: shareDiagnostics
                  ? attach
                    ? diagnostics
                    : chat.diagnostics
                  : null,
              }
            : c,
        ),
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
      await supportAiRequest(staff, {
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
    <section
      className="support-helper"
      aria-label={staff ? 'Private admin AI assistant' : 'AI support helper'}
    >
      <h3>{staff ? 'Private admin AI assistant' : 'AI support helper'}</h3>
      <p>
        {staff
          ? 'Private to your verified administrator account. Search support, inspect recorded account, billing and integration status, review sanitized diagnostics, and review the selected ticket. Account actions are unavailable through support conversations.'
          : 'Practical steps from current app workflows. With your permission, check your verified account, current business, recorded plan/integration status allowed by your role, receipt attempt statuses and your label recovery count. The business Owner can review and approve an exact timezone correction. AI can make mistakes; it cannot edit stock, item types, plans or permissions.'}
      </p>
      <div className="ai-toolbar">
        <a href={staff ? 'https://mycottagepantry.com/help' : '/help'}>
          Help guides
        </a>
        <a href={staff ? '/platform-support' : '/support'}>
          {staff ? 'Support inbox' : 'Your tickets'}
        </a>
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
          guides. With status-sharing consent, only the listed account/business
          metadata and permitted diagnostic counts are sent. Raw account
          records, inventory and payment details are excluded. Sanitized error
          attachments are excluded from AI requests. Only a screenshot
          explicitly selected and approved below is sent, resized to 512 pixels;
          screenshot text may contain private data. Avoid private details in
          messages. The provider processes these messages under its service data
          policies.
        </p>
        <p>
          Conversations and optional diagnostics are stored privately for{' '}
          {policy.retentionDays} days from creation. They become unavailable at
          expiry and are deleted by the daily cleanup.{' '}
          {staff
            ? 'Private administrator chats never attach to customer tickets. '
            : ''}
          Contact support shares them and your reviewed summary with authorized
          support staff. Staff can request AI summaries of your issue and public
          replies through the same provider. Delete conversation removes that
          attachment, including from a support request. The support ticket
          summary and staff replies remain under the existing ticket record
          policy. Timezone approval audits retain the actor, business, exact
          target, before/after values and outcome separately from chat
          retention; deleting a chat does not delete those audits. Usage counts
          and token totals contain no conversation text and expire after 30
          days. Requests set provider storage off. OpenAI may retain
          abuse-monitoring logs for up to 30 days under its policy; zero
          retention is not claimed. Status sharing sends only allowlisted
          metadata when selected, with no credentials, private inventory,
          payment details, files or raw logs.
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
          <SupportTranscript
            messages={chat.messages}
            requesterLabel={staff ? 'Administrator' : 'You'}
          />
          {!staff &&
            chat.corrections?.map((p) => (
              <section
                className="ai-notice"
                key={p.id}
                aria-label="Timezone correction approval"
              >
                <strong>
                  {p.status === 'verified'
                    ? 'Fix verified — recorded outcome'
                    : p.status === 'proposed'
                      ? 'Change proposed — approval required'
                      : `Proposal ${p.status}`}
                </strong>
                <p>
                  Business: {p.business_id} · Settings: {p.target_id}
                </p>
                <p>
                  Timezone: {p.before.timezone || 'Default (America/Chicago)'} →{' '}
                  {p.after.timezone}
                </p>
                <p>
                  Changes business-local date defaults and date-based views for
                  everyone in this oven. Existing saved transaction dates remain
                  unchanged. Undo restores the previous timezone; it cannot
                  reverse records created meanwhile.
                </p>
                {p.status === 'proposed' && (
                  <>
                    <small>
                      Expires {new Date(p.expires_at).toLocaleString()}
                    </small>
                    <button
                      type="button"
                      disabled={busy || Date.parse(p.expires_at) <= now}
                      onClick={() => correction('confirm', p)}
                    >
                      Approve exact change to {p.after.timezone}
                    </button>
                  </>
                )}
                {p.status === 'verified' && (
                  <>
                    <p>
                      Read back and verified{' '}
                      {p.verified_at &&
                        new Date(p.verified_at).toLocaleString()}
                      . Refresh your oven to load the setting. Check the
                      original symptom separately.
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => correction('undo', p)}
                    >
                      Review undo proposal
                    </button>
                  </>
                )}
              </section>
            ))}
          <div ref={end} />
          <small>Expires {new Date(chat.expiresAt).toLocaleDateString()}</small>
        </>
      )}
      {ready && !policy.enabled && (
        <p role="status">
          AI support is in private evaluation or paused. Help guides and Contact
          support remain available.
        </p>
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
            {staff
              ? 'I agree to send my messages and permitted metadata for the selected support ticket to the AI provider as described above.'
              : 'I agree to send my messages to the AI provider as described above.'}
          </label>
          {!staff && (
            <label className="ai-check">
              <input
                type="checkbox"
                checked={contextConsent}
                onChange={(e) => setContextConsent(e.target.checked)}
              />
              Allow authorized status checks for this question and share
              sanitized results with the AI provider (verified sign-in, business
              role, permitted plan/integration status, receipt attempt statuses
              my label recovery count, and business timezone
              inspection/proposals).
            </label>
          )}
          {!staff && (
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
          )}
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
          {!!screenshots.length && (
            <>
              <label>
                Screenshot from selected ticket
                <select
                  value={screenshot}
                  onChange={(e) => {
                    setScreenshot(e.target.value)
                    setScreenshotConsent(false)
                  }}
                >
                  <option value="">Do not share a screenshot</option>
                  {screenshots.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              {screenshot && (
                <label className="ai-check">
                  <input
                    type="checkbox"
                    checked={screenshotConsent}
                    onChange={(e) => setScreenshotConsent(e.target.checked)}
                  />
                  I reviewed this screenshot and approve sending its visible
                  content to OpenAI for this question. Screenshots can contain
                  private information; use the ticket preview before sharing.
                </label>
              )}
            </>
          )}
          <button
            className="btn primary"
            disabled={
              busy ||
              !consent ||
              !policy.enabled ||
              (!!screenshot &&
                (!screenshotConsent ||
                  !screenshots.some((a) => a.id === screenshot)))
            }
          >
            {busy ? 'Preparing reply…' : 'Send to AI'}
          </button>
        </form>
      )}
      {chat ? (
        <div className="ai-toolbar">
          {!staff && (
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
                setShareDiagnostics(!!(attach ? diagnostics : chat.diagnostics))
                setReview(true)
                setDeleting(false)
              }}
            >
              Contact support
            </button>
          )}
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
      ) : !staff ? (
        <a href="/support">Contact support without AI</a>
      ) : null}
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
          {!!(attach ? diagnostics : chat?.diagnostics) && (
            <>
              <label className="ai-check">
                <input
                  type="checkbox"
                  checked={shareDiagnostics}
                  onChange={(e) => setShareDiagnostics(e.target.checked)}
                />
                Include these sanitized diagnostics with my support request
              </label>
              <pre>
                {JSON.stringify(
                  attach ? diagnostics : chat?.diagnostics,
                  null,
                  2,
                )}
              </pre>
            </>
          )}
          <p>
            Review this summary before sharing it with support. The conversation
            and the diagnostic attachment you approve are included until deleted
            or expired. Support staff may use AI to summarize your report and
            public replies for review. Diagnostics are excluded from AI
            requests.
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
