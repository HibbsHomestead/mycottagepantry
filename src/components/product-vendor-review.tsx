import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import type { Item } from '@/lib/domain'
import { readImportResponse } from '@/lib/product-import-response'
import {
  matchProductVendors,
  suggestedVendorName,
  vendorDomain,
} from '@/lib/product-vendors'

const vendorList = z.array(
  z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
    })
    .passthrough(),
)

export function ProductVendorReview({
  name,
  sourceUrl,
  choice,
  onChoose,
  onVendorsChange,
}: {
  name: string
  sourceUrl: string
  choice: Item | null
  onChoose: (vendor: Item | null) => void
  onVendorsChange?: (vendors: Item[]) => void
}) {
  const [vendors, setVendors] = useState<Item[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [retry, setRetry] = useState(0)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newName, setNewName] = useState(suggestedVendorName(name, sourceUrl))
  const callbacks = useRef({ onChoose, onVendorsChange })
  callbacks.current = { onChoose, onVendorsChange }
  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    setError('')
    callbacks.current.onChoose(null)
    void (async () => {
      try {
        const response = await fetch('/api/workspace?productVendors=1', {
          credentials: 'same-origin',
          signal: controller.signal,
        })
        const data = await readImportResponse(response)
        const list = vendorList.parse(data.vendors)
        if (controller.signal.aborted) return
        setVendors(list)
        const matched = matchProductVendors(list, name, sourceUrl)
        callbacks.current.onChoose(matched.length === 1 ? matched[0] : null)
        callbacks.current.onVendorsChange?.(list)
        setStatus('ready')
      } catch {
        if (controller.signal.aborted) return
        setStatus('error')
        setError(
          'Could not load oven vendors. Retry before selecting or adding a vendor.',
        )
      }
    })()
    return () => controller.abort()
  }, [name, sourceUrl, retry])
  const matches = matchProductVendors(vendors, name, sourceUrl)
  const visible = (vendor: Item) =>
    vendor.id === choice?.id ||
    `${vendor.name} ${vendor.website || ''}`
      .toLowerCase()
      .includes(search.toLowerCase())
  const label = (vendor: Item) =>
    `${vendor.name}${vendor.website ? ` · ${vendorDomain(vendor.website)}` : ''} · ${vendor.id.slice(0, 8)}`
  async function addVendor() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/workspace?productVendors=1', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          website: `https://${vendorDomain(sourceUrl)}`,
        }),
      })
      const data = await readImportResponse(response)
      const list = vendorList.parse(data.vendors)
      const vendor = list.find((v) => v.id === data.vendor?.id)
      if (!vendor)
        throw new Error('The vendor was not returned. Reload the vendor list.')
      setVendors(list)
      onChoose(vendor)
      onVendorsChange?.(list)
      setAdding(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="product-vendor-review">
      {status === 'loading' && <p role="status">Loading oven vendors…</p>}
      {error && <p role="alert">{error}</p>}
      {status === 'error' && (
        <button
          type="button"
          className="btn secondary"
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry vendor list
        </button>
      )}
      {status === 'ready' && (
        <>
          <p>
            {matches.length > 1
              ? 'Multiple vendors match. Choose the existing record to use.'
              : matches.length === 1
                ? `Matched existing vendor: ${matches[0].name}`
                : `No matching vendor. Suggested new vendor: ${suggestedVendorName(name, sourceUrl)}.`}
          </p>
          <label className="field">
            <span>Search oven vendors</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Existing vendor</span>
            <select
              value={choice?.id || ''}
              disabled={saving}
              onChange={(e) =>
                onChoose(vendors.find((v) => v.id === e.target.value) || null)
              }
            >
              <option value="">Choose a vendor</option>
              <optgroup label="Matched existing vendors">
                {matches.filter(visible).map((v) => (
                  <option value={v.id} key={v.id}>
                    {label(v)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Other existing vendors">
                {vendors
                  .filter(
                    (v) =>
                      !matches.some((match) => match.id === v.id) && visible(v),
                  )
                  .map((v) => (
                    <option value={v.id} key={v.id}>
                      {label(v)}
                    </option>
                  ))}
              </optgroup>
            </select>
          </label>
          <button
            type="button"
            className="btn secondary"
            disabled={saving}
            onClick={() => setAdding(!adding)}
          >
            Add new vendor
          </button>
          {adding && (
            <div className="product-vendor-add">
              <label className="field">
                <span>New vendor name</span>
                <input
                  value={newName}
                  maxLength={200}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
              <p>
                Creates a vendor only when confirmed here. Existing matches are
                reused.
              </p>
              <button
                type="button"
                className="btn secondary"
                disabled={saving || !newName.trim()}
                onClick={addVendor}
              >
                {saving ? 'Saving vendor…' : 'Confirm add vendor'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
