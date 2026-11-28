import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  ArrowLeft,
  ArrowUp,
  Bell,
  ChevronRight,
  ClipboardList,
  MessageCircle,
  Plus,
  Search,
} from 'lucide-react'
import {
  boardCategories,
  boardStatuses,
  type BoardCategory,
  type BoardCommand,
  type BoardDetail,
  type BoardListing,
  type BoardRequest,
  type BoardStatus,
} from '@/lib/feature-requests'
import './feature-board.css'

const endpoint = '/api/feature-requests'
type Change = (command: BoardCommand) => Promise<boolean>
type FetchBoard = (
  params?: URLSearchParams,
  options?: RequestInit,
) => Promise<Response>
const field = (form: FormData, key: string) => String(form.get(key) ?? '')
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date))

async function fetchJson<Result>(response: Response): Promise<Result> {
  const result = await response.json().catch(() => null)
  if (!response.ok || !result)
    throw new Error(result?.error || 'The board could not load. Try again.')
  return result
}

function formAction(handler: (data: FormData) => void | Promise<void>) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handler(new FormData(event.currentTarget))
  }
}

function CategorySelect({ value }: { value?: BoardCategory }) {
  return (
    <label>
      Category{' '}
      <select name="category" defaultValue={value || 'Other'}>
        {boardCategories.map((category) => (
          <option key={category}>{category}</option>
        ))}
      </select>
    </label>
  )
}

function AliasInput({ value = '' }: { value?: string }) {
  const [show, setShow] = useState(!!value)
  return (
    <>
      <label className="board-check">
        <input
          type="checkbox"
          checked={show}
          onChange={(event) => setShow(event.target.checked)}
        />{' '}
        Show my nickname (otherwise Anonymous baker)
      </label>
      {show && (
        <label>
          Public nickname{' '}
          <input
            name="displayName"
            maxLength={32}
            defaultValue={value}
            required
          />
        </label>
      )}
    </>
  )
}

function subscribeLocation(update: () => void) {
  window.addEventListener('hashchange', update)
  window.addEventListener('popstate', update)
  return () => {
    window.removeEventListener('hashchange', update)
    window.removeEventListener('popstate', update)
  }
}
const browserLocation = () =>
  window.location.search + '\n' + window.location.hash
const serverLocation = () => ''

