# Admin password + text-message (SMS) sign-in

Status (November 5, 2026): implemented and covered by automated tests. **Off in every environment** until the owner sets up Twilio Verify and enables it. No texts have been sent and no charges have been incurred. Desktop access is **not complete** until the owner reaches the protected dashboard with password + SMS.

## Provider

Netlify Identity has no SMS or phone-verification feature, so the second factor uses **Twilio Verify** (owner-approved, credentials held). Twilio generates, delivers, expires (10 minutes on Twilio's side) and attempt-limits the codes. Fraud Guard blocks SMS pumping. In the US, Verify sends from Twilio-managed, pre-registered senders, so no 10DLC or toll-free registration is needed. Pricing is roughly $0.05 per successful verification plus the per-message SMS fee; see twilio.com/verify/pricing for exact amounts.

### Owner setup (exact steps)

1. Create or upgrade a Twilio account to a paid account. Trial accounts can text only numbers you have verified with Twilio.
2. Console → Verify → Services → create a service named "Cottage Pantry Admin". Keep the default code length (6). Leave Fraud Guard on.
3. Console → Messaging → Settings → Geo permissions: allow **United States** and **Canada** only.
4. Console → Account → API keys → create a **Standard** API key.
5. In Netlify (project env vars, Production context, marked secret), set:
   - `TWILIO_API_KEY_SID` (starts with `SK`)
   - `TWILIO_API_KEY_SECRET`
   - `TWILIO_VERIFY_SERVICE_SID` (starts with `VA`)
   - `ADMIN_SMS_ENABLED` = `true`
   - `ADMIN_MFA_ENCRYPTION_KEY` already exists; it also encrypts the stored phone number.
6. Trigger a new production deploy so the function picks up the values.

Optional: security-change emails are sent only when outbound support email is already approved (`SUPPORT_EMAIL_ENABLED`, Postmark token, verified sender, production). Otherwise the change is recorded in the admin audit log and the UI says that no email was sent.

## How it works

**Enrollment (phone admin session only).** In an authenticated session, go to Text-message sign-in → Set up → verify your existing passkey. A 10-minute setup window opens, bound to that session. Enter a +1 mobile number. A code is texted to it, and the number becomes active only once that code is confirmed. The number is stored AES-256-GCM-encrypted and bound to the admin identity. Only a masked form (`+1 •••-•••-0147`) is ever shown or audited. Other admin sessions are revoked when the number is set or changed. Changing or removing the number needs a fresh passkey check again, so a session that signed in with SMS cannot replace the number, remove the passkey, or change recovery methods by itself.

**Sign-in.** Email + password. The server validates the credentials and the enabled grant, and creates only a 5-minute pre-MFA session. Wrong passwords and non-admin accounts get the same response. When a phone is enrolled, "Password + text-message code" is pre-selected. It shows the masked number and a "Text me a code" button, and never calls WebAuthn. After the code is verified, the session rotates into a 30-minute admin session (`mfa_method = sms`). "Use a passkey instead" stays available.

**Safeguards.**
- Each code is checked against this pending session's own Twilio verification ID. A newer text for another pending sign-in invalidates the older one.
- Codes are single-use: approved verifications are rejected on reuse.
- Each sign-in allows at most 5 code attempts, 3 texts, and one resend every 30 seconds.
- Hourly caps: 6 texts per destination (keyed HMAC, never the number), 8 per account, and 8 per source IP. These are in addition to the existing login and MFA limits.
- Only US/Canada numbers are accepted.
- The UI distinguishes three provider outcomes: request accepted, delivery or provider failure (invalid number, landline, fraud/geo block, provider limit, misconfiguration, unreachable), and code result (incorrect, expired/used/superseded, too many attempts).
- Codes, full numbers and credentials are never logged or audited.
- Existing origin/CSRF checks, the host-only cookie, grant epoch checks and logout revocation all apply.

## Lost phone / texts failing

Texts failing never skip verification. Use the existing passkey, or an enrolled authenticator or recovery code. If you can use none of them, use the audited owner-verified recovery procedure (see `admin-passkey-investigation.md`). Removing or replacing the number then needs a fresh passkey check from the recovered session.

## Acceptance status

| Check | Status |
| --- | --- |
| Enrollment only after fresh passkey + confirmed code; no enrollment from login/pre-MFA/SMS-only sessions | Automated (fake Twilio) |
| Incorrect, expired, reused, superseded codes; attempt, resend, cooldown and destination caps | Automated |
| Provider failures (fraud/geo block, network, misconfiguration); switched-off sends nothing | Automated |
| Revoked grant/epoch; logout invalidates; passkey still works after SMS enrollment | Automated |
| No codes, full numbers or secrets in audit/limits rows | Automated |
| Real text delivery to the owner | **Pending owner setup** |
| Desktop Firefox password + SMS to the protected dashboard | **Pending owner test** |
