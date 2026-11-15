import { useEffect, useRef, useState } from 'react'
import { ArrowUp, MessageCircle, Minus, X } from 'lucide-react'
import { SupportHelper } from './support-helper'
import './floating-controls.css'

export function FloatingControls() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const launcher = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const dock = useRef<HTMLElement>(null)
  useEffect(() => {
    const update = () => {
      const viewport = window.visualViewport
      const keyboard = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0
      dock.current?.style.setProperty('--assistant-keyboard', `${keyboard}px`)
      dock.current?.style.setProperty(
        '--assistant-viewport',
        `${viewport?.height || window.innerHeight}px`,
      )
      setScrolled(window.scrollY > Math.max(300, window.innerHeight * 0.75))
      setBlocked(
        !!document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"], dialog[open]',
        ),
      )
    }
    const observer = new MutationObserver(update)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state', 'open'],
    })
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    update()
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [])
  useEffect(() => {
    if (open) panel.current?.focus()
  }, [open])
  function minimize() {
    setOpen(false)
    launcher.current?.focus()
  }
  return (
    <aside
      ref={dock}
      className="floating-controls"
      aria-label="Page assistance"
      hidden={blocked}
    >
      {mounted && (
        <section
          ref={panel}
          tabIndex={-1}
          className="floating-assistant-panel"
          hidden={!open}
          aria-label="Ask Cottage Pantry"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              minimize()
            }
          }}
        >
          <header>
            <strong>Ask Cottage Pantry</strong>
            <button
              type="button"
              aria-label="Minimize assistant"
              onClick={minimize}
            >
              <Minus size={18} />
            </button>
            <button
              type="button"
              aria-label="Close assistant"
              onClick={minimize}
            >
              <X size={18} />
            </button>
          </header>
          <div className="floating-assistant-scroll">
            <SupportHelper />
          </div>
        </section>
      )}
      <button
        type="button"
        className="floating-top"
        aria-label="Back to top"
        hidden={!scrolled || open}
        onClick={() =>
          window.scrollTo({
            top: 0,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
              .matches
              ? 'instant'
              : 'smooth',
          })
        }
      >
        <ArrowUp size={20} />
      </button>
      <button
        type="button"
        ref={launcher}
        className="assistant-launcher"
        aria-label="Open assistant"
        aria-expanded={open}
        onClick={() => {
          setMounted(true)
          setOpen((v) => !v)
        }}
      >
        <MessageCircle size={25} />
        <span className="assistant-tooltip">Ask Cottage Pantry</span>
      </button>
    </aside>
  )
}
