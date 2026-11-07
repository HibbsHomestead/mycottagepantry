/** Owner-approved public policy text belongs here; placeholders are never consent. */
export const freeRegistrationPolicy: {
  revision: string
  terms: string
  privacy: string
} = { revision: '', terms: '', privacy: '' }

export function freeRegistrationPolicyReady() {
  return Boolean(
    freeRegistrationPolicy.revision &&
    freeRegistrationPolicy.terms &&
    freeRegistrationPolicy.privacy,
  )
}
