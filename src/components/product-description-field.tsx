import { FormErrorNotice } from './form-error-notice'
import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { Item, Workspace } from '@/lib/domain'
import { descriptionSource } from '@/lib/product-description'
import { supportRequest } from '@/lib/support-client'
import { TooltipProvider } from './ui/tooltip'
import { ActionTip } from './action-tip'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import './product-description-field.css'

type Props = {
  product: Item
  workspace: Workspace
  change: (key: string, value: string) => void
  disabled?: boolean
  field?: string
}
export function ProductDescriptionField(props: Props) {
  return <DescriptionDraft key={props.product.id || 'new'} {...props} />
}
function DescriptionDraft({
  product,
  workspace,
  change,
  disabled = false,
  field = 'description',
}: Props) {
  const id = useId()
  const source = JSON.stringify(descriptionSource(product, workspace))
  const value = String(product[field] || '')
  const identity = product.id || 'new'
  const latest = useRef({ source, identity })
  useLayoutEffect(() => {
    latest.current = { source, identity }
  }, [source, identity])
  const controller = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState('')
  const [snapshot, setSnapshot] = useState('')
  const [reviewed, setReviewed] = useState('')
  const [error, setError] = useState('')
  const [restore, setRestore] = useState<{
    before: string
    applied: string
  } | null>(null)
  function cancel() {
    sequence.current++
    controller.current?.abort()
    controller.current = null
    setBusy(false)
    setOpen(false)
  }
  useEffect(
    () => () => {
      controller.current?.abort('Editor closed')
    },
    [],
  )
  async function generate() {
    if (controller.current || disabled) return
    const request = new AbortController()
    controller.current = request
    const token = ++sequence.current
    const original = { ...latest.current }
    setOpen(true)
    setBusy(true)
    setError('')
    setReviewed('')
    const timeout = window.setTimeout(() => request.abort(), 25000)
    try {
      const result = await supportRequest('?ai=1', {
        method: 'POST',
        signal: request.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'product-description',
          productSource: JSON.parse(original.source),
        }),
      })
      if (
        token !== sequence.current ||
        request.signal.aborted ||
        latest.current.identity !== original.identity
      )
        return
      if (typeof result.description !== 'string' || !result.description.trim())
        throw new Error('No description returned. Your draft is unchanged.')
      setProposal(result.description)
      setSnapshot(original.source)
    } catch (e) {
      if (
        token !== sequence.current ||
        request.signal.reason === 'Editor closed'
      )
        return
      setError(
        request.signal.aborted
          ? 'Generation timed out. Your draft is unchanged. Try again when ready.'
          : e instanceof Error
            ? e.message
            : 'AI is unavailable. Your draft is unchanged.',
      )
    } finally {
      window.clearTimeout(timeout)
      if (token === sequence.current) {
        controller.current = null
        setBusy(false)
      }
    }
  }
  const outdated = snapshot !== source
  return (
    <section className="product-description-field">
      <div className="description-label-row">
        <label htmlFor={id}>
          Product description <small>(customer-facing)</small>
        </label>
        <TooltipProvider>
          <ActionTip label="Generate description">
            <button
              type="button"
              className="btn secondary responsive-action"
              aria-label="Generate description"
              disabled={disabled || busy || !product.name?.trim()}
              onClick={generate}
            >
              <Sparkles size={18} aria-hidden="true" />
              <span className="responsive-action-label">
                Generate description
              </span>
            </button>
          </ActionTip>
        </TooltipProvider>
      </div>
      <textarea
        id={id}
        rows={4}
        maxLength={3000}
        value={value}
        disabled={disabled}
        onChange={(e) => change(field, e.target.value)}
      />
      <p className="form-hint">
        For future customer use. Saving does not publish this text. Keep
        required ingredient and allergen labeling separate.
      </p>
      {restore && (
        <button
          type="button"
          className="btn secondary"
          disabled={disabled || value !== restore.applied}
          onClick={() => {
            change(field, restore.before)
            setRestore(null)
          }}
        >
          Restore previous description
        </button>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) cancel()
        }}
      >
        <DialogContent
          className="description-review"
          onEscapeKeyDown={(e) => e.stopPropagation()}
        >
          <DialogTitle>Review product description</DialogTitle>
          <DialogDescription>
            Check every claim against your product. Use description replaces the
            current draft text only. Choose Save in the product editor to
            persist it.
          </DialogDescription>
          {busy && <p role="status">Generating description…</p>}
          {error && <FormErrorNotice message={error} />}
          <label className="field">
            Proposed description
            <textarea
              rows={7}
              maxLength={3000}
              value={proposal}
              onChange={(e) => setProposal(e.target.value)}
              disabled={busy}
            />
          </label>
          {proposal && outdated && (
            <label className="description-stale">
              <input
                type="checkbox"
                checked={reviewed === source}
                onChange={(e) => setReviewed(e.target.checked ? source : '')}
              />
              Product details changed. I have reviewed this suggestion against
              the current details.
            </label>
          )}
          <div className="description-review-actions">
            <button type="button" className="btn secondary" onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={generate}
            >
              <Sparkles size={18} />
              Generate again
            </button>
            <button
              type="button"
              className="btn"
              disabled={
                disabled ||
                busy ||
                !proposal.trim() ||
                (outdated && reviewed !== source)
              }
              onClick={() => {
                setRestore({ before: value, applied: proposal })
                change(field, proposal)
                cancel()
              }}
            >
              Use description
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
