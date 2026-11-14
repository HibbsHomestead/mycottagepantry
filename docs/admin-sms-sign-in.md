# Optional legacy text-message verification

Text-message verification remains optional and disabled unless its existing server configuration enables it. Removing public-key authentication does not require adding Twilio, enabling messaging, or purchasing a service. The standard sensitive-action panel uses an enrolled authenticator/recovery code, or password confirmation for an account without an enrolled authenticator.

Existing server-side text verification retains rate limits, provider approval, destination binding and session rotation. Optional phone setup/removal requires recent server-issued administrator verification; setup also requires a confirmed code to the new number within its session-bound expiry. No browser public-key operation is used. Stored encrypted phone records are preserved.

See [Administrator access](admin-portal.md) for the supported password and authenticator transition, and [production verification](admin-production-activation.md) for acceptance checks. Earlier instructions requiring an existing device credential for phone enrollment no longer apply.
