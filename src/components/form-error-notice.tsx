import { useEffect, useRef, type ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import './form-error-notice.css'
import { useSubmissionValidation } from './submission-form'

/** Persistent submission feedback. Does not steal focus from an invalid field. */
export function FormErrorNotice({
  message,
  children,
}: {
  message?: ReactNode
  children?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const validation = useSubmissionValidation()
  const rawContent = message || children || validation
  const content =
    typeof rawContent === 'string'
      ? safeSubmissionMessage(rawContent)
      : rawContent
  useEffect(() => {
    if (!content || !ref.current) return
    const notice = ref.current
    const bounds = notice.getBoundingClientRect()
    if (bounds.bottom > window.innerHeight || bounds.top < 0)
      notice.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }, [content])
  if (!content) return null
  return (
    <div
      ref={ref}
      tabIndex={0}
      role="alert"
      aria-atomic="true"
      className="form-error-notice"
    >
      <CircleAlert size={18} aria-hidden="true" />
      <div>
        <strong className="sr-only">Unable to submit. </strong>
        {content}
        {message && children ? children : null}
      </div>
    </div>
  )
}

/** Keep business-rule messages useful while hiding transport and server diagnostics. */
export function safeSubmissionMessage(message: string) {
  if (
    /failed to fetch|fetch failed|networkerror|network request failed/i.test(
      message,
    )
  )
    return 'The connection failed. Your changes are still here. Check your connection and try again.'
  if (/\b403\b|forbidden/i.test(message))
    return 'You do not have permission to submit these changes. Your work is still here.'
  if (
    /\bstack\b|\bSQL\b|postgres|api[_ -]?key|access.?token|\bBearer\b|\bat \S+\s*\(|ECONN|ETIMED|Cannot read properties|Unexpected token/i.test(
      message,
    )
  )
    return 'We could not save these changes. Your work is still here. Please try again.'
  return message
}
