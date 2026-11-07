import * as Tabs from '@radix-ui/react-tabs'
import { useSyncExternalStore, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import './add-item-dialog.css'
import './product-editor.css'

export type EditorTab = {
  id: string
  label: string
  content: ReactNode
}

const MOBILE_QUERY = '(max-width: 760px)'
function subscribe(callback: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const query = window.matchMedia(MOBILE_QUERY)
  query.addEventListener?.('change', callback)
  return () => query.removeEventListener?.('change', callback)
}
/** True on narrow screens; the summary then moves into its owning tab. */
export function useCompactEditor() {
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== 'undefined' && !!window.matchMedia
        ? window.matchMedia(MOBILE_QUERY).matches
        : false,
    () => false,
  )
}

/**
 * Shared, type-aware Add/Edit shell based on the approved Product & Pricing
 * popup: compact title row with a small photo preview, compact tabs, the
 * main form on the left, a summary panel on the right (moved into its tab on
 * mobile) and Cancel / Save always in view. Every tab stays mounted, so a tab
 * change never saves, resets values or discards uploads, and the whole form is
 * validated and saved together. The dialog never switches to a full page.
 */
export function ItemEditorShell({
  title,
  description,
  photo,
  photoTab,
  tabs,
  tab,
  onTab,
  errorTabs,
  summary,
  summaryLabel = 'Summary',
  summaryTab,
  disabled,
  error,
  notice,
  busy,
  submitDisabled,
  submitLabel,
  cancel,
  onSubmit,
  sectionsLabel = 'Item sections',
}: {
  title: string
  description: ReactNode
  /** Small photo preview beside the title; opens `photoTab` when selected. */
  photo?: ReactNode
  photoTab?: string
  tabs: EditorTab[]
  tab: string
  onTab: (tab: string) => void
  errorTabs: string[]
  summary?: ReactNode
  summaryLabel?: string
  /** Tab that holds the summary on mobile. */
  summaryTab?: string
  disabled: boolean
  error?: string
  notice?: ReactNode
  busy: boolean
  submitDisabled: boolean
  submitLabel: string
  cancel: () => void
  onSubmit: (form: HTMLFormElement) => void
  sectionsLabel?: string
}) {
  const compact = useCompactEditor()
  const summaryPanel = summary ? (
    <aside className="item-editor-summary" aria-label={summaryLabel}>
      {summary}
    </aside>
  ) : null
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancel()
      }}
    >
      <DialogContent
        className="app-dialog product-editor-dialog item-editor-dialog"
        onEscapeKeyDown={(event) => {
          // Escape first closes an open list (e.g. category search), not the editor.
          if (
            (event.target as HTMLElement | null)?.getAttribute?.(
              'aria-expanded',
            ) === 'true'
          )
            event.preventDefault()
        }}
      >
        <DialogHeader className="product-editor-header item-editor-header">
          {photo && (
            <button
              type="button"
              className="item-editor-title-photo"
              aria-label="Open Images & Labels"
              title="Open Images & Labels"
              onClick={() => photoTab && onTab(photoTab)}
            >
              {photo}
            </button>
          )}
          <div className="item-editor-title-text">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
        </DialogHeader>
        <form
          noValidate
          className="product-editor-form"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit(event.currentTarget)
          }}
        >
          <div className="product-editor-body">
            <fieldset disabled={disabled} className="product-editor-fields">
              <Tabs.Root value={tab} onValueChange={onTab}>
                <Tabs.List
                  className="add-item-tabs product-editor-tabs"
                  aria-label={sectionsLabel}
                >
                  {tabs.map(({ id, label }) => (
                    <Tabs.Trigger key={id} value={id}>
                      {label}
                      {errorTabs.includes(id) && (
                        <span
                          className="add-item-tab-error"
                          aria-label="has errors"
                        >
                          !
                        </span>
                      )}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
                <div
                  className={`item-editor-layout${summaryPanel && !compact ? ' has-summary' : ''}`}
                >
                  <div className="item-editor-main">
                    {tabs.map(({ id, content }) => (
                      <Tabs.Content
                        key={id}
                        value={id}
                        forceMount
                        hidden={tab !== id}
                        data-product-tab={id}
                        className="product-editor-panel"
                      >
                        {content}
                        {compact && id === summaryTab && summaryPanel}
                      </Tabs.Content>
                    ))}
                  </div>
                  {!compact && summaryPanel}
                </div>
              </Tabs.Root>
            </fieldset>
          </div>
          <footer className="product-editor-actions">
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {notice}
            <div className="product-editor-buttons">
              <button
                type="button"
                className="btn secondary"
                onClick={cancel}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="btn" disabled={submitDisabled}>
                {busy ? 'Saving…' : submitLabel}
              </button>
            </div>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Validate every mounted tab before saving. Returns the tabs holding invalid
 * fields (first one first) and focuses the first invalid field after the
 * caller opens its tab.
 */
export function invalidEditorTabs(form: HTMLFormElement, fallback: string) {
  const invalid = Array.from(
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      'input,select,textarea',
    ),
  ).filter((field) => !field.validity.valid)
  const sections = [
    ...new Set(
      invalid.map(
        (field) =>
          field.closest<HTMLElement>('[data-product-tab]')?.dataset
            .productTab || fallback,
      ),
    ),
  ]
  if (invalid.length)
    requestAnimationFrame(() => {
      invalid[0].focus()
      invalid[0].reportValidity()
    })
  return sections
}
