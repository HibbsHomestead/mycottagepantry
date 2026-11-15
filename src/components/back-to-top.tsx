import { useEffect, useRef, useState, type RefObject } from 'react'
import { ArrowUp } from 'lucide-react'
import './back-to-top.css'

export function scrollableElement(element: HTMLElement) {
  return (
    element.scrollHeight > element.clientHeight + 1 &&
    /(auto|scroll|overlay)/.test(getComputedStyle(element).overflowY)
  )
}
export function BackToTop({
  scope,
}: {
  scope?: RefObject<HTMLElement | null>
}) {
  const target = useRef<HTMLElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [visible, setVisible] = useState(false),
    [focused, setFocused] = useState(false),
    [active, setActive] = useState(true)
  useEffect(() => {
    const update = (event?: Event) => {
      const top = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"]'),
      )
        .filter((el) => el.dataset.state !== 'closed' && !el.hidden)
        .at(-1)
      const root = scope?.current
      const allowed = root ? top === root : !top
      setActive(allowed)
      if (!allowed) {
        setVisible(false)
        return
      }
      const element =
        event?.target === document ? document.scrollingElement : event?.target
      if (
        element instanceof HTMLElement &&
        (root
          ? root.contains(element)
          : !element.closest(
              '[role="dialog"], nav, aside, .floating-assistant-panel, [role="menu"], [role="listbox"]',
            )) &&
        (element === document.scrollingElement || scrollableElement(element))
      )
        target.current = element
      if (
        !target.current?.isConnected ||
        (root && !root.contains(target.current)) ||
        (!root && target.current.closest('[role="dialog"]'))
      ) {
        const candidates = root
          ? [root, ...root.querySelectorAll<HTMLElement>('*')]
          : Array.from(
              document.querySelectorAll<HTMLElement>(
                'main, [data-page-scroll]',
              ),
            )
        target.current =
          candidates
            .filter(scrollableElement)
            .sort((a, b) => b.scrollTop - a.scrollTop)[0] ||
          root ||
          (document.scrollingElement as HTMLElement)
      }
      const current = target.current
      setVisible(
        !!current &&
          current.scrollTop >= Math.max(160, current.clientHeight * 0.9),
      )
    }
    update()
    document.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    const observer = new MutationObserver(() => update())
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'hidden'],
    })
    return () => {
      observer.disconnect()
      document.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [scope])
  // A sticky zero-height dock stays inside the focus trap and outside footer actions.
  const button = (
    <button
      ref={buttonRef}
      type="button"
      hidden={!active || (!visible && !focused)}
      className={`back-to-top ${scope ? 'back-to-top-popup' : ''}`}
      aria-label="Back to top"
      title="Back to top"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onClick={() => {
        target.current?.scrollTo({
          top: 0,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
            .matches
            ? 'instant'
            : 'smooth',
        })
      }}
    >
      <ArrowUp size={18} aria-hidden="true" />
    </button>
  )
  return scope ? (
    active && (visible || focused) ? (
      <div className="back-to-top-dock">{button}</div>
    ) : null
  ) : (
    button
  )
}
