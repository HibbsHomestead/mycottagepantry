import { useCallback, useEffect, useRef, useState } from 'react'
import type { Item } from '@/lib/domain'
import { searchPhrase } from '@/lib/price-search'
import { readPriceResponse } from './store-price-search'
import { z } from 'zod'
const setupStatus = z.object({
  configured: z.boolean(),
  status: z.enum([
    'Missing configuration',
    'Configured, not tested',
    'Connection successful',
    'Authentication failed',
    'Allowance exhausted',
    'Provider unavailable',
  ]),
  lastTest: z.string().nullable(),
  message: z.string().nullable(),
})
function parseStatus(value: unknown) {
  const parsed = setupStatus.safeParse(value)
  if (!parsed.success)
    throw new Error(
      'Shopping configuration status is unavailable. Check sign-in and the current deployment.',
    )
  return parsed.data
}
export function PriceSearchSetup({ ingredients }: { ingredients: Item[] }) {
  const [status, setStatus] = useState<z.infer<typeof setupStatus> | null>(
      null,
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(true),
    [ingredientId, setIngredientId] = useState(ingredients[0]?.id || ''),
    [confirm, setConfirm] = useState(false)
  const pending = useRef(false)
  const checkStatus = useCallback(async (signal?: AbortSignal) => {
    setChecking(true)
    setError('')
    setStatus(null)
    try {
      const response = await fetch('/api/workspace?priceSearchStatus=1', {
        cache: 'no-store',
        signal,
      })
      const result = parseStatus(await readPriceResponse(response))
      if (!signal?.aborted) setStatus(result)
    } catch (e) {
      if (!signal?.aborted) setError((e as Error).message)
    } finally {
      if (!signal?.aborted) setChecking(false)
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void checkStatus(controller.signal)
    return () => controller.abort()
  }, [checkStatus])
  const test = async () => {
    if (pending.current || checking || !status?.configured || !confirm) return
    const i = ingredients.find((i) => i.id === ingredientId)
    if (!i) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/workspace?priceSearchStatus=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientId,
          query: searchPhrase(i),
          preference: 'both',
          alternativeBrands: false,
          confirmAllowance: confirm,
        }),
      })
      setStatus(parseStatus(await readPriceResponse(response)))
    } catch (e) {
      setStatus(null)
      setError((e as Error).message)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <section
      className="calculation-box"
      aria-label="Shopping price comparison setup"
    >
      <h3>Shopping price comparison</h3>
      <p role="status">
        {status?.status ||
          (error ? 'Status unavailable' : 'Loading integration status…')}
      </p>
      {status?.lastTest && (
        <p>Last explicit test: {new Date(status.lastTest).toLocaleString()}</p>
      )}
      {status?.message && <p>{status.message}</p>}
      <button
        className="btn secondary"
        disabled={checking || busy}
        onClick={() => void checkStatus()}
      >
        {checking ? 'Checking configuration…' : 'Refresh configuration status'}
      </button>
      <p>
        Configuration checks read the current server deployment and use no
        provider requests. A new deployment needs a new explicit test.
      </p>
      <p>
        Uses SerpApi Google Shopping. Add SERPAPI_API_KEY to the site’s
        server-side Netlify Functions environment and redeploy. SerpApi is
        separately billed; coverage, location prices and retailer details vary.
        Never paste a key into this app.
      </p>
      <p>
        <a
          href="https://serpapi.com/pricing"
          target="_blank"
          rel="noopener noreferrer"
        >
          Provider plans and API allowance
        </a>
      </p>
      <label className="field">
        <span>Ingredient for test search</span>
        <select
          value={ingredientId}
          onChange={(e) => setIngredientId(e.target.value)}
        >
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={confirm}
          onChange={(e) => setConfirm(e.target.checked)}
        />
        This explicit test uses API allowance (up to three provider requests).
        It does not change ingredient prices or stock.
      </label>
      <p>
        One request searches Google Shopping; up to two relevant listings may
        need a separate request for retailer links. Listings with direct store
        links skip that step. There are no automatic searches or retries.
      </p>
      <button
        className="btn secondary"
        disabled={
          !status?.configured || !confirm || !ingredientId || busy || checking
        }
        onClick={() => void test()}
      >
        {busy ? 'Testing connection…' : 'Test shopping search'}
      </button>
      {!ingredients.length && <p>Add an ingredient before running a test.</p>}
      {error && (
        <p role="alert" className="warning-text">
          {error}
        </p>
      )}
    </section>
  )
}
