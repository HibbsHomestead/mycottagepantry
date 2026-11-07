import { AdminCatalog } from './admin-catalog'
import { AdminRegistrationPolicies } from './admin-registration-policies'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  CreditCard,
  LogIn,
  LayoutDashboard,
  LogOut,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  CircleCheck,
  LockKeyhole,
} from 'lucide-react'
import { systemLabelTemplates } from '@/lib/label-studio'
import { LabelCanvas } from './label-studio'
import type { AdminMetadata } from '@/lib/platform-admin-types'
import { AdminPasswordReset } from './admin-password-reset'
import { AdminSquareConnection } from './admin-square-connection'
import './admin-portal.css'

const sections = [
  ['overview', 'Overview', LayoutDashboard],
  ['customers', 'Customers', Users],
  ['plans', 'Plans & Access', SlidersHorizontal],
  ['billing', 'Billing', CreditCard],
  ['operations', 'Operations', Activity],
  ['content', 'Content', BookOpen],
  ['audit', 'Audit & Settings', ShieldCheck],
] as const
type AdminSession = {
  stage: string
  identityId?: string
  identityEmail?: string
  role?: string
  expiresAt?: string
}
class PortalError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
  }
}
export async function adminRequest(query: string, body?: unknown) {
  const response = await fetch('/api/admin' + (query ? '?' + query : ''), {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'x-cp-admin': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw new PortalError(
      data?.error ||
        'Administration is unavailable. Retry when the connection is restored.',
      response.status,
      data?.code,
    )
  return data
}
const date = (value: unknown) =>
  value && Number.isFinite(Date.parse(String(value)))
    ? new Date(String(value)).toLocaleString()
    : 'Not recorded'
const label = (value: unknown) =>
  value == null || value === ''
    ? 'Not recorded'
    : String(value).replaceAll('_', ' ')
function href(section: string, values: Record<string, string> = {}) {
  return '/admin?' + new URLSearchParams({ section, ...values }).toString()
}
function Badge({ children }: { children: ReactNode }) {
  return <span className="admin-badge">{children}</span>
}
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="admin-notice">
      <ShieldCheck size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="admin-empty">{children}</p>
}
type Column = { title: string; cell: (row: AdminMetadata) => ReactNode }
function DataTable({
  rows,
  columns,
  empty = 'No records match this view.',
}: {
  rows: AdminMetadata[]
  columns: Column[]
  empty?: string
}) {
  if (!rows.length) return <Empty>{empty}</Empty>
  return (
    <div className="admin-table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.title} scope="col">
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || r.business_id || r.identity_id || i}>
              {columns.map((c) => (
                <td key={c.title}>{c.cell(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
const identityCell = (id: string) => <code className="admin-id">{id}</code>
function Pager({
  data,
  section,
  query,
}: {
  data: AdminMetadata
  section: string
  query: Record<string, string>
}) {
  const page = Number(data.page || 1),
    total = Number(data.total || 0)
  return (
    <div className="admin-pager">
      <span>
        {total.toLocaleString()} records · Page {page} of{' '}
        {Math.max(1, Math.ceil(total / data.pageSize))}
      </span>
      <div>
        {page > 1 && (
          <a href={href(section, { ...query, page: String(page - 1) })}>
            Previous
          </a>
        )}
        {page * data.pageSize < total && (
          <a href={href(section, { ...query, page: String(page + 1) })}>
            Next page →
          </a>
        )}
      </div>
    </div>
  )
}
function ActivityTable({
  rows,
  detailed = false,
}: {
  rows: AdminMetadata[]
  detailed?: boolean
}) {
  return (
    <DataTable
      rows={rows}
      empty="No administrative activity has been recorded."
      columns={[
        {
          title: 'Action',
          cell: (r) => (
            <>
              <strong>{label(r.action)}</strong>
              <small>{label(r.outcome)}</small>
            </>
          ),
        },
        {
          title: 'Administrator',
          cell: (r) =>
            r.actor_id ? identityCell(r.actor_id) : 'Unauthenticated request',
        },
        {
          title: 'Target',
          cell: (r) => (r.target ? identityCell(r.target) : 'Platform'),
        },
        { title: 'Time', cell: (r) => date(r.created_at) },
        ...(detailed
          ? [
              {
                title: 'Change / request',
                cell: (r: AdminMetadata) => (
                  <>
                    <span>{r.reason || 'No reason required'}</span>
                    {r.before && (
                      <small>Before: {JSON.stringify(r.before)}</small>
                    )}
                    {r.after && <small>After: {JSON.stringify(r.after)}</small>}
                    {identityCell(r.request_id)}
                  </>
                ),
              },
            ]
          : []),
      ]}
    />
  )
}

export function AdminPortal() {
  const location = useRouterState({ select: (s) => s.location })
  const params = new URLSearchParams(location.searchStr)
  const section =
    sections.find((s) => s[0] === params.get('section'))?.[0] || 'overview'
  const title = sections.find((s) => s[0] === section)![1]
  const [session, setSession] = useState<AdminSession | null>(null)
  const [data, setData] = useState<AdminMetadata | null>(null)
  const [loadedQuery, setLoadedQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [recovering, setRecovering] = useState(false)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recoveryCallback, setRecoveryCallback] = useState(false)
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('')
  const [template, setTemplate] = useState(systemLabelTemplates[0].id)
  useEffect(() => {
    document.title = `${title} | Cottage Pantry Admin`
  }, [title])
  useEffect(() => {
    let active = true
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    if (fragment.has('recovery_token') || fragment.has('error')) {
      // Read the browser-only callback after hydration, before any API checks.
      queueMicrotask(() => {
        if (active) {
          setRecoveryCallback(true)
          setData(null)
        }
      })
      return () => {
        active = false
      }
    }
    if (recoveryCallback) return
    const check = () =>
      adminRequest('action=session')
        .then((value) => {
          if (active) setSession(value)
        })
        .catch((e) => {
          if (active) {
            setData(null)
            setSession({ stage: 'signed_out' })
            if (e.status !== 401) setError(e.message)
          }
        })
    void check()
    const timer = window.setInterval(check, 60000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [refresh, recoveryCallback])
  const query = new URLSearchParams({ section })
  for (const key of ['q', 'page', 'kind', 'id'])
    if (params.has(key)) query.set(key, params.get(key)!)
  const queryString = query.toString()
  useEffect(() => {
    let active = true
    if (recoveryCallback || session?.stage !== 'authenticated') return
    adminRequest(queryString)
      .then((value) => {
        if (active) {
          setData(value)
          setLoadedQuery(queryString)
          setError('')
        }
      })
      .catch((e) => {
        if (active) {
          setData(null)
          setError(e.message)
          if ([401, 403].includes(e.status)) setSession({ stage: 'signed_out' })
        }
      })
    return () => {
      active = false
    }
  }, [queryString, session?.stage, refresh, recoveryCallback])
  async function signIn(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await adminRequest('action=login', { email, password })
      setPassword('')
      setRefresh((r) => r + 1)
    } catch (e) {
      setError((e as Error).message)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }
  async function recoverPassword(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setRecoveryMessage('')
    try {
      const result = await adminRequest('action=password-recovery', { email })
      setRecoveryMessage(result.message)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function signOut() {
    setBusy(true)
    setError('')
    try {
      await adminRequest('action=logout', {})
      setData(null)
      setSession({ stage: 'signed_out' })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const authenticated = !recoveryCallback && session?.stage === 'authenticated'
  return (
    <div className="cp-admin">
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/admin">
          <span className="admin-brand-mark">
            <ShieldCheck size={23} />
          </span>
          <span>
            Cottage Pantry<strong>Admin</strong>
          </span>
        </a>
        <p className="admin-nav-label">PLATFORM CONTROL</p>
        <nav aria-label="Administration sections">
          {sections.map(([id, name, Icon]) => (
            <a
              href={href(id)}
              key={id}
              aria-current={section === id ? 'page' : undefined}
            >
              <Icon size={18} />
              <span>{name}</span>
            </a>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <LockKeyhole size={17} />
          <span>
            Restricted administration
            <small>Customer content stays private</small>
          </span>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <span>
            <span className="admin-status-dot" />
            Cottage Pantry Admin
          </span>
          <div>
            <Badge>Phase 1 · Read-only</Badge>
            {authenticated && (
              <button onClick={signOut} disabled={busy}>
                <LogOut size={15} />
                Sign out
              </button>
            )}
          </div>
        </header>
        <main className="admin-main">
          {!authenticated ? (
            <section className="admin-auth">
              <span className="admin-auth-icon">
                <LogIn size={32} />
              </span>
              <p className="admin-eyebrow">OWNER & ADMINISTRATOR ACCESS</p>
              <h1>Cottage Pantry Admin</h1>
              <p className="admin-intro">
                A separate place to oversee the platform.
                <br />
                Your Oven account does not grant administrator access.
              </p>
              {error && (
                <p role="alert" className="admin-error">
                  {error}
                </p>
              )}
              {recoveryCallback ? (
                <AdminPasswordReset
                  onComplete={() => {
                    setRecoveryCallback(false)
                    setRecovering(false)
                    setRecoveryMessage(
                      'Your password has been updated. Sign in below with your email and password to open admin settings.',
                    )
                    setSession({ stage: 'signed_out' })
                    setPassword('')
                    setError('')
                  }}
                  onRequestLink={() => {
                    setRecoveryCallback(false)
                    setRecovering(true)
                    setSession({ stage: 'signed_out' })
                    setRecoveryMessage('')
                    setError('')
                  }}
                />
              ) : !session ? (
                <div className="admin-loading" role="status">
                  Checking administrator session…
                </div>
              ) : (
                <form
                  onSubmit={recovering ? recoverPassword : signIn}
                  className="admin-login"
                >
                  {recovering && <h2>Reset your password</h2>}
                  {recoveryMessage && <p role="status">{recoveryMessage}</p>}
                  <label>
                    Email address
                    <input
                      type="email"
                      autoComplete="username"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  {!recovering && (
                    <label>
                      Password
                      <input
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </label>
                  )}
                  <button className="admin-primary" disabled={busy}>
                    {busy
                      ? 'Please wait…'
                      : recovering
                        ? 'Send reset link'
                        : 'Sign in'}
                    <ArrowUpRight size={17} />
                  </button>
                  <button
                    type="button"
                    className="admin-secondary"
                    disabled={busy}
                    onClick={() => {
                      setRecovering(!recovering)
                      setPassword('')
                      setError('')
                      setRecoveryMessage('')
                    }}
                  >
                    {recovering ? 'Back to sign in' : 'Reset password'}
                  </button>
                  <small>
                    Sign in with your administrator email and password.
                  </small>
                </form>
              )}
              <a className="admin-back" href="https://mycottagepantry.com/oven">
                <ArrowLeft size={15} />
                Back to My Oven
              </a>
            </section>
          ) : (
            <>
              <div className="admin-page-heading">
                <div>
                  <p className="admin-eyebrow">
                    COTTAGE PANTRY / ADMINISTRATION
                  </p>
                  <h1>{title}</h1>
                  <p>
                    {
                      {
                        overview:
                          'A factual view of the platform, grounded in recorded data.',
                        customers:
                          'Customer account and Oven metadata. Business records stay private.',
                        plans:
                          'Existing plan definitions and the access rules actually in effect.',
                        billing:
                          'Platform subscriptions, separate from customer seller connections.',
                        operations:
                          'Recorded processing evidence and honest gaps in monitoring.',
                        content:
                          'The stock label catalogue, without touching customer copies.',
                        audit: 'Who accessed the platform and what happened.',
                      }[section]
                    }
                  </p>
                </div>
                <button
                  className="admin-secondary"
                  onClick={() => {
                    setData(null)
                    setRefresh((r) => r + 1)
                  }}
                >
                  Refresh records
                </button>
              </div>
              {error && (
                <p className="admin-error" role="alert">
                  {error}
                </p>
              )}
              {(!data || loadedQuery !== queryString) && !error ? (
                <div className="admin-loading" role="status">
                  <span />
                  Loading authorized records…
                </div>
              ) : (
                data &&
                loadedQuery === queryString && (
                  <AdminView
                    section={section}
                    data={data}
                    params={params}
                    template={template}
                    setTemplate={setTemplate}
                  />
                )
              )}
              <footer className="admin-page-footer">
                <CircleCheck size={14} />
                Read access is audited. Session expires{' '}
                {date(session.expiresAt)}.
                <span>Administrator {session.identityId}</span>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function AdminView({
  section,
  data,
  params,
  template,
  setTemplate,
}: {
  section: string
  data: AdminMetadata
  params: URLSearchParams
  template: string
  setTemplate: (id: string) => void
}) {
  if (section === 'overview')
    return (
      <>
        <div className="admin-metrics">
          {[
            [
              'Customer accounts',
              data.totals.customer_accounts,
              data.definitions.customer_accounts,
            ],
            ['Customer Ovens', data.totals.ovens, data.definitions.ovens],
            [
              'Newly recorded · 30 days',
              data.totals.recent_accounts,
              data.definitions.recent_accounts,
            ],
          ].map(([name, value, definition]) => (
            <article className="admin-metric" key={name}>
              <p>{name}</p>
              <strong>{Number(value).toLocaleString()}</strong>
              <small>{definition}</small>
            </article>
          ))}
          <article className="admin-metric admin-metric-unavailable">
            <p>Failed jobs</p>
            <strong>Unavailable</strong>
            <small>{data.definitions.failed_jobs}</small>
          </article>
        </div>
        <p className="admin-asof">
          Snapshot as of {date(data.asOf)}. No historical trend is inferred.
        </p>
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <h2>Recorded subscriptions</h2>
            <a href={href('billing')}>
              View billing <ArrowUpRight size={15} />
            </a>
          </div>
          <p>{data.definitions.subscriptions}</p>
          <DataTable
            rows={data.subscriptions}
            empty="No customer subscription records are available."
            columns={[
              { title: 'Plan', cell: (r) => label(r.plan_id) },
              {
                title: 'Recorded status',
                cell: (r) => <Badge>{label(r.status)}</Badge>,
              },
              { title: 'Source', cell: (r) => label(r.source) },
              { title: 'Count', cell: (r) => r.count },
            ]}
          />
        </section>
        <div className="admin-overview-lower">
          <section className="admin-panel">
            <h2>Recently recorded accounts</h2>
            <p>
              First persisted ownership or membership; all time, newest first.
            </p>
            <DataTable
              rows={data.recent}
              columns={[
                {
                  title: 'Account ID',
                  cell: (r) => identityCell(r.identity_id),
                },
                {
                  title: 'First recorded',
                  cell: (r) => date(r.first_recorded_at),
                },
                { title: 'Ovens', cell: (r) => r.oven_count },
              ]}
            />
          </section>
          <section className="admin-panel">
            <h2>Administrative activity</h2>
            <ActivityTable rows={data.activity} />
          </section>
        </div>
      </>
    )
  if (section === 'customers') {
    if (data.oven) return <OvenDetail data={data} />
    const kind = params.get('kind') === 'accounts' ? 'accounts' : 'ovens'
    return (
      <section className="admin-panel">
        <div className="admin-tabs">
          <a
            aria-current={kind === 'ovens' ? 'page' : undefined}
            href={href('customers', { kind: 'ovens' })}
          >
            Ovens
          </a>
          <a
            aria-current={kind === 'accounts' ? 'page' : undefined}
            href={href('customers', { kind: 'accounts' })}
          >
            Accounts
          </a>
        </div>
        <form className="admin-search" action="/admin" method="get">
          <input type="hidden" name="section" value="customers" />
          <input type="hidden" name="kind" value={kind} />
          <label htmlFor="admin-search">
            <Search size={18} />
            Search {kind}
          </label>
          <div>
            <input
              id="admin-search"
              name="q"
              defaultValue={params.get('q') || ''}
              placeholder={
                kind === 'accounts'
                  ? 'Stable Identity ID'
                  : 'Oven name, Oven ID, or owner ID'
              }
              maxLength={120}
            />
            <button className="admin-primary">Search</button>
          </div>
        </form>
        {data.note && <p>{data.note}</p>}
        <DataTable
          rows={data.rows}
          columns={
            kind === 'accounts'
              ? [
                  {
                    title: 'Account ID',
                    cell: (r) => identityCell(r.identity_id),
                  },
                  {
                    title: 'Ovens',
                    cell: (r) => (
                      <a href={href('customers', { q: r.identity_id })}>
                        {r.oven_count} Ovens
                      </a>
                    ),
                  },
                  {
                    title: 'Active memberships',
                    cell: (r) => r.active_memberships,
                  },
                  {
                    title: 'Inactive memberships',
                    cell: (r) => r.inactive_memberships,
                  },
                  {
                    title: 'First recorded',
                    cell: (r) => date(r.first_recorded_at),
                  },
                ]
              : [
                  {
                    title: 'Oven',
                    cell: (r) => (
                      <a href={href('customers', { id: r.id })}>
                        <strong>{r.business_name}</strong>
                        {identityCell(r.id)}
                      </a>
                    ),
                  },
                  {
                    title: 'Owner account',
                    cell: (r) => identityCell(r.identity_owner),
                  },
                  {
                    title: 'Plan / billing status',
                    cell: (r) => (
                      <>
                        {label(r.plan_id)}
                        <small>
                          {label(r.billing_status)} · {label(r.source)}
                        </small>
                      </>
                    ),
                  },
                  { title: 'Active members', cell: (r) => r.active_members },
                  { title: 'Created', cell: (r) => date(r.created_at) },
                ]
          }
        />
        <Pager
          data={data}
          section="customers"
          query={{ kind, q: params.get('q') || '' }}
        />
      </section>
    )
  }
  if (section === 'plans')
    return (
      <>
        <Notice>{data.note}</Notice>
        <section className="admin-panel">
          <h2>Effective application access</h2>
          <p>
            Oven membership and current server checks govern access. Global
            commercial tier restrictions are{' '}
            {data.pricing.restrictionsEnabled ? 'enabled' : 'not enabled'}.
            Billing status and a proposed entitlement do not prove that a
            feature is enforced.
          </p>
          <p>
            Complimentary records appear in Oven details. Temporary access
            overrides are unavailable.
          </p>
        </section>
        <div className="admin-plan-grid">
          {data.pricing.plans.map((p: AdminMetadata) => (
            <section className="admin-panel" key={p.id}>
              <Badge>
                {p.publication === 'unpublished_draft'
                  ? 'Unpublished draft · not assignable'
                  : 'Existing draft tier'}
              </Badge>
              <h2>{p.name}</h2>
              <p className="admin-plan-price">
                ${p.monthlyUsd}
                <small> USD / month · proposed</small>
              </p>
              <p>
                {p.users == null
                  ? 'Team user limit awaiting confirmation'
                  : `${p.users} total ${p.users === 1 ? 'user' : 'users'}, including the owner`}
              </p>
              <ul>
                {p.highlights.map((v: string) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
              <p>{p.caveat}</p>
            </section>
          ))}
        </div>
        <section className="admin-panel">
          <h2>Feature definitions</h2>
          <DataTable
            rows={data.features}
            columns={[
              { title: 'Feature', cell: (r) => r.label },
              {
                title: 'Implementation status',
                cell: (r) => <Badge>{label(r.status)}</Badge>,
              },
              {
                title: 'Proposed plan entitlement',
                cell: (r) => r.plans.join(', '),
              },
              {
                title: 'Free limits',
                cell: (r) =>
                  r.freeScope?.label || 'No additional limit recorded',
              },
              {
                title: 'Tests',
                cell: (r) =>
                  r.testing ? label(r.testing) : 'Not recorded in matrix',
              },
              {
                title: 'Usage limits & dependencies',
                cell: (r) =>
                  [r.limits, r.dependencies].filter(Boolean).join(' · ') || '—',
              },
              {
                title: 'Gap',
                cell: (r) => r.gap || '—',
              },
            ]}
          />
        </section>
      </>
    )
  if (section === 'billing')
    return (
      <>
        <Notice>{data.notice}</Notice>
        <BillingConnection data={data} />
        <section className="admin-panel">
          <h2>Platform billing records</h2>
          <p>
            Last successful production synchronization:{' '}
            {date(data.lastSuccessfulProductionSync)}. Update timestamps below
            describe stored records.
          </p>
          <DataTable
            rows={data.rows}
            empty="No customer billing records are available."
            columns={[
              {
                title: 'Oven',
                cell: (r) => (
                  <a href={href('customers', { id: r.business_id })}>
                    {r.business_name}
                    {identityCell(r.business_id)}
                  </a>
                ),
              },
              {
                title: 'Plan / source',
                cell: (r) => (
                  <>
                    {label(r.plan_id)}
                    <small>{label(r.source)}</small>
                  </>
                ),
              },
              {
                title: 'Recorded status',
                cell: (r) => <Badge>{label(r.status)}</Badge>,
              },
              {
                title: 'Subscription reference',
                cell: (r) => label(r.subscription_reference),
              },
              { title: 'Record updated', cell: (r) => date(r.updated_at) },
            ]}
          />
          <Pager data={data} section="billing" query={{}} />
          <a
            className="admin-external"
            href={data.managementUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Square billing management <ArrowUpRight size={15} />
          </a>
          <p>{data.managementNote}</p>
        </section>
        <BillingEvents rows={data.events} />
      </>
    )
  if (section === 'operations')
    return (
      <>
        <Notice>{data.note}</Notice>
        <section className="admin-panel">
          <h2>Diagnostic coverage</h2>
          <DataTable
            rows={data.coverage}
            columns={[
              { title: 'Area', cell: (r) => r.area },
              {
                title: 'Availability',
                cell: (r) => <Badge>{label(r.availability)}</Badge>,
              },
              { title: 'What is recorded', cell: (r) => r.detail },
            ]}
          />
        </section>
        <OperationalRecords rows={data.records} />
        <BillingEvents rows={data.events} />
      </>
    )
  if (section === 'content') {
    const selected =
      systemLabelTemplates.find((t) => t.id === template) ||
      systemLabelTemplates[0]
    return (
      <>
        <Notice>{data.note}</Notice>
        <AdminCatalog />
        <AdminRegistrationPolicies />
        <section className="admin-panel">
          <h2>System label templates</h2>
          <p>
            Preview uses labelled placeholders. Catalogue entries have no
            published version registry yet.
          </p>
          <div className="admin-template-layout">
            <div className="admin-template-list">
              {systemLabelTemplates.map((t) => (
                <button
                  key={t.id}
                  aria-pressed={selected.id === t.id}
                  onClick={() => setTemplate(t.id)}
                >
                  <strong>{t.name}</strong>
                  <small>{t.id} · Source catalogue</small>
                </button>
              ))}
            </div>
            <div className="admin-template-preview">
              <LabelCanvas
                document={selected}
                data={{
                  values: {
                    'product.name': '[Product name]',
                    'business.name': '[Business name]',
                    'recipe.ingredients': '[Ingredients]',
                    'recipe.allergens': '[Allergens]',
                    'product.netQuantity': '[Net quantity]',
                    'product.description': '[Description]',
                    date: '[Date]',
                  },
                  warnings: [],
                  allergens: [],
                  weightsVerified: false,
                  ingredientParts: [],
                }}
              />
              <p>
                {selected.name} · {selected.width} × {selected.height} pt
              </p>
            </div>
          </div>
        </section>
      </>
    )
  }
  return (
    <>
      <Notice>{data.policy}</Notice>
      <section className="admin-panel">
        <h2>Access audit</h2>
        <ActivityTable rows={data.rows} detailed />
        <Pager data={data} section="audit" query={{}} />
      </section>
      <section className="admin-panel">
        <h2>Security policy</h2>
        <p>
          Administrator grants are independent of customer memberships. Sign in
          with your administrator email and password. Sessions are scoped to
          this host and expire after 30 minutes.
        </p>
        <p>
          Revocation is checked on every API request. Owner provisioning
          requires a controlled server-side operator process. Administrator
          management is unavailable in this release.
        </p>
      </section>
    </>
  )
}
function OvenDetail({ data }: { data: AdminMetadata }) {
  const o = data.oven
  return (
    <>
      <a className="admin-back" href={href('customers')}>
        ← All Ovens
      </a>
      <section className="admin-panel">
        <Badge>Metadata only</Badge>
        <h2>{o.business_name}</h2>
        <dl className="admin-details">
          <div>
            <dt>Stable Oven ID</dt>
            <dd>{identityCell(o.id)}</dd>
          </div>
          <div>
            <dt>Owner Identity ID</dt>
            <dd>{identityCell(o.identity_owner)}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{date(o.created_at)}</dd>
          </div>
          <div>
            <dt>Recorded account status</dt>
            <dd>{data.accountStatus}</dd>
          </div>
          <div>
            <dt>Plan / subscription state</dt>
            <dd>
              {label(data.billing?.plan_id)} / {label(data.billing?.status)}
              <small>{label(data.billing?.source)}</small>
            </dd>
          </div>
        </dl>
      </section>
      <section className="admin-panel">
        <h2>Memberships</h2>
        <DataTable
          rows={data.memberships}
          columns={[
            { title: 'Account ID', cell: (r) => identityCell(r.identity_id) },
            { title: 'Membership ID', cell: (r) => identityCell(r.id) },
            { title: 'Oven role', cell: (r) => r.role },
            {
              title: 'Recorded activity',
              cell: (r) => (r.active ? 'Active' : 'Inactive'),
            },
            { title: 'Created', cell: (r) => date(r.created_at) },
          ]}
        />
      </section>
      <section className="admin-panel">
        <h2>Effective access</h2>
        <p>{data.access.policy}</p>
        <p>{data.access.temporaryOverrides}</p>
        <h3>Recorded complimentary grants</h3>
        <DataTable
          rows={data.grants}
          empty="No complimentary grants are recorded for this Oven."
          columns={[
            { title: 'Grant', cell: (r) => identityCell(r.id) },
            { title: 'Plan', cell: (r) => r.plan_id },
            {
              title: 'Granted by',
              cell: (r) => identityCell(r.actor_identity),
            },
            {
              title: 'Owner binding',
              cell: (r) => identityCell(r.owner_identity),
            },
            { title: 'Start', cell: (r) => date(r.created_at) },
            {
              title: 'Expiry',
              cell: () => 'No expiry in existing grant schema',
            },
          ]}
        />
      </section>
      <section className="admin-panel">
        <h2>Integration connection metadata</h2>
        <DataTable
          rows={data.integrations}
          empty="No integration connection metadata is recorded. Connectivity is unverified."
          columns={[
            { title: 'Connection reference', cell: (r) => identityCell(r.id) },
            {
              title: 'Recorded status',
              cell: (r) => <Badge>{r.recorded_status}</Badge>,
            },
            { title: 'Record updated', cell: (r) => date(r.updated_at) },
          ]}
        />
      </section>
      <OperationalRecords rows={data.operations} />
      <section className="admin-panel">
        <h2>Admin notes & activity</h2>
        <p>{data.notes}</p>
        <ActivityTable rows={data.activity} />
      </section>
    </>
  )
}
function OperationalRecords({ rows }: { rows: AdminMetadata[] }) {
  return (
    <section className="admin-panel">
      <h2>Processing & recovery records</h2>
      <p>
        Latest 50 persisted references. Unrecorded stages, error details and
        deployment versions remain unavailable.
      </p>
      <DataTable
        rows={rows}
        empty="No diagnostic records are available. Monitoring coverage is incomplete."
        columns={[
          {
            title: 'Request / draft reference',
            cell: (r) => identityCell(r.id),
          },
          { title: 'Oven ID', cell: (r) => identityCell(r.business_id) },
          {
            title: 'Area / recorded stage',
            cell: (r) => (
              <>
                {label(r.area)}
                <small>Detailed stage unavailable</small>
              </>
            ),
          },
          {
            title: 'Recorded status',
            cell: (r) => <Badge>{label(r.status)}</Badge>,
          },
          {
            title: 'Safe error code',
            cell: (r) => r.error_code || 'None recorded',
          },
          { title: 'Updated', cell: (r) => date(r.updated_at) },
        ]}
      />
    </section>
  )
}
function BillingEvents({ rows }: { rows: AdminMetadata[] }) {
  return (
    <section className="admin-panel">
      <h2>Square billing processing events</h2>
      <p>
        Latest 30 recorded events. Provider object IDs, merchant credentials and
        event payloads are excluded. Correlation failures require engineering
        review; lookup failures require a Sandbox configuration check.
      </p>
      <DataTable
        rows={rows}
        empty="No Square billing processing events have been recorded."
        columns={[
          { title: 'Event reference', cell: (r) => identityCell(r.id) },
          {
            title: 'Recorded status',
            cell: (r) => <Badge>{label(r.status)}</Badge>,
          },
          {
            title: 'Safe error code',
            cell: (r) => r.error_code || 'None recorded',
          },
          { title: 'Received', cell: (r) => date(r.received_at) },
          { title: 'Last processed', cell: (r) => date(r.processed_at) },
        ]}
      />
    </section>
  )
}

function BillingConnection({ data }: { data: AdminMetadata }) {
  return <AdminSquareConnection data={data} request={adminRequest} />
}
