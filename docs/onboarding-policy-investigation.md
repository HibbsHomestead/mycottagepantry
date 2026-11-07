# Registration blocked before business creation

The reported attempt stopped at legal-policy publication. Authentication signup
succeeded, and the provider confirmed the reported iCloud account. Creating a
business remained unavailable because the deployed application bundled empty
Terms, Privacy, and revision strings. This investigation did not change the
reported account, any existing business, inventory, or history.

## Evidence and environment

The reported page was on `https://mycottagepantry.com/onboarding`, with the
`cottage-mercantile` preference and access reference
`740c4924-13b5-4d2b-8289-94cb19e609d4`. Site metadata identified the production
`main` deployment `6aef9c85e78b2d6a0f638128`, published at
`2026-11-07T21:48:53.951Z`, commit
`207292325bc7b73158f4d173474234f102dfd034`.

| Read-only check | Sanitized result | Scope |
| --- | --- | --- |
| Single-email Identity lookup | HTTP 200; email provider; account confirmed at `2026-11-07T19:22:42Z` | Actual production site's Identity instance |
| Registration readiness | HTTP 200; public signup enabled; policy acceptance and activation false; blocker required approved Terms and Privacy | Actual production URL |
| Saved signup preference | One identity-bound `cottage-mercantile` intent; created `19:22:14.874Z`, updated `19:22:43.291Z` on November 7 | Available read-only investigation database branch |
| Application users/memberships | Zero for the looked-up Identity ID | Available read-only investigation database branch |
| Owned businesses | Zero for that Identity ID | Available read-only investigation database branch |
| Registration drafts | Zero for that Identity ID | Available read-only investigation database branch |

The business-data checks were scoped to the looked-up Identity ID, with the
same transaction-local identity setting used by the application. The available
database connection belonged to the investigation/preview environment; these
counts did not independently establish current production database counts.
No production user session or authenticated admin browser was available. An
anonymous account-access probe returning `signed_out` described the probe,
not the user's browser. Historical server logs for the supplied access reference
were unavailable.

The ordinary business form rendered only after account access resolved to a
verified identity with no workspace. Binding a saved plan intent also required
a verified authenticated session. These source conditions and the saved intent
corroborated progress past verification at the time of the attempt; they did not
prove the user's session remained valid later.

Signup used Netlify Identity on the same site as the app admin host. Onboarding
and admin handlers both used the site's Netlify Database connection. No
separate provider or database override was found in these paths. Production
business queries used the production database, while deploy previews used a
separate branch. The public and admin hosts both returned HTTP 200 for the app
version endpoint with the same version fingerprint. No evidence implicated
Cloudflare.

## Exact stopping condition

The original button condition was `busy || !ready || !accepted`.
`ready` required nonempty owner-approved revision, Terms, and Privacy text.
All three source strings were empty. Consequently `ready` was false, the
consent checkbox was hidden, and `accepted` could never become true. The live
readiness response confirmed that publication was unavailable. The server
separately rejected creation with `POLICY_NOT_READY`, so removing a label or
button condition would not fix the underlying requirement.

Business name, uppercase country code, a valid timezone, and measurement
preference were separately validated. Account verification and membership
checks ran before ordinary setup. The selected paid plan was only a saved
preference, not a prerequisite to legal acceptance or proof of paid access.
No evidence showed an in-flight business submission as the reported blocker.

The evidence supported **business creation not completed**, with **intentional
admin filtering of incomplete onboarding**. It ruled out a missing Identity
account and pending email confirmation for the reported account. It did not
establish a provisioning transaction failure or an environment mismatch.

## Why the app admin list omitted the account

Application `users` rows represented business memberships, not standalone
authentication profiles. The Identity signup hook did not provision an app
profile or business. Successful business creation transactionally inserted the
business, its Owner membership, business settings, consent revision, and units.

The admin Accounts list aggregated members and owners of completed customer
businesses. It excluded demos and test workspaces, and did not enumerate
provider-only registrations. Search used stable Identity IDs; provider emails
and names were not synchronized. Absence from this list therefore did not
indicate failed authentication. The list now stated that limitation explicitly.

A separate **Pending registrations** view was proposed, rather than changing
business access. It could display identity-bound signup intents without a
membership as “verified account; business setup pending,” with its observation
time and selected preference. Unbound anonymous intents would not count as
accounts. Provider-only accounts that never resumed would require a minimal
audited signup-event record before they could be listed reliably. Unknown
verification/session state should remain “unknown,” never inferred from the
customer list. Such a view would grant no role, membership, or feature access.
This proposal was not implemented as a provider directory or new access grant.

## Implemented correction

Admin → Content → Registration policies gained an upload/paste editor for
owner-approved UTF-8 `.txt` or `.md` documents. PDF and Word uploads were
explicitly rejected with plain-text export guidance. Both documents and a
revision could be reviewed before the owner authorized publication. Publishing
required the existing authorized platform-owner session, MFA, same-origin
protection, request limits, and audit recording.

Published policy pairs were stored as immutable versions in Netlify Database.
Unique revisions and a comparison with the previously loaded revision prevented
overwrites or publication over a concurrent change. No placeholder policies
were inserted. Public legal pages, notices, readiness, onboarding consent, and
server provisioning read the same published version. Publication and creation
shared a transaction lock so consent could not silently refer to a superseded
version at creation time. Prior versions remained available for consent tracing.

Onboarding distinguished unpublished policies from failed policy requests,
offered Retry, explained missing agreement, and displayed field-specific
validation errors. Failed saved-plan checks were surfaced instead of hidden.
Policy and plan retries preserved business fields in the mounted form; a new
policy revision required new consent. Requests timed out into actionable errors.
Submission guards and the existing server identity lock and membership checks
preserved one-business behavior on retries. Verification, authorization, paid
activation gates, and existing customer access rules remained enforced.

After deployment, the owner needed to upload the approved documents, assign a
revision, review, and publish. The reported account could then reopen onboarding
or check published policies again, accept that revision, and submit the saved
business details. No replacement authentication account was needed.

## Verification boundary

Disposable PGlite databases exercised the migration, RLS denial of unauthorized
publication, owner/MFA/origin enforcement, immutable published versions,
public readiness/content agreement, stale-revision rejection, and free-workspace
creation. A handler integration fixture checked a verified pending account's
absence from admin, one successful business and Owner membership, admin
visibility, no other workspace in its membership result, no paid billing grant,
denial while signed out, and restoration of the same membership after simulated
sign-in. UI tests checked upload/reopen consistency, failed-publication recovery,
field validation, changed-policy consent, in-flight duplicate prevention, and
preservation of details through setup retries.

These tests used synthetic provider/session transitions. They did not perform a
real fresh signup, deliver or consume verification mail, enter the live workspace
in a browser, or complete real sign-out/sign-in. No isolated deployment and test
account was approved for those writes, and actual approved documents had not
been supplied for publication. Full registration was therefore **not certified
working end-to-end**. The remaining acceptance test required owner publication
and an approved isolated fresh-account run through email verification, business
creation, workspace entry, admin visibility, sign-out/sign-in, and tenant-data
isolation.

The focused validation finished with 151 passing tests across 11 suites.
TypeScript and scoped lint checks were also run; whole-file lint on legacy
files still reported existing broad `any` types and the existing synchronous
loading-state effect in onboarding. No build command or live account write test
was run.