export function FeatureBoard() {
  const locationKey = useSyncExternalStore(
    subscribeLocation,
    browserLocation,
    serverLocation,
  )
  const [query, hash] = locationKey.split('\n')
  const moderator = new URLSearchParams(query).get('admin') === '1'
  const mode = locationKey ? (moderator ? 'moderator' : 'customer') : undefined
  const id = hash?.slice(1) ?? ''
  const [board, setBoard] = useState<BoardListing>()
  const [detail, setDetail] = useState<{
    id: string
    data?: BoardDetail
    error?: string
  }>()
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatus] = useState<string>()
  const status = statusFilter ?? (moderator ? 'New' : '')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState('top')
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const focusedDetail = useRef('')

  const request: FetchBoard = useCallback(
    (params = new URLSearchParams(), options = {}) =>
      boardFetch(moderator, params, options),
    [moderator],
  )
  useEffect(() => {
    if (!mode) return
    const controller = new AbortController()
    const timer = setTimeout(
      async () => {
        try {
          const params = new URLSearchParams({
            q: search,
            status,
            category,
            sort,
            page: String(page),
          })
          const result = await fetchJson<BoardListing>(
            await boardFetch(moderator, params, { signal: controller.signal }),
          )
          if (!controller.signal.aborted) {
            setBoard(result)
            setError('')
          }
        } catch (cause) {
          if (!controller.signal.aborted) setError((cause as Error).message)
        }
      },
      search ? 200 : 0,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [mode, moderator, search, status, category, sort, page, refresh])

  useEffect(() => {
    if (!mode || !id) return
    const controller = new AbortController()
    boardFetch(moderator, new URLSearchParams({ id }), {
      signal: controller.signal,
    })
      .then(fetchJson<BoardDetail>)
      .then((result) => {
        if (!controller.signal.aborted) setDetail({ id, data: result })
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setDetail({ id, error: (cause as Error).message })
      })
    return () => controller.abort()
  }, [mode, moderator, id, refresh])

  const change: Change = async (command) => {
    if (busy) return false
    setBusy(true)
    setNotice('')
    setActionError('')
    try {
      const result = await fetchJson<{ id?: string }>(
        await request(undefined, {
          method: 'POST',
          body: JSON.stringify(command),
        }),
      )
      setRefresh((count) => count + 1)
      if (command.action === 'submit' || command.action === 'merge') {
        if (result.id) location.hash = result.id
        if (command.action === 'submit') setShowForm(false)
      }
      if (command.action === 'withdraw') location.hash = ''
      setNotice(
        command.action === 'anonymize'
          ? 'Board account information anonymized.'
          : 'Changes saved.',
      )
      return true
    } catch (cause) {
      setActionError((cause as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  function reportDownloadError(cause: unknown) {
    setActionError((cause as Error).message)
  }
  async function download(params: URLSearchParams, filename: string) {
    try {
      const response = await request(params)
      if (!response.ok) await fetchJson(response)
      const link = document.createElement('a')
      link.href = URL.createObjectURL(await response.blob())
      link.download = filename
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    } catch (cause) {
      reportDownloadError(cause)
    }
  }

  const active = detail?.id === id ? detail.data : undefined
  const detailError = detail?.id === id ? detail.error : undefined
  useEffect(() => {
    if (!id) focusedDetail.current = ''
    if (id && active && focusedDetail.current !== id) {
      detailHeading.current?.focus()
      focusedDetail.current = id
    }
  }, [active, id])
  return (
    <main className="feature-board">
      <a className="board-back" href={moderator ? '/admin' : '/oven#Settings'}>
        <ArrowLeft size={17} />{' '}
        {moderator ? 'Administration' : 'Back to My Oven'}
      </a>
      <header className="board-hero">
        <div>
          <p className="board-eyebrow">
            Cottage Pantry /{' '}
            {moderator ? 'Platform administration' : 'Community board'}
          </p>
          <h1>Feature requests</h1>
          <p>
            {moderator
              ? 'Review new requests, publish status updates, and keep the shared board tidy.'
              : 'Tell us what would make your work easier. Vote for ideas you’d use and follow their progress.'}
          </p>
        </div>
        {board &&
          !error &&
          (moderator ? (
            <button
              type="button"
              className="board-primary"
              onClick={() =>
                void download(
                  new URLSearchParams({ export: '1' }),
                  'feature-requests.csv',
                )
              }
            >
              Export CSV
            </button>
          ) : (
            <button
              type="button"
              className="board-primary"
              aria-expanded={showForm}
              aria-controls="board-submission"
              onClick={() => setShowForm((value) => !value)}
            >
              <Plus size={18} /> {showForm ? 'Close form' : 'Suggest an idea'}
            </button>
          ))}
      </header>
      {error ? (
        <p className="board-error" role="alert">
          {error} {mode === 'customer' && <a href="/login">Sign in</a>}
        </p>
      ) : !board ? (
        <p role="status">Loading feature requests…</p>
      ) : (
        <>
          <div className="board-feedback" aria-live="polite">
            {notice}
          </div>
          {actionError && (
            <p className="board-error" role="alert">
              {actionError}
            </p>
          )}
          <fieldset disabled={busy} className="board-grid">
            <div className="board-main">
              {showForm && !moderator && (
                <Submission change={change} request={request} />
              )}
              {id && (
                <section
                  className="board-panel"
                  aria-label="Request details"
                  key={id}
                >
                  <a href="#" className="board-back">
                    <ArrowLeft size={16} /> All requests
                  </a>
                  {detailError ? (
                    <p role="alert">{detailError}</p>
                  ) : active ? (
                    <RequestDetail
                      detail={active}
                      change={change}
                      moderator={moderator}
                      headingRef={detailHeading}
                      downloadImage={() =>
                        void download(
                          new URLSearchParams({ image: active.request.id }),
                          'request-screenshot.webp',
                        )
                      }
                    />
                  ) : (
                    <p role="status">Loading request…</p>
                  )}
                </section>
              )}
              <section aria-label="Browse feature requests">
                <div className="board-panel board-filters">
                  <label className="board-search">
                    Search requests{' '}
                    <span>
                      <Search size={17} />
                      <input
                        type="search"
                        value={search}
                        placeholder="Try ‘labels’ or ‘stock counts’"
                        onChange={(event) => {
                          setSearch(event.target.value)
                          setPage(1)
                        }}
                      />
                    </span>
                  </label>
                  <label>
                    Status{' '}
                    <select
                      value={status}
                      onChange={(event) => {
                        setStatus(event.target.value)
                        setPage(1)
                      }}
                    >
                      <option value="">All statuses</option>
                      {boardStatuses.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Category{' '}
                    <select
                      value={category}
                      onChange={(event) => {
                        setCategory(event.target.value)
                        setPage(1)
                      }}
                    >
                      <option value="">All categories</option>
                      {boardCategories.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Sort{' '}
                    <select
                      value={sort}
                      onChange={(event) => {
                        setSort(event.target.value)
                        setPage(1)
                      }}
                    >
                      <option value="top">Top</option>
                      <option value="newest">Newest</option>
                      {!moderator && <option value="mine">Mine</option>}
                    </select>
                  </label>
                </div>
                <div className="board-list-heading">
                  <h2>
                    {status === 'New' && moderator
                      ? 'Review queue'
                      : 'Ideas from the pantry'}
                  </h2>
                  <span>{board.requests.length} on this page</span>
                </div>
                {!board.requests.length && (
                  <p className="board-panel">
                    No requests match these filters.
                  </p>
                )}
                <ul className="board-list">
                  {board.requests.map((row) => (
                    <li className="board-panel board-card" key={row.id}>
                      {!moderator ? (
                        <button
                          type="button"
                          className="board-vote"
                          aria-pressed={row.voted}
                          aria-label={`Vote for ${row.title}`}
                          onClick={() =>
                            void change({
                              action: 'vote',
                              id: row.id,
                              enabled: !row.voted,
                            })
                          }
                        >
                          <ArrowUp size={17} />
                          {row.votes}
                        </button>
                      ) : (
                        <span className="board-vote">
                          <ArrowUp size={17} />
                          {row.votes}
                        </span>
                      )}
                      <div>
                        <p className="board-card-meta">
                          <span
                            className="board-status"
                            data-status={row.status}
                          >
                            {row.status}
                          </span>
                          <span>{row.category}</span>
                          {row.hidden && <span>Hidden</span>}
                        </p>
                        <h3>
                          <a href={'#' + row.id}>{row.title}</a>
                        </h3>
                        <p className="board-snippet">{row.useCase}</p>
                        <p className="board-byline">
                          {row.displayName} · {dateLabel(row.createdAt)}
                        </p>
                      </div>
                      <ChevronRight
                        size={19}
                        className="board-chevron"
                        aria-hidden
                      />
                    </li>
                  ))}
                </ul>
                <div className="board-pagination">
                  {page > 1 && (
                    <button
                      type="button"
                      onClick={() => setPage((value) => value - 1)}
                    >
                      Previous
                    </button>
                  )}
                  {board.hasMore && (
                    <button
                      type="button"
                      onClick={() => setPage((value) => value + 1)}
                    >
                      Next
                    </button>
                  )}
                </div>
              </section>
            </div>
            <aside className="board-rail">
              {moderator ? (
                <ModeratorRail board={board} change={change} />
              ) : (
                <>
                  <section className="board-panel">
                    <ClipboardList size={22} />
                    <h2>A shared space</h2>
                    <p>
                      Requests and comments are visible to all signed-in users.
                      Keep customer information and private recipes out of posts
                      and screenshots.
                    </p>
                    {board.voteLimit !== null && (
                      <p>Vote for up to {board.voteLimit} active requests.</p>
                    )}
                  </section>
                  <section className="board-panel">
                    <Bell size={22} />
                    <h2>Updates</h2>
                    <p>
                      Get an in-app update when an idea you vote for or follow
                      changes status.
                    </p>
                    <label className="board-check">
                      <input
                        type="checkbox"
                        checked={board.notifications}
                        onChange={(event) =>
                          void change({
                            action: 'preferences',
                            notifications: event.target.checked,
                          })
                        }
                      />{' '}
                      Notify me here
                    </label>
                    {board.inbox.length > 0 && (
                      <ul className="board-updates">
                        {board.inbox.map((item) => (
                          <li key={item.id}>
                            <a href={'#' + item.requestId}>
                              {item.title}: {item.status}
                            </a>{' '}
                            <button
                              type="button"
                              onClick={() =>
                                void change({
                                  action: 'read',
                                  eventId: item.id,
                                })
                              }
                            >
                              Mark as read
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              )}
            </aside>
          </fieldset>
        </>
      )}
    </main>
  )
}

function boardFetch(
  moderator: boolean,
  params: URLSearchParams,
  options: RequestInit = {},
) {
  const query = new URLSearchParams(params)
  if (moderator) query.set('admin', '1')
  const headers = new Headers(options.headers)
  if (moderator) headers.set('x-cp-admin', '1')
  if (options.body) headers.set('Content-Type', 'application/json')
  return fetch(`${endpoint}?${query}`, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  })
}

function Submission({
  change,
  request,
}: {
  change: Change
  request: FetchBoard
}) {
  const [title, setTitle] = useState('')
  const [suggestions, setSuggestions] = useState<BoardRequest[]>([])
  const [fileError, setFileError] = useState('')
  useEffect(() => {
    if (title.trim().length < 3) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      request(new URLSearchParams({ q: title, sort: 'top' }), {
        signal: controller.signal,
      })
        .then(fetchJson<BoardListing>)
        .then((data) => {
          if (!controller.signal.aborted)
            setSuggestions(data.requests.slice(0, 3))
        })
        .catch(() => undefined)
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [title, request])
  return (
    <section className="board-panel" id="board-submission">
      <h2>Suggest an idea</h2>
      <p>
        This is visible to all users. Don’t include customer names, recipes you
        want private, or personal information.
      </p>
      <form
        className="board-form"
        onSubmit={formAction(async (data) => {
          setFileError('')
          const file = data.get('image')
          let image: string | undefined
          try {
            if (file instanceof File && file.size) {
              if (file.size > 2 * 1024 * 1024)
                throw new Error('Choose a screenshot under 2 MB.')
              image = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(String(reader.result))
                reader.onerror = () =>
                  reject(new Error('The screenshot could not be read.'))
                reader.readAsDataURL(file)
              })
            }
          } catch (cause) {
            setFileError((cause as Error).message)
            return
          }
          await change({
            action: 'submit',
            title,
            useCase: field(data, 'useCase'),
            category: field(data, 'category') as BoardCategory,
            displayName: field(data, 'displayName'),
            image,
          })
        })}
      >
        <label>
          Title{' '}
          <input
            required
            minLength={5}
            maxLength={100}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              setSuggestions([])
            }}
          />
        </label>
        {suggestions.length > 0 && (
          <div className="board-suggestions">
            <strong>Similar requests</strong>
            <ul>
              {suggestions.map((item) => (
                <li key={item.id}>
                  <a href={'#' + item.id}>{item.title}</a>{' '}
                  <button
                    type="button"
                    disabled={item.voted}
                    onClick={async () => {
                      if (
                        await change({
                          action: 'vote',
                          id: item.id,
                          enabled: true,
                        })
                      )
                        setSuggestions((previous) =>
                          previous.map((row) =>
                            row.id === item.id ? { ...row, voted: true } : row,
                          ),
                        )
                    }}
                  >
                    {item.voted ? 'Voted' : 'Vote for this instead'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <label>
          What are you trying to do?{' '}
          <textarea
            name="useCase"
            required
            minLength={12}
            maxLength={2000}
            rows={4}
          />
        </label>
        <CategorySelect />
        <AliasInput />
        <label>
          Screenshot (optional){' '}
          <input
            type="file"
            name="image"
            accept="image/png,image/jpeg,image/webp"
          />
          <small>
            Public to all signed-in users. Check the entire image for private
            data. PNG, JPEG or WebP, up to 2 MB.
          </small>
        </label>
        {fileError && (
          <p role="alert" className="board-error">
            {fileError}
          </p>
        )}
        <button className="board-primary" type="submit">
          Submit request
        </button>
      </form>
    </section>
  )
}

function ReasonAction({
  children,
  title,
  action,
}: {
  children?: ReactNode
  title: string
  action: (reason: string) => Promise<boolean>
}) {
  return (
    <details className="board-disclosure">
      <summary>{title}</summary>
      <form
        className="board-form"
        onSubmit={(event) => {
          const form = event.currentTarget
          formAction(async (data) => {
            if (await action(field(data, 'reason'))) form.reset()
          })(event)
        }}
      >
        {children}
        <label>
          Reason <input name="reason" minLength={3} maxLength={500} required />
        </label>
        <button type="submit">{title}</button>
      </form>
    </details>
  )
}

function RequestDetail({
  detail,
  change,
  moderator,
  headingRef,
  downloadImage,
}: {
  detail: BoardDetail
  change: Change
  moderator: boolean
  headingRef: React.Ref<HTMLHeadingElement>
  downloadImage: () => void
}) {
  const row = detail.request
  const id = row.id
  const [withdraw, setWithdraw] = useState(false)
  return (
    <div className="board-request-detail">
      {detail.redirected && (
        <p className="board-suggestions">
          This request was merged. Showing the primary request.
        </p>
      )}
      <p className="board-card-meta">
        <span className="board-status" data-status={row.status}>
          {row.status}
        </span>
        <span>{row.category}</span>
        {row.hidden && <span>Hidden</span>}
      </p>
      <h2 tabIndex={-1} ref={headingRef}>
        {row.title}
      </h2>
      <p className="board-full-text">{row.useCase}</p>
      {moderator && (
        <p className="board-byline">
          Request ID: <code>{id}</code>
        </p>
      )}
      <p className="board-byline">
        {row.displayName} · {dateLabel(row.createdAt)}
        {row.tags.length > 0 && ` · ${row.tags.join(' · ')}`}
      </p>
      {row.releaseUrl && (
        <p>
          <a href={row.releaseUrl} rel="noreferrer">
            Release notes
          </a>
        </p>
      )}
      {row.hasImage &&
        (moderator ? (
          <button type="button" onClick={downloadImage}>
            Download screenshot
          </button>
        ) : (
          <a href={`${endpoint}?image=${id}`} target="_blank" rel="noreferrer">
            View public screenshot (opens in a new tab)
          </a>
        ))}
      {moderator ? (
        <ModeratorTools row={row} change={change} />
      ) : (
        <>
          <div className="board-actions">
            <button
              type="button"
              aria-pressed={row.voted}
              onClick={() =>
                void change({ action: 'vote', id, enabled: !row.voted })
              }
            >
              <ArrowUp size={17} /> {row.voted ? 'Voted' : 'Vote'} · {row.votes}
            </button>
            <button
              type="button"
              aria-pressed={row.following}
              onClick={() =>
                void change({ action: 'follow', id, enabled: !row.following })
              }
            >
              <Bell size={17} /> {row.following ? 'Following' : 'Follow'}
            </button>
          </div>
          <ReasonAction
            title="Report request"
            action={(reason) => change({ action: 'report', id, reason })}
          />
          {row.editable && (
            <details className="board-disclosure">
              <summary>Edit or withdraw your request</summary>
              <form
                className="board-form"
                onSubmit={formAction(async (data) => {
                  await change({
                    action: 'edit',
                    id,
                    title: field(data, 'title'),
                    useCase: field(data, 'useCase'),
                    category: field(data, 'category') as BoardCategory,
                    displayName: field(data, 'displayName'),
                  })
                })}
              >
                <label>
                  Title{' '}
                  <input
                    name="title"
                    required
                    minLength={5}
                    maxLength={100}
                    defaultValue={row.title}
                  />
                </label>
                <label>
                  What are you trying to do?{' '}
                  <textarea
                    name="useCase"
                    required
                    minLength={12}
                    maxLength={2000}
                    defaultValue={row.useCase}
                  />
                </label>
                <CategorySelect value={row.category} />
                <AliasInput
                  value={
                    row.displayName === 'Anonymous baker' ? '' : row.displayName
                  }
                />
                <button type="submit">Save changes</button>
              </form>
              {!withdraw ? (
                <button type="button" onClick={() => setWithdraw(true)}>
                  Withdraw request…
                </button>
              ) : (
                <div className="board-actions">
                  <button
                    type="button"
                    onClick={() => void change({ action: 'withdraw', id })}
                  >
                    Confirm withdrawal
                  </button>
                  <button type="button" onClick={() => setWithdraw(false)}>
                    Cancel
                  </button>
                </div>
              )}
            </details>
          )}
        </>
      )}
      <h3>Status history</h3>
      <ol className="board-updates">
        {detail.history.map((event) => (
          <li key={event.id}>
            <strong>{event.status}</strong> · {dateLabel(event.createdAt)}
            {event.note && <p className="board-full-text">{event.note}</p>}
          </li>
        ))}
      </ol>
      <h3>
        <MessageCircle size={17} /> Comments
      </h3>
      {detail.comments.length === 0 && <p>No comments yet.</p>}
      <ul className="board-updates">
        {detail.comments.map((comment) => (
          <li key={comment.id}>
            <strong>{comment.displayName}</strong> ·{' '}
            {dateLabel(comment.createdAt)} {comment.hidden && '· Hidden'}
            {moderator && (
              <p className="board-byline">
                Comment ID: <code>{comment.id}</code>
              </p>
            )}
            <p className="board-full-text">{comment.body}</p>
            {!comment.hidden && (
              <ReasonAction
                title={moderator ? 'Hide comment' : 'Report comment'}
                action={(reason) =>
                  change({
                    action: moderator ? 'hide' : 'report',
                    id,
                    commentId: comment.id,
                    reason,
                  })
                }
              />
            )}
          </li>
        ))}
      </ul>
      {!moderator && (
        <form
          className="board-form"
          onSubmit={(event) => {
            const form = event.currentTarget
            formAction(async (data) => {
              if (
                await change({
                  action: 'comment',
                  id,
                  body: field(data, 'body'),
                  displayName: field(data, 'displayName'),
                })
              )
                form.reset()
            })(event)
          }}
        >
          <label>
            Add a public comment{' '}
            <textarea
              name="body"
              required
              minLength={3}
              maxLength={1000}
              rows={3}
            />
          </label>
          <AliasInput />
          <button type="submit">Post comment</button>
        </form>
      )}
    </div>
  )
}

function ModeratorTools({
  row,
  change,
}: {
  row: BoardRequest
  change: Change
}) {
  const id = row.id
  const [nextStatus, setNextStatus] = useState(row.status)
  return (
    <details className="board-disclosure" open>
      <summary>Triage this request</summary>
      {!row.hidden && (
        <form
          className="board-form"
          onSubmit={formAction(async (data) => {
            await change({
              action: 'status',
              id,
              status: nextStatus,
              note: field(data, 'note'),
            })
          })}
        >
          <label>
            Status{' '}
            <select
              value={nextStatus}
              onChange={(event) =>
                setNextStatus(event.target.value as BoardStatus)
              }
            >
              {boardStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <label>
            {nextStatus === 'Not planned'
              ? 'Public reason (required)'
              : 'Public note (optional)'}{' '}
            <textarea
              name="note"
              required={nextStatus === 'Not planned'}
              maxLength={500}
            />
          </label>
          <button type="submit">Publish status</button>
        </form>
      )}
      <form
        className="board-form"
        onSubmit={formAction(async (data) => {
          await change({
            action: 'triage',
            id,
            title: field(data, 'title'),
            category: field(data, 'category') as BoardCategory,
            tags: field(data, 'tags')
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
            releaseUrl: field(data, 'releaseUrl'),
          })
        })}
      >
        <label>
          Title{' '}
          <input
            name="title"
            required
            minLength={5}
            maxLength={100}
            defaultValue={row.title}
          />
        </label>
        <CategorySelect value={row.category} />
        <label>
          Tags (comma-separated){' '}
          <input
            name="tags"
            maxLength={150}
            defaultValue={row.tags.join(', ')}
          />
        </label>
        <label>
          Release-note URL{' '}
          <input
            type="url"
            name="releaseUrl"
            defaultValue={row.releaseUrl || ''}
          />
        </label>
        <button type="submit">Save triage details</button>
      </form>
      {!row.hidden && (
        <>
          <ReasonAction
            title="Hide request"
            action={(reason) => change({ action: 'hide', id, reason })}
          />
          <form
            className="board-form"
            onSubmit={formAction(async (data) => {
              await change({
                action: 'merge',
                id,
                targetId: field(data, 'targetId'),
              })
            })}
          >
            <label>
              Primary request ID{' '}
              <input
                name="targetId"
                required
                placeholder="Copy the ID from the primary request URL"
              />
            </label>
            <label className="board-check">
              <input type="checkbox" required /> I reviewed both requests and
              want this one to redirect to the primary.
            </label>
            <button type="submit">Merge duplicate</button>
          </form>
        </>
      )}
    </details>
  )
}

function ModeratorRail({
  board,
  change,
}: {
  board: BoardListing
  change: Change
}) {
  return (
    <>
      <section className="board-panel">
        <h2>Moderation reports</h2>
        {!board.reports?.length && <p>No unresolved reports.</p>}
        <ul className="board-updates">
          {board.reports?.map((item) => (
            <li key={item.id}>
              <a href={'#' + item.requestId}>{item.title}</a>
              <p className="board-full-text">
                {item.commentId ? 'Comment: ' : ''}
                {item.reason}
              </p>
              <ReasonAction
                title="Close report"
                action={(reason) =>
                  change({ action: 'reviewReport', id: item.id, reason })
                }
              />
            </li>
          ))}
        </ul>
      </section>
      <section className="board-panel">
        <h2>Board settings</h2>
        <form
          className="board-form"
          onSubmit={formAction(async (data) => {
            const limit = field(data, 'limit')
            await change({
              action: 'voteLimit',
              limit: limit ? Number(limit) : null,
            })
          })}
        >
          <label>
            Votes per person{' '}
            <input
              name="limit"
              type="number"
              min={1}
              max={1000}
              defaultValue={board.voteLimit ?? ''}
              placeholder="Unlimited"
            />
          </label>
          <button type="submit">Save vote limit</button>
        </form>
      </section>
      <section className="board-panel">
        <h2>Account deletion</h2>
        <AnonymizeBoard change={change} />
      </section>
    </>
  )
}

function AnonymizeBoard({ change }: { change: Change }) {
  const [replacements, setReplacements] = useState<
    { key: number; kind: 'request' | 'comment' }[]
  >([])
  const next = useRef(1)
  return (
    <details className="board-disclosure">
      <summary>Anonymize board activity</summary>
      <p>
        Complete verified account deletion first. Board records and aggregate
        votes stay. Names, original text, screenshots and account links are
        removed. Supply reviewed replacements only after removing personal
        information.
      </p>
      <form
        className="board-form"
        onSubmit={(event) => {
          const form = event.currentTarget
          formAction(async (data) => {
            if (field(data, 'confirmation') !== 'Verified account deletion')
              return
            const reviewed = replacements.map(({ key, kind }) => {
              const id = field(data, `id-${key}`)
              const body = field(data, `body-${key}`)
              return kind === 'request'
                ? { id, title: field(data, `title-${key}`), useCase: body }
                : { id, body }
            })
            if (
              await change({
                action: 'anonymize',
                subject: field(data, 'subject'),
                confirmation: 'Verified account deletion',
                reviewed,
              })
            ) {
              form.reset()
              setReplacements([])
            }
          })(event)
        }}
      >
        <label>
          Verified Identity ID <input name="subject" required maxLength={36} />
        </label>
        {replacements.map(({ key, kind }) => (
          <fieldset className="board-form board-replacement" key={key}>
            <legend>Reviewed {kind}</legend>
            <label>
              {kind === 'request' ? 'Request ID' : 'Comment ID'}{' '}
              <input name={`id-${key}`} required maxLength={36} />
            </label>
            {kind === 'request' && (
              <label>
                Redacted title{' '}
                <input
                  name={`title-${key}`}
                  required
                  minLength={5}
                  maxLength={100}
                />
              </label>
            )}
            <label>
              Redacted text{' '}
              <textarea
                name={`body-${key}`}
                required
                minLength={kind === 'request' ? 12 : 3}
                maxLength={kind === 'request' ? 2000 : 1000}
              />
            </label>
            <button
              type="button"
              onClick={() =>
                setReplacements((items) =>
                  items.filter((item) => item.key !== key),
                )
              }
            >
              Remove replacement
            </button>
          </fieldset>
        ))}
        <div className="board-actions">
          {(['request', 'comment'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={replacements.length >= 100}
              onClick={() => {
                const key = next.current++
                setReplacements((items) => [...items, { key, kind }])
              }}
            >
              Add redacted {kind}
            </button>
          ))}
        </div>
        <label>
          Type “Verified account deletion”{' '}
          <input
            name="confirmation"
            required
            pattern="Verified account deletion"
          />
        </label>
        <button type="submit">Anonymize and retain</button>
      </form>
    </details>
  )
}
