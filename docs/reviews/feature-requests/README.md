# Shared Feature Requests board

Cottage Pantry’s workspace settings and platform administration now have a gated entry to a shared, signed-in board. Customers can browse, submit, vote, follow, comment, and report content. Platform administrators can triage new requests, publish status history, merge duplicates, moderate reports, and export requests and vote totals. Board records are deliberately shared; recipes, products, labels, sales, and other business records remain outside the board.

## Review and activation

The [SQL draft](../../../db/review/feature-requests.sql) and [Drizzle schema](../../../db/review/schema.ts) are outside the automatic migration configuration. The board API fails closed in production and requires an explicit review switch even in development or a Deploy Preview. The switch was not set, and no persistent database was changed. After approval, the normal migration review must enroll the schema, confirm database-role privileges and the Identity/Blob runtime integration on an authorized isolated environment, and separately review production activation. Do not run the draft against a customer database to verify it.

## Privacy and audit

- The public API returns an opted-in nickname or “Anonymous baker.” It does not retrieve account profile fields, expose voter identities, or use workspace data. The customer path uses the shared Identity verification service; moderation uses a recently verified platform-admin session, not a workspace role.
- Screenshots are optional and shared with signed-in users. They are validated and re-encoded to strip metadata. This cannot remove personal information visible in the pixels. The form provides a warning and does not automatically attach workspace data.
- Status changes create inbox updates only for people who opted in and voted or followed. The existing support email outbox is ticket-specific, so the board does not enqueue support mail or send email.
- Moderators can anonymize board activity after confirming deletion through the existing Identity provider. The board retains vote counts and reviewed redacted text, removes original text when no redaction is supplied, and removes the board’s account links and uploads. This is a manual follow-up; there is no automatic account-deletion workflow. Review any mentions in other users’ posts separately. After anonymization, only aggregate totals remain, so a subsequent merge cannot identify duplicate votes that were already anonymized on both requests.

## Rendered fixture evidence

- [Customer board on desktop](board-1440.png)
- [Customer board on a phone](board-390.png)
- [Moderator status form](moderation-1440.png)

Chromium exercised keyboard voting, live duplicate suggestions, submission on desktop and phone, and the moderator’s required decline reason. It used fixture responses. Separate API tests ran the reviewed SQL against disposable in-memory Postgres, with mocked Identity and Blobs, to exercise projection and permissions, rate limits, notifications, merge, moderation, screenshot metadata stripping, and anonymization. Live platform authentication, persistent screenshot storage, and a deployed revision were not verified.
