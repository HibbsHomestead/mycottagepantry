/** Server-only release controls. Missing or unrecognized values fail closed. */
export function shoppingSearchEnabled() {
  return globalThis.Netlify?.env.get('SHOPPING_SEARCH_ENABLED') === 'true'
}

/** AI is deferred independently of plans and provider credentials. */
export function aiEnabled() {
  return globalThis.Netlify?.env.get('AI_ENABLED') === 'true'
}

/** Global kill switch; account/workspace grants and spending checks remain mandatory. */
export function packagePhotoPilotApproved() {
  return globalThis.Netlify?.env.get('PACKAGE_PHOTO_PILOT_ENABLED') !== 'false'
}

export function requireAiEnabled() {
  if (!aiEnabled())
    throw new Error(
      'Document reading is unavailable. Paste text or enter details manually.',
    )
}

/** Receipt-only release: does not activate assistant or recipe AI. */
export function receiptReadingEnabled() {
  return globalThis.Netlify?.env.get('RECEIPT_READING_ENABLED') !== 'false'
}
