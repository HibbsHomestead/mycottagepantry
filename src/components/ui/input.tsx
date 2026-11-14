import * as React from 'react'
import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      inputMode={
        props.inputMode ??
        (type === 'number'
          ? props.step === 1 || props.step === '1'
            ? 'numeric'
            : 'decimal'
          : type === 'email'
            ? 'email'
            : type === 'tel'
              ? 'tel'
              : undefined)
      }
      autoComplete={
        props.autoComplete ?? (type === 'email' ? 'email' : undefined)
      }
      enterKeyHint={
        props.enterKeyHint ?? (type === 'search' ? 'search' : 'next')
      }
      data-slot="input"
      className={cn(
        'min-h-[var(--control-height)] w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
