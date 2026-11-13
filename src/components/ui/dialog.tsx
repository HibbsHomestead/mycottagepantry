'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import './ingredient-modal.css'
import './inventory-overlay.css'
import '../mobile-usability.css'
import './dialog-position.css'
import { XIcon } from 'lucide-react'
import * as DialogPrimitive from '@radix-ui/react-dialog'

import { Button } from '@/components/ui/button'

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  presentation = 'modal',
  ingredient = false,
  positioning = 'center',
  overlayClassName,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  presentation?: 'modal' | 'detail' | 'page' | 'inventory' | 'scanner'
  ingredient?: boolean
  positioning?: 'center' | 'css'
  overlayClassName?: string
}) {
  const bounded = presentation !== 'page'
  const returnFocus = React.useRef<HTMLElement | null>(null)
  const [viewport, setViewport] = React.useState<React.CSSProperties>({})
  React.useEffect(() => {
    if (!bounded) return
    const view = window.visualViewport
    const update = () =>
      setViewport({
        '--inventory-view-top': `${view?.offsetTop ?? 0}px`,
        '--inventory-view-left': `${view?.offsetLeft ?? 0}px`,
        '--inventory-view-width': `${view?.width ?? window.innerWidth}px`,
        '--inventory-view-height': `${view?.height ?? window.innerHeight}px`,
      } as React.CSSProperties)
    update()
    view?.addEventListener('resize', update)
    view?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      view?.removeEventListener('resize', update)
      view?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [bounded])
  return (
    <DialogPortal data-slot="dialog-portal">
      {/* Page editors use document scrolling. Overlay would lock it via RemoveScroll. */}
      {presentation !== 'page' && (
        <DialogOverlay className={overlayClassName} />
      )}
      <DialogPrimitive.Content
        key="content"
        data-slot="dialog-content"
        data-presentation={presentation}
        data-positioning={positioning}
        data-mobile-overlay={bounded ? 'true' : undefined}
        className={cn(
          presentation !== 'modal'
            ? 'fixed z-50 flex flex-col border bg-card shadow-lg outline-none'
            : 'fixed z-50 grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-lg border bg-card p-6 shadow-lg outline-none sm:max-w-lg',
          ingredient && 'ingredient-modal-shell',
          className,
        )}
        {...props}
        style={bounded ? { ...viewport, ...props.style } : props.style}
        onOpenAutoFocus={(event) => {
          if (bounded)
            returnFocus.current = document.activeElement as HTMLElement
          props.onOpenAutoFocus?.(event)
          // On touch screens, opening a dialog must not summon the keyboard.
          if (
            bounded &&
            !event.defaultPrevented &&
            window.matchMedia?.('(max-width: 1024px), (pointer: coarse)')
              ?.matches
          ) {
            event.preventDefault()
            const content = event.currentTarget as HTMLElement
            const action = content.querySelector<HTMLElement>(
              'button:not([disabled]), [href]',
            )
            ;(action || content).focus({ preventScroll: true })
          }
        }}
        onCloseAutoFocus={(event) => {
          props.onCloseAutoFocus?.(event)
          if (
            bounded &&
            !event.defaultPrevented &&
            returnFocus.current?.isConnected
          ) {
            event.preventDefault()
            returnFocus.current.focus({ preventScroll: true })
          }
        }}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export function IngredientFormBody({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  return enabled ? (
    <div className="ingredient-modal-body">{children}</div>
  ) : (
    <>{children}</>
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
