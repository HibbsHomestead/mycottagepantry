export async function readPriceResponse(response: Response) {
  const mime = response.headers.get('content-type') || ''
  if (!mime.includes('application/json'))
    throw new Error(
      `Price comparison returned an unexpected response (HTTP ${response.status}). Check sign-in or try again later.`,
    )
  let value: any
  try {
    value = await response.json()
  } catch {
    throw new Error(
      'Price comparison returned an invalid response. Try again later.',
    )
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(
      'Price comparison returned an invalid response. Try again later.',
    )
  if (!response.ok)
    throw new Error(
      typeof value?.error === 'string'
        ? value.error
        : 'Price comparison could not complete this request.',
    )
  return value
}
import { useEffect, useRef, useState } from 'react'
import { Search, ExternalLink } from 'lucide-react'
import {
  searchPhrase,
  webComparison,
  rankWebOffers,
  type PriceSearchInput,
  type WebOffer,
} from '@/lib/price-search'
import { precise } from '@/lib/ingredients'
import type { Item, Workspace } from '@/lib/domain'
import './store-price-search.css'
export function StorePriceSearch({
  ingredient: i,
  canEdit,
  onWorkspace,
  onSetup,
}: {
  ingredient: Item
  onSetup?: () => void
  canEdit: boolean
  onWorkspace: (w: Workspace) => void
}) {
  const [expanded, setExpanded] = useState(false),
    [configured, setConfigured] = useState<boolean | null>(null),
    [cache, setCache] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [cached, setCached] = useState(true),
    [showAll, setShowAll] = useState(false),
    [saved, setSaved] = useState<string[]>([]),
    [review, setReview] = useState<WebOffer | null>(null)
  const [input, setInput] = useState<PriceSearchInput>({
    query: searchPhrase(i),
    zip: '',
    preference: 'both',
    alternativeBrands: false,
  })
  const pending = useRef(false)
  useEffect(() => {
    let active = true
    setCache(null)
    setConfigured(null)
    setError('')
    setSaved([])
    setCached(true)
    setShowAll(false)
    setInput({
      query: searchPhrase(i),
      zip: '',
      preference: 'both',
      alternativeBrands: false,
    })
    fetch('/api/workspace?priceSearch=' + encodeURIComponent(i.id), {
      cache: 'no-store',
    })
      .then(async (r) => {
        const value = await readPriceResponse(r)
        if (!r.ok)
          throw new Error(value.error || 'Could not load recent prices.')
        if (active) {
          setConfigured(value.configured)
          setCache(value.cache)
          if (value.cache?.request) setInput(value.cache.request)
        }
      })
      .catch(() => {
        if (active)
          setError(
            'Could not load price-search setup or recent results. Try Find prices when your oven is connected.',
          )
      })
    return () => {
      active = false
    }
  }, [i.id])
  async function action(body: any) {
    if (pending.current) return false
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const response = await fetch(
        '/api/workspace?priceSearch=' + encodeURIComponent(i.id),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const value = await readPriceResponse(response)
      if (value.configured === false) setConfigured(false)
      if (!response.ok) throw new Error(value.error || 'Price search failed.')
      if (body.operation === 'save') {
        setSaved((old) => [...old, body.offerId])
        const refresh = await fetch('/api/workspace')
        if (refresh.ok) onWorkspace((await refresh.json()).workspace)
      } else {
        setConfigured(value.configured)
        setCache(value.cache)
        setCached(value.cached)
        setShowAll(false)
      }
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
      pending.current = false
    }
  }
  const offers = rankWebOffers(i, (cache?.offers || []) as WebOffer[]),
    stale = cache && Date.now() - Date.parse(cache.checkedAt) >= 3600000
  return (
    <div className="store-price-search">
      <div className="button-row">
        <button
          className="btn secondary"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <Search size={16} /> Compare store prices
        </button>
      </div>
      <p>Find matching products and compare costs before your next purchase.</p>
      {configured === false && (
        <p className="muted">
          Price comparison isn’t configured.{' '}
          {onSetup && (
            <button className="text-button" onClick={onSetup}>
              Set up price comparison
            </button>
          )}{' '}
          Manual price entry remains available.
        </p>
      )}
      {review && (
        <section className="calculation-box" aria-label="Review store offer">
          <h4>Review store offer</h4>
          <p>
            {review.title} · {review.retailer}
          </p>
          <p>
            {review.currency} {precise(review.price)} · {review.packageQuantity}{' '}
            {review.purchaseUnit}
          </p>
          <p>
            {review.match}. Saving adds a quote only. Preferred vendor, current
            reference price, stock and financial records stay unchanged.
          </p>
          <div className="button-row">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Cancel
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                if (await action({ operation: 'save', offerId: review.id }))
                  setReview(null)
              }}
            >
              Confirm save offer
            </button>
          </div>
        </section>
      )}
      {expanded && (
        <div className="price-search-controls">
          <label className="field">
            <span>Product search</span>
            <input
              value={input.query}
              maxLength={180}
              onChange={(e) => setInput({ ...input, query: e.target.value })}
            />
          </label>
          <p className="muted">
            Includes brand, product, known size and your barcode when available.
            Editing this search does not rename the ingredient. Only product
            search text, optional ZIP code and shopping preference are sent.
          </p>
          <div className="form-grid">
            <label className="field">
              <span>ZIP code (optional)</span>
              <input
                inputMode="numeric"
                maxLength={10}
                value={input.zip}
                onChange={(e) => setInput({ ...input, zip: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Shopping preference</span>
              <select
                value={input.preference}
                onChange={(e) =>
                  setInput({
                    ...input,
                    preference: e.target
                      .value as PriceSearchInput['preference'],
                  })
                }
              >
                <option value="both">Both</option>
                <option value="nearby">Nearby / pickup</option>
                <option value="online">Online / delivery</option>
              </select>
            </label>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={input.alternativeBrands}
              onChange={(e) =>
                setInput({ ...input, alternativeBrands: e.target.checked })
              }
            />{' '}
            Include alternative brands
          </label>
          <p className="muted">
            US listings in USD. Location and pickup/delivery availability depend
            on retailer data; a listing does not confirm stock. Barcode matches
            require an identifier returned by the source.
          </p>
          <div className="button-row">
            <button
              className="btn"
              disabled={busy || !canEdit || configured === false}
              onClick={() => void action({ operation: 'search', ...input })}
            >
              {busy ? 'Finding prices…' : 'Find prices'}
            </button>
            {cache && (
              <button
                className="btn secondary"
                disabled={busy || !canEdit || configured === false}
                onClick={() =>
                  void action({ operation: 'search', ...input, refresh: true })
                }
              >
                Refresh prices
              </button>
            )}
          </div>
          {!canEdit && (
            <p className="muted">
              An Owner or Manager can run price searches and save offers.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="warning-text">
          {error}
        </p>
      )}
      {busy && (
        <p role="status">
          Checking store listings… Existing costs and stock stay unchanged.
        </p>
      )}
      {cache && (
        <>
          <p className="muted">
            {!cached &&
              (offers.length
                ? 'Search successful. '
                : 'No matching products. ')}
            {cached ? 'Saved/cached results' : 'Provider results'} · Checked{' '}
            {new Date(cache.checkedAt).toLocaleString()} · Search:{' '}
            {cache.request.query}
            {cache.request.zip ? ` · ZIP ${cache.request.zip}` : ''}{' '}
            {stale ? '· Stale — refresh before saving' : ''}
          </p>
          <p className="muted">
            Match quality first, comparable cost second. Prices are before tax
            and shipping. No paid placement affects ranking.
          </p>
          {!offers.length && (
            <p>
              No matching offers found. Try the brand and product name, or
              include alternative brands.
            </p>
          )}
          <div className="web-offer-grid">
            {(showAll ? offers : offers.slice(0, 2)).map((o) => {
              const c = webComparison(i, o),
                canSave =
                  !!o.packageQuantity &&
                  !!o.purchaseUnit &&
                  o.direct &&
                  !o.conditional &&
                  o.currency === (i.currency || 'USD') &&
                  c.unitCost != null &&
                  !stale
              return (
                <article className="web-offer" key={o.id}>
                  <div className="web-offer-heading">
                    {o.thumbnail && (
                      <img
                        src={o.thumbnail}
                        alt={o.title}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.hidden = true
                        }}
                      />
                    )}
                    <div>
                      <h4>{o.retailer}</h4>
                      <p>{o.title}</p>
                      {o.brand && <small>{o.brand}</small>}
                    </div>
                  </div>
                  <span className="status neutral">{o.match}</span>
                  <strong>
                    {o.currency} {precise(o.price)} per listed package
                  </strong>
                  <p>
                    {o.packageQuantity && o.purchaseUnit
                      ? `${precise(o.packageQuantity)} ${o.purchaseUnit} total${o.multipack && o.multipack > 1 ? ` · ${o.multipack} packs` : ''}`
                      : 'Package size not verified'}
                  </p>
                  {c.unitCost != null && (
                    <p>
                      {o.currency} {precise(c.unitCost)} / {c.unit}
                    </p>
                  )}
                  {c.warning ? (
                    <p className="muted">{c.warning}</p>
                  ) : (
                    c.difference != null && (
                      <>
                        <p
                          className={
                            c.difference < 0 ? 'positive-text' : 'warning-text'
                          }
                        >
                          {c.difference < 0 ? '-' : '+'}
                          {o.currency} {precise(Math.abs(c.difference))}/
                          {c.unit} · {Math.abs(c.percent!).toFixed(1)}%{' '}
                          {c.difference < 0
                            ? 'cheaper'
                            : c.difference > 0
                              ? 'more expensive'
                              : 'same unit price'}
                        </p>
                        <p>
                          Equivalent{' '}
                          {c.equivalent! < 0 ? 'savings' : 'extra cost'} for
                          your reference package: {o.currency}{' '}
                          {Math.abs(c.equivalent!).toFixed(2)}
                        </p>
                      </>
                    )
                  )}
                  {o.conditions.map((v, n) => (
                    <p className="warning-text" key={n}>
                      {v}
                    </p>
                  ))}
                  <p className="muted">
                    Shipping:{' '}
                    {o.shipping == null
                      ? 'Not provided'
                      : `${o.currency} ${precise(o.shipping)}`}{' '}
                    · Pickup/delivery: {o.delivery || 'Not provided'}
                  </p>
                  {o.deliveredTotal != null && (
                    <p>
                      Provider-listed total (check tax/shipping): {o.currency}{' '}
                      {precise(o.deliveredTotal)}
                    </p>
                  )}
                  <p className="muted">
                    Stock: {o.availability || 'Not provided'}
                    {o.availabilitySource ? ` (${o.availabilitySource})` : ''}
                  </p>
                  <small>
                    Checked {new Date(o.checkedAt).toLocaleString()} · SerpApi
                  </small>
                  {o.rank === 4 && (
                    <p className="warning-text">
                      Different brand: review ingredients, subingredients and
                      allergens before using this product.
                    </p>
                  )}
                  <div className="button-row">
                    <a
                      className="btn secondary"
                      href={o.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {o.direct ? 'View at store' : 'View product listing'}
                      <ExternalLink size={14} />
                    </a>
                    <button
                      className="btn secondary"
                      disabled={
                        !canEdit || busy || !canSave || saved.includes(o.id)
                      }
                      onClick={() => setReview(o)}
                    >
                      {saved.includes(o.id) ? 'Offer saved' : 'Save offer'}
                    </button>
                  </div>
                  {!canSave && (
                    <small className="muted">
                      Check package size, conditions, currency and retailer link
                      before saving. Saving never changes your cost reference.
                    </small>
                  )}
                </article>
              )
            })}
          </div>
          {offers.length > 2 && (
            <button
              className="text-button"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? 'Show two offers' : `View more (${offers.length})`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
