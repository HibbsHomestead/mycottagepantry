import { SupportAiUsage, SupportAiSuggestion } from './support-ai-admin'
import { SupportTranscript, SupportHelper } from './support-helper'
import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  ArrowLeft,
  Plus,
  Search,
  MessageCircle,
  LockKeyhole,
  Paperclip,
  RefreshCw,
} from 'lucide-react'
import { PublicSite } from './public-site'
import {
  supportCategories,
  supportStatuses,
  safeSupportRoute,
  type SupportDetail,
  type SupportTicket,
} from '@/lib/support'
import {
  supportRequest,
  supportPost,
  uploadSupportScreenshot,
  downloadSupportScreenshot,
} from '@/lib/support-client'
import './support-page.css'
function time(value: string) {
  return new Date(value).toLocaleString()
}
function ticketHash() {
  const id = new URLSearchParams(window.location.hash.slice(1)).get('ticket')
  return id && /^[a-f0-9-]{36}$/i.test(id) ? id : ''
}
function ScreenshotInput({ onFile }: { onFile: (file: File | null) => void }) {
  return (
    <label className="support-field">
      Optional screenshot
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => onFile(e.target.files?.[0] || null)}
      />
      <small>
        PNG, JPEG or WebP · up to 2 MB and 4096 × 4096 pixels. Crop out private
        business/customer details. Image metadata is removed.
      </small>
    </label>
  )
}
function SupportFrame({
  staff,
  children,
}: {
  staff: boolean
  children: ReactNode
}) {
  return staff ? children : <PublicSite>{children}</PublicSite>
}
export function SupportPage({ staff = false }: { staff?: boolean }) {
  const [access, setAccess] = useState<{
    staff: boolean
    admin: boolean
  } | null>(null)
  const [initialError, setInitialError] = useState(''),
    [initialStatus, setInitialStatus] = useState(0),
    [retry, setRetry] = useState(0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [tickets, setTickets] = useState<SupportTicket[]>([]),
    [detail, setDetail] = useState<SupportDetail | null>(null)
  const [selected, setSelected] = useState(''),
    [compose, setCompose] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false)
  const [search, setSearch] = useState(''),
    [appliedSearch, setAppliedSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [offset, setOffset] = useState(0),
    [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [detailLoading, setDetailLoading] = useState(false)
  const [subject, setSubject] = useState(''),
    [category, setCategory] = useState<string>(supportCategories[0]),
    [message, setMessage] = useState(''),
    [reply, setReply] = useState(''),
    [internal, setInternal] = useState(false),
    [aiReviewConsent, setAiReviewConsent] = useState(false)
  const [file, setFile] = useState<File | null>(null),
    [replyFile, setReplyFile] = useState<File | null>(null)
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID()),
    [replyKey, setReplyKey] = useState(() => crypto.randomUUID())
  const mode = staff ? '?view=staff' : '?view=customer'
  const showError = useCallback((value: unknown) => {
    const failure = value as { message: string; status?: number }
    if (failure.status === 401 || failure.status === 403) {
      setInitialError(failure.message)
      setInitialStatus(failure.status)
      setAccess(null)
      setTickets([])
      setDetail(null)
    } else setError(failure.message)
  }, [])
  useEffect(() => {
    let active = true
    const check = () =>
      supportRequest(mode)
        .then((v) => {
          if (active) {
            setAccess((old) =>
              old?.staff === v.staff && old?.admin === v.admin ? old : v,
            )
            setInitialError('')
            setInitialStatus(0)
            setSelected(ticketHash())
          }
        })
        .catch((e) => {
          if (active) {
            setInitialError(e.message)
            setInitialStatus(e.status || 503)
            setAccess(null)
            setTickets([])
            setDetail(null)
          }
        })
    void check()
    window.addEventListener('focus', check)
    const timer = window.setInterval(check, 60000)
    return () => {
      active = false
      window.removeEventListener('focus', check)
      window.clearInterval(timer)
    }
  }, [mode, retry])
  useEffect(() => {
    const navigate = () => {
      setSelected(ticketHash())
      setCompose(false)
      setSettingsOpen(false)
    }
    window.addEventListener('hashchange', navigate)
    window.addEventListener('popstate', navigate)
    return () => {
      window.removeEventListener('hashchange', navigate)
      window.removeEventListener('popstate', navigate)
    }
  }, [])
  const listRequest = useRef({ sequence: 0 })
  const loadList = useCallback(async () => {
    const request = ++listRequest.current.sequence
    setLoading(true)
    setError('')
    try {
      const v = await supportPost(staff, 'list', {
        search: appliedSearch,
        status,
        offset,
      })
      if (request !== listRequest.current.sequence) return
      setTickets(v.tickets)
      setHasMore(v.hasMore)
    } catch (e) {
      if (request === listRequest.current.sequence) showError(e)
    } finally {
      if (request === listRequest.current.sequence) setLoading(false)
    }
  }, [staff, appliedSearch, status, offset, showError])
  useEffect(() => {
    const state = listRequest.current
    let active = true
    queueMicrotask(() => {
      if (active && access) void loadList()
    })
    return () => {
      active = false
      state.sequence++
    }
  }, [access, loadList])
  useEffect(() => {
    if (!selected || !access) return
    const controller = new AbortController()
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setDetailLoading(true)
        setDetail(null)
        setReply('')
        setReplyFile(null)
        setInternal(false)
        setReplyKey(crypto.randomUUID())
      }
    })
    supportRequest(mode + '&ticket=' + selected, { signal: controller.signal })
      .then(setDetail)
      .catch((e) => {
        if (!controller.signal.aborted) showError(e)
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false)
      })
    return () => controller.abort()
  }, [selected, access, mode, showError])
  function choose(id: string) {
    setSelected(id)
    setCompose(false)
    setSettingsOpen(false)
    setError('')
    setNotice('')
    window.history.pushState(null, '', '#ticket=' + id)
  }
  function validateFile(value: File | null) {
    if (
      value &&
      (value.size > 2 * 1024 * 1024 ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(value.type))
    )
      throw new Error('Choose a PNG, JPEG or WebP screenshot up to 2 MB.')
  }
  async function attach(
    result: SupportDetail,
    value: File | null,
    key: string,
  ) {
    if (!value) return
    const ownMessage = [...result.messages].reverse().find((m) => m.own)
    if (!ownMessage) return
    try {
      await uploadSupportScreenshot(staff, ownMessage.id, value, key)
      const fresh = await supportRequest(mode + '&ticket=' + result.ticket.id)
      setDetail(fresh)
    } catch {
      setNotice(
        'Your message is saved. The screenshot was not attached; open a reply to try the screenshot again. Do not submit the same message again.',
      )
    }
  }
  async function create(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      validateFile(file)
      const from = new URLSearchParams(window.location.hash.slice(1)).get(
        'context',
      )
      const result = (await supportPost(false, 'create', {
        subject,
        category,
        message,
        submissionKey: createKey,
        aiReviewConsent,
        route: safeSupportRoute(from || '/support'),
      })) as SupportDetail
      choose(result.ticket.id)
      setDetail(result)
      await attach(result, file, createKey)
      setAiReviewConsent(false)
      setSubject('')
      setMessage('')
      setFile(null)
      setCreateKey(crypto.randomUUID())
      await loadList()
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
    }
  }
  async function sendReply(e: FormEvent) {
    e.preventDefault()
    if (!detail || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      validateFile(replyFile)
      const result = (await supportPost(staff, 'reply', {
        ticketId: detail.ticket.id,
        message: reply,
        submissionKey: replyKey,
        internal,
      })) as SupportDetail
      setDetail(result)
      await attach(result, replyFile, replyKey)
      setReply('')
      setReplyFile(null)
      setReplyKey(crypto.randomUUID())
      await loadList()
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
    }
  }
  async function changeStatus(next: string) {
    if (!detail || busy) return
    setBusy(true)
    setError('')
    try {
      setDetail(
        await supportPost(staff, 'status', {
          ticketId: detail.ticket.id,
          status: next,
        }),
      )
      await loadList()
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <SupportFrame staff={staff}>
      <section className="support-shell">
        {!staff && (
          <a className="public-text-link" href="/oven">
            <ArrowLeft size={16} />
            Open oven
          </a>
        )}
        <header className="support-heading">
          <div>
            <p className="public-eyebrow">
              {staff ? 'Platform support · restricted' : 'Help & support'}
            </p>
            <h1>{staff ? 'Support inbox' : 'Get help'}</h1>
            <p>
              {staff
                ? 'Customer conversations and private internal notes.'
                : 'Your tickets are private to you and authorized platform support staff. Support is available on Free and every paid plan.'}
            </p>
          </div>
          {access && (
            <div className="support-actions">
              {!staff && (
                <button
                  className="public-button"
                  disabled={busy}
                  onClick={() => {
                    setCompose(true)
                    setSettingsOpen(false)
                    setSelected('')
                    setDetail(null)
                    setNotice('')
                    setError('')
                  }}
                >
                  <Plus size={17} />
                  New ticket
                </button>
              )}
              {!staff && access.staff && (
                <a href="https://admin.mycottagepantry.com/platform-support">
                  Platform support inbox
                </a>
              )}
              {staff && access.admin && (
                <button
                  className="support-button"
                  disabled={busy}
                  onClick={() => setSettingsOpen(!settingsOpen)}
                >
                  Notification settings
                </button>
              )}
            </div>
          )}
        </header>
        {initialError ? (
          <div className="support-panel">
            <p role="alert">{initialError}</p>
            {initialStatus === 401 ? (
              <a
                className="public-button"
                href={
                  staff
                    ? '/admin?returnTo=%2Fplatform-support' +
                      encodeURIComponent(window.location.hash)
                    : '/login'
                }
              >
                {staff ? 'Admin sign-in' : 'Log in'}
              </a>
            ) : initialStatus === 403 ? (
              <p>
                Access denied.{' '}
                {staff
                  ? 'Your account does not have platform support permission.'
                  : 'Your account cannot open support.'}
              </p>
            ) : (
              <p>
                The inbox could not be loaded. Your saved conversations remain
                available when the connection recovers.
              </p>
            )}
            <button
              className="support-button"
              onClick={() => {
                setInitialError('')
                setRetry((v) => v + 1)
              }}
            >
              Retry loading
            </button>
            <p>
              <a href={staff ? 'https://mycottagepantry.com/help' : '/help'}>
                Cannot sign in? Help & contact
              </a>
            </p>
          </div>
        ) : !access ? (
          <p role="status">Checking your verified account…</p>
        ) : (
          <>
            {error && (
              <p role="alert" className="support-alert">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="support-alert">
                {notice}
              </p>
            )}
            {staff && <SupportAiUsage admin={access.admin} />}
            {staff && (
              <details className="support-panel support-helper">
                <summary>Private admin AI assistant</summary>
                <SupportHelper
                  key={selected}
                  staff
                  contextTicketId={selected || undefined}
                />
              </details>
            )}
            {settingsOpen && access.admin ? (
              <SupportNotificationSettings />
            ) : (
              <div className="support-grid">
                <aside className="support-panel support-list">
                  <h2>{staff ? 'Tickets' : 'Your tickets'}</h2>
                  <form
                    className="support-search"
                    onSubmit={(e) => {
                      e.preventDefault()
                      setOffset(0)
                      setAppliedSearch(search)
                    }}
                  >
                    <label>
                      Search tickets
                      <input
                        value={search}
                        maxLength={100}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={
                          staff
                            ? 'Number, subject or requester'
                            : 'Number or subject'
                        }
                      />
                    </label>
                    <button
                      className="support-button"
                      aria-label="Search tickets"
                    >
                      <Search size={17} />
                    </button>
                  </form>
                  <label className="support-field">
                    Status
                    <select
                      value={status}
                      onChange={(e) => {
                        setStatus(e.target.value)
                        setOffset(0)
                      }}
                    >
                      <option value="all">All statuses</option>
                      {Object.entries(supportStatuses).map(([key, value]) => (
                        <option key={key} value={key}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="support-button"
                    onClick={() => void loadList()}
                    disabled={loading}
                  >
                    <RefreshCw size={14} />
                    Refresh inbox
                  </button>
                  {loading ? (
                    <p role="status">Loading tickets…</p>
                  ) : tickets.length ? (
                    <ul>
                      {tickets.map((t) => (
                        <li key={t.id}>
                          <button
                            className={selected === t.id ? 'selected' : ''}
                            disabled={busy}
                            onClick={() => choose(t.id)}
                          >
                            <small>
                              #{t.number} · {supportStatuses[t.status]}
                            </small>
                            <strong>{t.subject}</strong>
                            {t.requesterEmail && (
                              <span>{t.requesterEmail}</span>
                            )}
                            <small>{time(t.updatedAt)}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : error ? (
                    <p>Inbox loading failed. Use Refresh inbox to try again.</p>
                  ) : (
                    <p>No tickets match this view.</p>
                  )}
                  <div className="support-actions">
                    <button
                      className="support-button"
                      disabled={offset === 0 || loading}
                      onClick={() => setOffset(Math.max(0, offset - 50))}
                    >
                      Previous
                    </button>
                    <button
                      className="support-button"
                      disabled={!hasMore || loading}
                      onClick={() => setOffset(offset + 50)}
                    >
                      Next
                    </button>
                  </div>
                </aside>
                <div className="support-panel support-conversation">
                  {!staff && compose ? (
                    <form onSubmit={create} aria-label="New support ticket">
                      <h2>Tell us what you need</h2>
                      <p className="support-warning">
                        Do not submit passwords, API keys or payment-card
                        details. Only the text and screenshot you choose are
                        attached; no business records, console logs or financial
                        data are collected automatically.
                      </p>
                      <label className="support-field">
                        Subject
                        <input
                          required
                          maxLength={160}
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                        />
                      </label>
                      <label className="support-field">
                        Category
                        <select
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                        >
                          {supportCategories.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                      <label className="support-field">
                        Message
                        <textarea
                          required
                          maxLength={6000}
                          rows={7}
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                        />
                      </label>
                      <label className="support-note-choice">
                        <input
                          type="checkbox"
                          checked={aiReviewConsent}
                          onChange={(e) => setAiReviewConsent(e.target.checked)}
                        />
                        Allow support staff to send my issue summary and public
                        replies to OpenAI via Netlify AI Gateway for
                        troubleshooting suggestions. Screenshots, diagnostics
                        and private notes are excluded. Optional; support
                        remains available without AI review.
                      </label>
                      <ScreenshotInput key={createKey} onFile={setFile} />
                      <p className="support-fine">
                        We include only a sanitized app location and release
                        version. Email notifications may be inactive; your
                        ticket is saved in the app.
                      </p>
                      <button className="public-button" disabled={busy}>
                        {busy ? 'Saving…' : 'Submit ticket'}
                      </button>
                    </form>
                  ) : detailLoading ? (
                    <p role="status">Loading conversation…</p>
                  ) : detail ? (
                    <>
                      <header>
                        <p className="public-eyebrow">
                          Ticket #{detail.ticket.number} ·{' '}
                          {detail.ticket.category}
                        </p>
                        <h2>{detail.ticket.subject}</h2>
                        <p>
                          <span className="support-status">
                            {supportStatuses[detail.ticket.status]}
                          </span>{' '}
                          · Created {time(detail.ticket.createdAt)}
                        </p>
                        {staff && (
                          <p className="support-fine">
                            Requester: {detail.ticket.requesterEmail}
                            <br />
                            Oven:{' '}
                            {detail.ticket.workspaceId || 'No active oven'}
                            <br />
                            App: {detail.ticket.diagnostics?.appVersion} ·
                            Location: {detail.ticket.diagnostics?.route}
                          </p>
                        )}
                        <div className="support-actions">
                          {staff ? (
                            <label className="support-field">
                              Ticket status
                              <select
                                value={detail.ticket.status}
                                disabled={busy}
                                onChange={(e) =>
                                  void changeStatus(e.target.value)
                                }
                              >
                                {Object.entries(supportStatuses).map(
                                  ([k, v]) => (
                                    <option value={k} key={k}>
                                      {v}
                                    </option>
                                  ),
                                )}
                              </select>
                            </label>
                          ) : (
                            <button
                              className="support-button"
                              disabled={busy}
                              onClick={() =>
                                void changeStatus(
                                  detail.ticket.status === 'resolved'
                                    ? 'new'
                                    : 'resolved',
                                )
                              }
                            >
                              {detail.ticket.status === 'resolved'
                                ? 'Reopen ticket'
                                : 'Resolve ticket'}
                            </button>
                          )}
                          <button
                            className="support-button"
                            disabled={busy || detailLoading}
                            onClick={() => {
                              setDetailLoading(true)
                              supportRequest(mode + '&ticket=' + selected)
                                .then(setDetail)
                                .catch((e) => setError(e.message))
                                .finally(() => setDetailLoading(false))
                            }}
                          >
                            Refresh conversation
                          </button>
                        </div>
                      </header>
                      <ol
                        className="support-messages"
                        aria-label="Conversation history"
                      >
                        {detail.messages.map((m) => (
                          <li
                            className={'support-message ' + m.kind}
                            key={m.id}
                          >
                            <div>
                              <strong>
                                {m.kind === 'internal' ? (
                                  <>
                                    <LockKeyhole size={14} />
                                    Private internal note
                                  </>
                                ) : m.kind === 'support' ? (
                                  'Platform support'
                                ) : m.own ? (
                                  'You'
                                ) : (
                                  'Requester'
                                )}
                              </strong>
                              <time dateTime={m.createdAt}>
                                {time(m.createdAt)}
                              </time>
                            </div>
                            <p>{m.body}</p>
                            {m.attachments.map((a) => (
                              <a
                                key={a.id}
                                onClick={(e) => {
                                  e.preventDefault()
                                  void downloadSupportScreenshot(
                                    staff,
                                    a.id,
                                  ).catch(showError)
                                }}
                                href={`/api/support?view=${staff ? 'staff' : 'customer'}&attachment=${a.id}`}
                              >
                                <Paperclip size={14} />
                                Download screenshot (
                                {Math.ceil(a.byteSize / 1024)} KB)
                              </a>
                            ))}
                          </li>
                        ))}
                      </ol>
                      {detail.aiConversation && (
                        <details className="support-helper">
                          <summary>
                            Attached AI conversation & diagnostics
                          </summary>
                          <SupportTranscript
                            messages={detail.aiConversation.messages}
                            requesterLabel={staff ? 'Requester' : 'You'}
                          />
                          {!!detail.aiConversation.diagnostics && (
                            <pre className="ai-diagnostics">
                              {JSON.stringify(
                                detail.aiConversation.diagnostics,
                                null,
                                2,
                              )}
                            </pre>
                          )}
                          <p>
                            Attachment expires{' '}
                            {time(detail.aiConversation.expires_at)}. The
                            requester can delete it sooner. Ticket summaries and
                            replies remain.
                          </p>
                        </details>
                      )}
                      {staff && (
                        <SupportAiSuggestion
                          key={detail.ticket.id}
                          ticketId={detail.ticket.id}
                          consent={
                            !!detail.aiConversation ||
                            detail.ticket.diagnostics?.aiReviewConsent ===
                              'true'
                          }
                          onDraft={(text) => {
                            setReply(text)
                            setInternal(false)
                          }}
                        />
                      )}
                      <form onSubmit={sendReply} aria-label="Ticket reply">
                        {staff && (
                          <label className="support-note-choice">
                            <input
                              type="checkbox"
                              checked={internal}
                              onChange={(e) => setInternal(e.target.checked)}
                            />
                            Private internal note — never visible to the
                            requester
                          </label>
                        )}
                        <label className="support-field">
                          {internal
                            ? 'Private note'
                            : 'Reply in Cottage Pantry'}
                          <textarea
                            required
                            maxLength={6000}
                            rows={4}
                            value={reply}
                            onChange={(e) => setReply(e.target.value)}
                          />
                        </label>
                        <p className="support-fine">
                          Do not include passwords, API keys or payment-card
                          details.
                        </p>
                        <ScreenshotInput key={replyKey} onFile={setReplyFile} />
                        <button className="public-button" disabled={busy}>
                          {busy
                            ? 'Saving…'
                            : internal
                              ? 'Save private note'
                              : staff
                                ? 'Send customer-visible reply'
                                : 'Send reply'}
                        </button>
                      </form>
                      {staff && (
                        <details className="support-delivery">
                          <summary>Notification delivery · internal</summary>
                          <p>
                            Queued or accepted does not mean delivered. Email
                            remains off until approved and configured. Private
                            notes never generate customer email.
                          </p>
                          <ul>
                            {detail.notifications?.map((n) => (
                              <li key={n.id}>
                                {n.kind}: <strong>{n.status}</strong> ·{' '}
                                {n.attempts}/3 attempts
                                {n.errorCode ? ` · ${n.errorCode}` : ''}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  ) : (
                    <div className="support-empty">
                      <MessageCircle size={35} />
                      <h2>
                        {staff
                          ? 'Choose a conversation'
                          : 'A little help when you need it'}
                      </h2>
                      <p>
                        {staff
                          ? 'Open a ticket to reply, change status or add a private note.'
                          : 'Create a ticket or open one from your list. Email replies do not update tickets; continue the conversation here.'}
                      </p>
                      {!staff && (
                        <button
                          className="public-button"
                          onClick={() => setCompose(true)}
                        >
                          Get help
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </SupportFrame>
  )
}
function SupportNotificationSettings() {
  type NotificationSettings = {
    recipient: string
    pendingRecipient: string
    recipientVerified: boolean
    fromAddress: string
    replyTo: string
    enabled: boolean
    version: number
    verifiedIdentityEmail: string
    deliveryBlock: string | null
    senderApproved: boolean
    candidate?: string
  }
  const [settings, setSettings] = useState<NotificationSettings | null>(null),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmation, setConfirmation] = useState('')
  useEffect(() => {
    supportRequest('?view=staff&settings=1')
      .then((v) => setSettings(v.settings))
      .catch((e) => setError(e.message))
  }, [])
  function change(key: keyof NotificationSettings, value: string | boolean) {
    if (!settings) return
    setSettings({
      ...settings,
      [key]: value,
      ...(key === 'candidate' ? { enabled: false } : {}),
    })
    setSaved('')
  }
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!settings) return
    setBusy(true)
    setError('')
    try {
      const v = await supportPost(true, 'saveSettings', {
        recipient:
          settings.candidate ??
          (settings.pendingRecipient || settings.recipient),
        fromAddress: settings.fromAddress,
        replyTo: settings.replyTo,
        enabled: settings.enabled,
        version: settings.version,
      })
      setSettings(v.settings)
      setSaved('Settings saved. No test email was sent.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function confirm() {
    if (!settings) return
    setBusy(true)
    setError('')
    try {
      const v = await supportPost(true, 'confirmRecipient', {
        version: settings.version,
        confirmation,
      })
      setSettings(v.settings)
      setConfirmation('')
      setSaved(
        'Recipient confirmed against your verified Identity account. Sending stays paused.',
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="support-panel support-settings">
      <h2>Platform notification settings</h2>
      <p>
        This is a platform setting, separate from business roles and plans. No
        personal mailbox is connected or imported.
      </p>
      {error && (
        <p role="alert" className="support-alert">
          {error}
        </p>
      )}
      {saved && <p role="status">{saved}</p>}
      {settings && (
        <>
          <p className="support-alert">
            {settings.deliveryBlock ||
              'Configured, not delivery-tested. Provider acceptance is tracked separately from delivery.'}
          </p>
          <form onSubmit={save}>
            <label className="support-field">
              Support notification recipient
              <input
                type="email"
                maxLength={254}
                value={
                  settings.candidate ??
                  (settings.pendingRecipient || settings.recipient)
                }
                onChange={(e) => change('candidate', e.target.value)}
              />
            </label>
            <label className="support-field">
              Verified application sending address
              <input
                type="email"
                value={settings.fromAddress}
                onChange={(e) => change('fromAddress', e.target.value)}
              />
              <small>
                Must match the provider-verified sender approved in server
                configuration. Customer addresses are never used as From.
              </small>
            </label>
            <label className="support-field">
              Reply-to address
              <input
                type="email"
                value={settings.replyTo}
                onChange={(e) => change('replyTo', e.target.value)}
              />
            </label>
            <label className="support-note-choice">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => change('enabled', e.target.checked)}
              />
              Enable approved production notifications
            </label>
            <p>
              Server approval is also required. Previews and tests cannot send.
              Notifications say “Reply in Cottage Pantry”; inbound email ticket
              creation and replies are not implemented.
            </p>
            <button className="public-button" disabled={busy}>
              Save notification settings
            </button>
          </form>
          {settings.pendingRecipient && (
            <div className="support-confirm">
              <h3>Confirm changed recipient</h3>
              <p>
                The pending address is not active. Sign in as a platform
                administrator whose verified Identity email matches it. Other
                mailbox verification requires a later approved email flow.
              </p>
              <label className="support-field">
                Type the pending recipient email
                <input
                  type="email"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              <button
                className="support-button"
                disabled={busy || !confirmation}
                onClick={() => void confirm()}
              >
                Confirm this verified email
              </button>
            </div>
          )}
          <p className="support-fine">
            Optional Postmark transport: no service is activated here.
            Provider/domain setup, account pricing and live delivery tests
            require owner approval. No full ticket messages are included in
            notifications.
          </p>
        </>
      )}
    </section>
  )
}
