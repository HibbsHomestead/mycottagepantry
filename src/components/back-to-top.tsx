import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { ArrowUp } from 'lucide-react'
import './back-to-top.css'

export function scrollableElement(element: HTMLElement) {
  return (
    element.scrollHeight > element.clientHeight + 1 &&
    /(auto|scroll|overlay)/.test(getComputedStyle(element).overflowY)
  )
}
function keepButtonClear(
  button: HTMLButtonElement | null,
  root?: HTMLElement | null,
) {
  if (!button || button.hidden) return
  const rect = button.getBoundingClientRect()
  if (!rect.width) return
  const base = {
    left:
      rect.left -
      (parseFloat(button.style.getPropertyValue('--back-top-x')) || 0),
    top:
      rect.top -
      (parseFloat(button.style.getPropertyValue('--back-top-y')) || 0),
  }
  const bounds = root?.getBoundingClientRect()
  const left = Math.max(8, bounds?.left || 0),
    top = Math.max(8, bounds?.top || 0)
  const controls = Array.from(
    (root || document.body).querySelectorAll<HTMLElement>(
      'button,a,input,select,textarea,summary,[role="button"],[contenteditable="true"]',
    ),
  )
    .filter(
      (el) => el !== button && getComputedStyle(el).visibility !== 'hidden',
    )
    .map((el) => el.getBoundingClientRect())
    .filter(
      (r) =>
        r.width > 0 &&
        r.height > 0 &&
        r.right > left &&
        r.left < innerWidth &&
        r.bottom > top &&
        r.top < innerHeight,
    )
  const clear = (x: number, y: number) =>
    controls.every(
      (r) =>
        base.left + x + rect.width + 6 <= r.left ||
        base.left + x - 6 >= r.right ||
        base.top + y + rect.height + 6 <= r.top ||
        base.top + y - 6 >= r.bottom,
    )
  for (let y = 0; base.top + y >= top + 8; y -= 46) {
    for (const x of [0, left + 8 - base.left]) {
      if (clear(x, y)) {
        button.style.setProperty('--back-top-x', x + 'px')
        button.style.setProperty('--back-top-y', y + 'px')
        return
      }
    }
  }
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
              '[role="dialog"], nav, aside, [role="menu"], [role="listbox"]',
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
      keepButtonClear(buttonRef.current, root)
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
  useLayoutEffect(() => {
    keepButtonClear(buttonRef.current, scope?.current)
  }, [scope, visible, active])
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
