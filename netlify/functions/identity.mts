import type { UserValidateEvent } from '@netlify/functions'

// Identity creates the account and performs its normal email verification.
// Workspace creation separately requires verified identity and explicit consent.
// User-supplied metadata never grants a role or membership.
export default {
  userValidate(_event: UserValidateEvent) {
    return
  },
}
