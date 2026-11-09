import { useEffect } from 'react'

/** Visual viewport changes never remount editors or discard their drafts. */
export function useWorkspaceViewport() {
  useEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement
    let frame = 0
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
        root.classList.toggle(
          'workspace-keyboard',
          editing && window.innerHeight - height > 120,
        )
        if (editing && field?.closest('[role="dialog"]'))
          field.scrollIntoView({ block: 'nearest' })
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
