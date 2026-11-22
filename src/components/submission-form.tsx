import {
  createContext,
  useContext,
  useRef,
  useState,
  type ComponentProps,
} from 'react'

const ValidationContext = createContext('')
export function useSubmissionValidation() {
  return useContext(ValidationContext)
}

/** Native validation stays next to its fields; the footer also explains failure. */
export function SubmissionForm({
  onInvalidCapture,
  onInputCapture,
  onSubmit,
  onReset,
  children,
  ...props
}: ComponentProps<'form'>) {
  const [validation, setValidation] = useState('')
  const attempted = useRef(false)
  const pending = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  function validate(form: HTMLFormElement) {
    const fields = Array.from(form.elements).filter(
      (el): el is HTMLInputElement =>
        'validity' in el && !(el as HTMLInputElement).validity.valid,
    )
    for (const element of Array.from(form.elements)) {
      const field = element as HTMLInputElement
      if (!('validity' in field)) continue
      if (!field.validity.valid && !field.hasAttribute('aria-invalid')) {
        field.setAttribute('aria-invalid', 'true')
        field.dataset.nativeInvalid = 'true'
      } else if (field.validity.valid && field.dataset.nativeInvalid) {
        field.removeAttribute('aria-invalid')
        delete field.dataset.nativeInvalid
      }
    }
    setValidation(
      fields.length
        ? 'Review the highlighted fields before submitting. Your changes have been kept.'
        : '',
    )
  }
  return (
    <ValidationContext.Provider value={validation}>
      <form
        {...props}
        aria-busy={submitting || props['aria-busy']}
        onInvalidCapture={(event) => {
          attempted.current = true
          validate(event.currentTarget)
          let parent = (event.target as HTMLElement).parentElement
          while (parent && parent !== event.currentTarget) {
            if (parent instanceof HTMLDetailsElement) parent.open = true
            parent = parent.parentElement
          }
          onInvalidCapture?.(event)
        }}
        onInputCapture={(event) => {
          if (attempted.current) validate(event.currentTarget)
          onInputCapture?.(event)
        }}
        onReset={(event) => {
          attempted.current = false
          for (const field of event.currentTarget.querySelectorAll<HTMLElement>('[data-native-invalid]')) {
            field.removeAttribute('aria-invalid')
            delete field.dataset.nativeInvalid
          }
          setValidation('')
          onReset?.(event)
        }}
        onSubmit={(event) => {
          if (pending.current) {
            event.preventDefault()
            return
          }
          setValidation('')
          const result = onSubmit?.(event) as unknown
          if (
            result &&
            typeof (result as PromiseLike<unknown>).then === 'function'
          ) {
            pending.current = true
            setSubmitting(true)
            void Promise.resolve(result)
              .catch(() => {
                setValidation(
                  'We could not save these changes. Your work is still here. Please try again.',
                )
              })
              .finally(() => {
                pending.current = false
                setSubmitting(false)
              })
          }
        }}
      >
        {children}
      </form>
    </ValidationContext.Provider>
  )
}
