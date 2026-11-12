import { useEffect } from 'react'

/** Visual viewport changes never remount editors or discard their drafts. */
export function useWorkspaceViewport() {
  useEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement
    let frame = 0
    let width = window.innerWidth
    let fullHeight = window.innerHeight
    let keyboardWasOpen = false
    let nav: HTMLElement | null = null
    const measuredNav =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (nav && nav.getBoundingClientRect().height > 0)
              root.style.setProperty(
                '--mobile-nav-height',
                `${nav.getBoundingClientRect().height}px`,
              )
          })
    const findNav = () => {
      if (nav?.isConnected) return
      measuredNav?.disconnect()
      nav = document.querySelector<HTMLElement>('.mobile-bottom-nav')
      if (nav) measuredNav?.observe(nav)
    }
    const additions = new MutationObserver(findNav)
    additions.observe(document.body, { childList: true, subtree: true })
    findNav()
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const height = viewport?.height ?? window.innerHeight
        const top = viewport?.offsetTop ?? 0
        root.style.setProperty('--workspace-view-height', `${height}px`)
        root.style.setProperty('--workspace-view-top', `${top}px`)
        root.style.setProperty(
          '--workspace-view-bottom',
          `${Math.max(0, window.innerHeight - height - top)}px`,
        )
        const field = document.activeElement
        const editing =
          field instanceof HTMLElement &&
          field.matches('input, textarea, select, [contenteditable="true"]')
        if (window.innerWidth !== width) {
          width = window.innerWidth
          fullHeight = window.innerHeight
        }
        fullHeight = Math.max(fullHeight, window.innerHeight, height)
        const keyboard =
          (viewport?.scale ?? 1) <= 1.01 &&
          (window.innerHeight - height > 120 ||
            ((editing || keyboardWasOpen) && fullHeight - height > 120))
        keyboardWasOpen = keyboard
        root.classList.toggle('workspace-keyboard', keyboard)
        const toolbarGap = Math.max(0, window.innerHeight - height - top)
        root.style.setProperty(
          '--workspace-toolbar-bottom',
          `${!keyboard && (viewport?.scale ?? 1) <= 1.01 && toolbarGap <= 120 ? toolbarGap : 0}px`,
        )
        if (editing && keyboard) {
          const rect = field.getBoundingClientRect()
          const delta =
            rect.bottom > top + height - 16
              ? rect.bottom - (top + height - 16)
              : rect.top < top + 16
                ? rect.top - top - 16
                : 0
          if (delta) {
            let container = field.parentElement
            while (container && container !== document.body) {
              if (
                /(auto|scroll)/.test(getComputedStyle(container).overflowY) &&
                container.scrollHeight > container.clientHeight
              )
                break
              container = container.parentElement
            }
            if (container && container !== document.body)
              container.scrollBy({ top: delta })
            else window.scrollBy({ top: delta })
          }
        }
      })
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      cancelAnimationFrame(frame)
      additions.disconnect()
      measuredNav?.disconnect()
      root.style.removeProperty('--mobile-nav-height')
      root.style.removeProperty('--workspace-toolbar-bottom')
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
      root.classList.remove('workspace-keyboard')
      for (const key of ['height', 'top', 'bottom'])
        root.style.removeProperty(`--workspace-view-${key}`)
    }
  }, [])
}
