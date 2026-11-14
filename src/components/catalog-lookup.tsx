import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LookupActionContext, LookupError } from './lookup-error'
import { ProductImportFailure } from '@/lib/product-import-diagnostics'
import { type Item, type Workspace } from '@/lib/domain'
import {
  catalogKinds,
  catalogResponseSchema,
  type CatalogResponse,
  sharedSnapshot,
  type CatalogResult,
  type CatalogSnapshot,
} from '@/lib/catalog'
import { DraftFieldReview } from './draft-field-review'
import { ReviewText } from './product-link-import'
import './catalog-lookup.css'

export async function catalogRequest(body: unknown, signal?: AbortSignal) {
  const res = await fetch('/api/workspace?catalog=1', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || data?.version !== 1)
    throw new ProductImportFailure(
      data?.error ||
        `Catalog request failed (HTTP ${res.status}). Retry; your draft is preserved.`,
      {
        requestedAt: new Date().toISOString(),
        requestedUrl: '',
        source: 'backend',
        hops: [],
        requestId: data?.reference,
      },
      undefined,
      data?.code,
      res.status,
    )
  const parsed = catalogResponseSchema.safeParse(data)
  if (!parsed.success)
    throw new Error(
      'Catalog returned invalid product fields. Retry; your draft is preserved.',
    )
  return parsed.data
}
export function CatalogLookup({
  draft,
  workspace,
  apply,
  onScan,
  autoSearch = false,
  packageSetup = false,
  onSourceUrl,
}: {
  draft: Record<string, Item[string]>
  workspace: Workspace
  apply: (patch: Record<string, Item[string]>) => void
  onScan?: () => void
  autoSearch?: boolean
  packageSetup?: boolean
  onSourceUrl?: (url: string) => void
}) {
  const lookupContext = useContext(LookupActionContext)
  const compact = lookupContext !== null
  const kind = (
    catalogKinds.includes(draft.usedAs) ? draft.usedAs : 'ingredient'
  ) as CatalogSnapshot['kind']
  const [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [data, setData] = useState<CatalogResponse | null>(null),
    [choice, setChoice] = useState<CatalogResult | null>(null),
    [opened, setOpened] = useState<Item | null>(null)
  const pending = useRef(false),
    abort = useRef<AbortController | null>(null)
  const [failure, setFailure] = useState<ProductImportFailure | null>(null)
  const [failedAction, setFailedAction] = useState('barcode')
  useEffect(() => () => abort.current?.abort(), [])
  const barcode = String(draft.barcode || '')
  const format = String(draft.barcodeFormat || '')
  useEffect(() => {
    abort.current?.abort()
    pending.current = false
    // A parent camera scan changes the controlled barcode outside this component.
    // Clear only lookup state; the shared draft remains authoritative.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(false)
    setData(null)
    setChoice(null)
    setError('')
  }, [barcode, kind])
  async function lookup(operation: string, search: string) {
    if (pending.current || !search.trim()) return
    pending.current = true
    const action = operation === 'search' ? 'catalog' : 'barcode'
    lookupContext?.start(action)
    setFailedAction(action)
    setFailure(null)
    const controller = new AbortController()
    abort.current = controller
    setBusy(true)
    setError('')
    setChoice(null)
    try {
      const result = await catalogRequest(
        {
          operation,
          kind,
          query: search,
          format: operation === 'search' ? undefined : format,
        },
        controller.signal,
      )
      if (!controller.signal.aborted) setData(result)
    } catch (e) {
      if (!controller.signal.aborted) {
        setError((e as Error).message)
        setFailure(e instanceof ProductImportFailure ? e : null)
      }
    } finally {
      if (!controller.signal.aborted) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  const run = useRef(lookup)
  useLayoutEffect(() => {
    run.current = lookup
  })
  useEffect(() => {
    if (autoSearch && barcode) void run.current('lookup', barcode)
  }, [autoSearch, barcode, format])
  return (
    <section className="catalog-lookup" aria-label="Product lookup">
      <div className="barcode-entry-row">
        <label className="field">
          <span>{compact ? 'Barcode' : 'Scan or enter barcode'}</span>
          <input
            autoComplete="off"
            value={barcode}
            onChange={(e) =>
              apply({ barcode: e.target.value, barcodeFormat: '' })
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void lookup('lookup', barcode)
              }
            }}
          />
        </label>
        <button
          type="button"
          className="btn secondary"
          disabled={busy || !barcode.trim()}
          onClick={() => void lookup('lookup', barcode)}
        >
          {compact ? 'Look up' : 'Look up barcode'}
        </button>
        {onScan && (
          <button type="button" className="btn secondary" onClick={onScan}>
            Scan Barcode
          </button>
        )}
      </div>
      {compact &&
        failedAction === 'barcode' &&
        lookupContext.active === 'barcode' &&
        error && (
          <LookupError
            message="Barcode lookup failed."
            code={failure?.code}
            status={failure?.status}
            diagnostics={failure?.diagnostics}
          />
        )}
      {/^\d{8}$/.test(barcode) && (
        <label className="field">
          <span>Eight-digit barcode format</span>
          <select
            value={format}
            onChange={(e) => apply({ barcodeFormat: e.target.value })}
          >
            <option value="">Choose format for external lookup</option>
            <option value="ean_8">EAN-8</option>
            <option value="upc_e">UPC-E</option>
          </select>
        </label>
      )}
      <div className="catalog-search-row">
        <label className="field">
          <span>{compact ? 'Catalog' : 'Search catalog by name or brand'}</span>
          <input
            value={query}
            onChange={(e) => {
              abort.current?.abort()
              pending.current = false
              setBusy(false)
              setError('')
              setData(null)
              setChoice(null)
              setQuery(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void lookup('search', query)
              }
            }}
          />
        </label>
        <button
          type="button"
          className="btn secondary"
          disabled={busy || !query.trim()}
          onClick={() => void lookup('search', query)}
        >
          {compact ? 'Search' : 'Search catalog'}
        </button>
      </div>
      {busy && <p role="status">Checking product references…</p>}
      {compact &&
        failedAction === 'catalog' &&
        lookupContext.active === 'catalog' &&
        error && (
          <LookupError
            message="Catalog search failed."
            code={failure?.code}
            status={failure?.status}
            diagnostics={failure?.diagnostics}
          />
        )}
      {!compact && error && <p role="alert">{error}</p>}
      {data?.notice && <p role="status">{data.notice}</p>}
      {data?.existing?.map((item: Item) => (
        <div key={item.id} className="catalog-result">
          <strong>Already in your account: {item.name}</strong>
          {item.variant && <span>{item.variant}</span>}
          <button
            type="button"
            className="text-button"
            onClick={() =>
              setOpened(
                workspace.ingredients.find((i) => i.id === item.id) || item,
              )
            }
          >
            Open existing item
          </button>
        </div>
      ))}
      {opened && (
        <section className="catalog-result" aria-label="Existing item">
          <h4>{opened.name}</h4>
          {[
            'brand',
            'variant',
            'barcode',
            'purchaseQuantity',
            'purchaseUnit',
            'subingredients',
            'sourceContains',
            'sourceMayContain',
          ]
            .filter((k) => opened[k])
            .map((k) => (
              <p key={k}>
                <strong>{k}: </strong>
                <ReviewText text={String(opened[k])} />
              </p>
            ))}
          <p>Saved item details. Your unfinished draft stays in this popup.</p>
          <button
            type="button"
            className="btn secondary"
            onClick={() => setOpened(null)}
          >
            Return to draft
          </button>
        </section>
      )}
      {data?.results?.map((item: CatalogResult) => (
        <div className="catalog-result" key={item.revisionId}>
          <strong>{item.fields.name}</strong>
          <small>
            {[
              item.fields.brand,
              item.fields.variant,
              item.entryType === 'generic'
                ? 'Generic starter — product details unknown'
                : item.fields.barcode,
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
          <small>{item.reviewScope}</small>
          {item.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
              {s.license}
            </a>
          ))}
          <button
            type="button"
            className="text-button"
            onClick={() => setChoice(item)}
          >
            Review for my{' '}
            {kind === 'ingredient'
              ? 'ingredients'
              : kind === 'supply'
                ? 'supplies'
                : 'packaging'}
          </button>
        </div>
      ))}
      {data && !data.existing?.length && !data.results?.length && !busy && (
        <p className="form-hint">
          No confirmed product match. Keep manual entry or choose a product
          page.
        </p>
      )}
      {data && !data.existing?.length && barcode && (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => void lookup('internet', barcode)}
        >
          Search the internet
        </button>
      )}
      {data?.provider && <p className="form-hint">{data.provider}</p>}
      {data?.candidates?.map(
        (c: { url: string; title: string; domain: string }) => (
          <div className="catalog-result" key={c.url}>
            <a href={c.url} target="_blank" rel="noreferrer">
              {c.title}
            </a>
            <small>{c.domain} · Unverified candidate</small>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                apply({ productSourceUrl: c.url })
                onSourceUrl?.(c.url)
              }}
            >
              Use this product page
            </button>
          </div>
        ),
      )}
      {data?.fallbackUrl && (
        <a
          className="catalog-web-search"
          href={data.fallbackUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open exact-barcode web search
        </a>
      )}
      {choice && (
        <DraftFieldReview
          key={choice.revisionId}
          draft={draft}
          fields={choice.fields}
          packageSetup={packageSetup}
          source={
            choice.status === 'external'
              ? choice.reviewScope
              : 'Catalog reference — ' + choice.reviewScope
          }
          apply={(patch, fields) =>
            apply({
              ...patch,
              ...(choice.status !== 'external'
                ? {
                    catalogSource: {
                      requestId: crypto.randomUUID(),
                      itemId: choice.id,
                      revisionId: choice.revisionId,
                      fields,
                    },
                  }
                : { productSourceUrl: choice.sources[0]?.url }),
            })
          }
          onApplied={() => setChoice(null)}
        />
      )}
    </section>
  )
}
export function CatalogUpdates({
  draft,
  apply,
}: {
  draft: Record<string, Item[string]>
  apply: (patch: Record<string, Item[string]>) => void
}) {
  const lookupContext = useContext(LookupActionContext)
  const [failure, setFailure] = useState<ProductImportFailure | null>(null)
  const [update, setUpdate] = useState<CatalogResult | null>(null),
    [error, setError] = useState(''),
    [checking, setChecking] = useState(false),
    [checked, setChecked] = useState(false)
  if (!draft.catalogSource) return null
  return (
    <section className="catalog-lookup">
      <button
        type="button"
        className="text-button"
        disabled={checking}
        onClick={async () => {
          lookupContext?.start('updates')
          setChecking(true)
          setError('')
          try {
            const data = await catalogRequest({ operation: 'updates' })
            setUpdate(
              data.updates?.find((u) => u.ingredientId === draft.id) || null,
            )
            setChecked(true)
          } catch (e) {
            setError((e as Error).message)
            setFailure(e instanceof ProductImportFailure ? e : null)
          } finally {
            setChecking(false)
          }
        }}
      >
        Check catalog updates
      </button>
      {error &&
        (lookupContext ? (
          lookupContext.active === 'updates' && (
            <LookupError
              message="Catalog update check failed."
              code={failure?.code}
              status={failure?.status}
            />
          )
        ) : (
          <p role="alert">{error}</p>
        ))}
      {checked && !update && (
        <small>Your accepted catalog revision is current.</small>
      )}
      {update &&
        (update.status !== 'active' ? (
          <p>
            This reference was {update.status}. Your saved values and source
            history stay unchanged.
          </p>
        ) : (
          <>
            <p>
              Catalog update available. Compare the values and accept selected
              changes.
            </p>
            <DraftFieldReview
              key={update.revisionId}
              draft={draft}
              fields={update.fields}
              source={update.reviewScope}
              apply={(patch, fields) =>
                apply({
                  ...patch,
                  catalogSource: {
                    requestId: crypto.randomUUID(),
                    itemId: update.id,
                    revisionId: update.revisionId,
                    fields,
                  },
                })
              }
              onApplied={() => setUpdate(null)}
            />
          </>
        ))}
    </section>
  )
}
export function CatalogContribution({
  draft,
}: {
  draft: Record<string, Item[string]>
}) {
  const lookupContext = useContext(LookupActionContext)
  const compact = lookupContext !== null
  const [failure, setFailure] = useState<ProductImportFailure | null>(null)
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null),
    [error, setError] = useState(''),
    [rights, setRights] = useState(false),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false)
  const requestId = useRef(crypto.randomUUID())
  return (
    <details className="catalog-contribution">
      <summary>
        {compact
          ? 'Suggest product/correction'
          : 'Suggest a catalog product or correction'}
      </summary>
      <p className="form-hint">
        Only the fields shown below are submitted. Prices, suppliers, stock,
        notes and private images stay private. An administrator reviews
        submissions before publication.
      </p>
      <button
        type="button"
        className="text-button"
        onClick={() => {
          lookupContext?.start('contribution')
          setFailure(null)
          try {
            setSnapshot(
              sharedSnapshot(
                draft,
                draft.usedAs === 'packaging'
                  ? 'packaging'
                  : draft.usedAs === 'supply'
                    ? 'supply'
                    : 'ingredient',
              ),
            )
            setError('')
            setSent(false)
            setRights(false)
            requestId.current = crypto.randomUUID()
          } catch {
            setError(
              'Enter a product name and valid package/barcode information before sharing.',
            )
          }
        }}
      >
        Preview shared fields
      </button>
      {snapshot && (
        <>
          <dl>
            {Object.entries(snapshot.fields).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>
                  <ReviewText text={String(v)} />
                </dd>
              </div>
            ))}
          </dl>
          <label className="check-label">
            <input
              type="checkbox"
              checked={rights}
              onChange={(e) => setRights(e.target.checked)}
            />
            I have permission to share these fields for catalog reuse.
          </label>
          <button
            type="button"
            className="btn secondary"
            disabled={!rights || busy || sent}
            onClick={async () => {
              lookupContext?.start('contribution')
              setBusy(true)
              setError('')
              try {
                await catalogRequest({
                  operation: 'submit',
                  snapshot,
                  rights: true,
                  requestId: requestId.current,
                  targetId: draft.catalogSource?.itemId,
                })
                setSent(true)
              } catch (e) {
                setError((e as Error).message)
                setFailure(e instanceof ProductImportFailure ? e : null)
              } finally {
                setBusy(false)
              }
            }}
          >
            Submit for review
          </button>
        </>
      )}
      {sent && (
        <p role="status">
          Submitted for administrator review. Nothing was published.
        </p>
      )}
      {error &&
        (compact ? (
          lookupContext.active === 'contribution' && (
            <LookupError
              message="Product suggestion failed. Check the product details."
              code={failure?.code}
              status={failure?.status}
            />
          )
        ) : (
          <p role="alert">{error}</p>
        ))}
    </details>
  )
}
