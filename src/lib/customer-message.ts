/** Keep useful field validation while filtering transport/provider diagnostics.
 * Server handlers must apply this before serializing unexpected failures too. */
export function customerMessage(
  value: unknown,
  fallback = 'We couldn’t complete that request. Please try again. Contact support if it continues.',
) {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : ''
  if (/SIGN_IN_REQUIRED|SESSION_EXPIRED|401\b/.test(message))
    return 'Please sign in to continue.'
  if (/EMAIL_UNVERIFIED|email.*(?:not confirmed|unverified)/i.test(message))
    return 'Check your email to finish setting up your account.'
  if (
    !message ||
    message.length > 600 ||
    /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b|stack|Cannot read properties|Cannot access|Unexpected token|ECONN|ETIMED|syntax error|\bat \S+\s*\(|SQL|postgres|constraint|relation .*exist|provider|api[_ -]?key|access.?token|\bBearer\b|https?:\/\/|\{\s*"|failed to fetch|fetch failed|networkerror/i.test(
      message,
    )
  )
    return fallback
  return message
}
