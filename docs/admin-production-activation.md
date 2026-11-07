# Production administration activation — earlier November 4, 2026 acceptance

**Historical record:** this describes the 03:53 UTC activation and 04:15 UTC follow-up. See [the current admin report](admin-portal.md#current-deployed-state--november-4-2026) for the latest deployment, status matrix and remaining gates.

The existing administration release was publicly reachable during this verification. Domain binding, production publication, and the two release migrations were confirmed. The owner subsequently reported successful production login, MFA, refresh, and relogin, plus working customer Oven access with admin access denied. Exact enrollment timestamps, deployed cookie attributes, and a recovered hydration error remained open. No interface was rebuilt and no security checks were changed.

## Bound project and published release

The live Netlify project API identified `mycottagepantry`, site `299e7942-6246-467a-bef5-fa3f6817b210`, under the Hibbs Homestead account (`redinayantz`). Its primary domain remained `mycottagepantry.com`; its additional production domain list contained `admin.mycottagepantry.com`. No binding mutation or repeated unauthorized binding attempt was needed.

The published production deployment was `6aeaab6b966ef1f6f153c89c`, published **November 4, 2026 at 03:53:15.858 UTC**, from `main`, commit `1c130eb69e8e218bc9ed7a8e1dd7255be03fe6fd`. Its state was `ready`, database branch was `production`, and edge functions were present. Actual production HTML and API responses confirmed that the administration implementation was included; this was not inferred solely from the release title.

A follow-up live project/deployment lookup at **04:15:25 UTC on November 4, 2026** reconfirmed the same binding, primary domain, published deployment, and successful production migration results. Follow-up HTTP requests again returned the admin entry and deep link successfully, preserved the admin-root redirect, rejected anonymous and cross-origin data requests, and served the customer Oven entry.

DNS resolved the admin hostname through CNAME `mycottagepantry.netlify.com` to the same Netlify addresses as the intended project. Certificate validation succeeded. The certificate covered `*.mycottagepantry.com` and `mycottagepantry.com` and expired **January 30, 2027 at 01:43:47 UTC**. DNS, the live project binding, and working host-specific responses were checked together.

## Production migration results

The published deployment's database migration metadata reported:

| Migration | Production result |
| --- | --- |
| `20261110010000_add_platform_admin_portal` | `applied: true` |
| `20261111010000_bootstrap_confirmed_platform_owner` | `applied: true` |

These were results from the existing production deployment, not from the preview branch. No migration was manually executed or replayed. All eighteen migration files, including the sixteen preceding this release, were left unchanged. A second deployment or migration run was unnecessary to establish the recorded production application.

Direct production database inspection remained permission-blocked. `GET /sites/299e7942-6246-467a-bef5-fa3f6817b210/database/branch/production` returned **401 Access Denied**. The production migration-list API also denied access. This did not negate the successful migration results available through the published deployment API, but prevented reading the actual grant and audit timestamps. No attempt was made to use the preview connection as a production connection or work around these permissions.

## Real production checks

All checks in this section used the deployed production hosts with normal certificate verification and no mocked API responses.

| Check | Observed result |
| --- | --- |
| Admin root `/` | HTTP 302 to `https://admin.mycottagepantry.com/admin`, then HTTP 200 and a visible administrator sign-in form |
| Admin `/admin` | HTTP 200, administration title and sign-in controls; no Netlify “Site not found” |
| All seven section deep links | HTTP 200 before and after refresh; sign-in gate retained |
| Customer-search link | `section=customers&kind=accounts&q=acceptance&page=2` survived refresh |
| Anonymous APIs for overview, customers, plans, billing, operations, content, audit | HTTP 401 `SIGN_IN_REQUIRED`; no customer/platform records returned; private/no-store responses and no permissive CORS |
| Customer-origin request to admin API | HTTP 403 `ORIGIN_FORBIDDEN` |
| Admin API on customer hostname | HTTP 404 `ADMIN_HOST_REQUIRED` |
| Customer routes on admin hostname | `/oven`, `/login`, `/api/workspace`, `/api/account-access`, and `/.netlify/identity/settings` returned HTTP 404 |
| Customer `/admin` | HTTP 302 to the administration hostname, retaining the customer primary domain |
| Customer `/oven` | Initial HTTP 200, then the existing customer login page with `/oven` preserved as the return destination |
| Customer account-access API without a session | HTTP 200 with `signed_out` and no memberships |
| Admin page on a 390-pixel viewport | Sign-in controls visible with no horizontal page overflow |

A fresh anonymous admin browser received no administration session cookie and had no Identity provider cookies. This only verified anonymous behavior. It did **not** verify a password-authenticated cookie, MFA session rotation, logout, or a real customer's cross-host session behavior.

## Owner-reported authenticated production acceptance

After performing the requested checks in their own browser, the owner supplied these outcomes:

| Production acceptance | Evidence |
| --- | --- |
| Owner password login and MFA | Owner reported success |
| Authenticated refresh and relogin | Owner reported success |
| Customer login and authenticated Oven | Owner reported success |
| Ordinary-customer admin access | Owner reported access denied |

These were real-account outcomes reported by the owner, separate from the runner's independent public checks and automated fixtures. No credentials or session values were supplied to the runner. The owner did not supply bootstrap/enrollment audit timestamps or cookie attributes. Successful refresh and relogin supported functional session behavior, but did not independently establish the deployed Secure, HttpOnly, SameSite, host scope, lifetime, rotation, or invalidation attributes. Those attributes remained covered by source review and fixtures, with deployed-header inspection still outstanding.

All administration asset requests under `/assets/` succeeded. The browser nevertheless reported React hydration error **418 once per document load**, including reloads. The page recovered and displayed the working sign-in form, but this was not an error-free browser acceptance. Diagnostic interception of a copy of the production document isolated the error to whitespace in the transformed `<head>`: removing head whitespace eliminated the error. Removing the Netlify runner script or comparing the server/client appearance script did not resolve it; those appearance scripts were identical. This diagnostic altered only a browser response copy, not production, and was not counted as a passing production check. The production head-transformation issue remained unresolved.

## Owner grant and enrollment

The intended provider account remained `8a87b82e-1393-4c4d-9885-62f946204b6e`. A live Identity lookup confirmed that the account existed and had been provider-confirmed on October 31, 2026 at 18:02:40 UTC.

The one-time bootstrap **migration ran successfully**, according to the production deployment. The owner's subsequent successful login and MFA check provided evidence that the intended owner's effective platform access worked. The exact stored grant and bootstrap audit row were not independently read: the migration deliberately does nothing if any administrator record already exists, including a disabled record. The report therefore distinguished the confirmed migration application and owner-reported effective access from an independently inspected bootstrap insertion.

The configured initial enrollment window was 24 hours from the actual grant insertion transaction, not from the migration filename, report date, first visit, or publication timestamp. Its **actual start and expiration remained unverified**: production database inspection was denied and no audit timestamps were supplied in the owner's response. Neither was invented from the deployment publication time. The bootstrap utility was not executed and the migration was not replayed. Working MFA was reported, so no enrollment recovery or extension was indicated or performed.

Owner activation steps:

1. Open **https://admin.mycottagepantry.com/** directly in a current browser on the device that will hold the passkey, or with the intended security key available.
2. Enter the existing email and password for the confirmed account in the site's sign-in form, then select **Continue securely**. A Netlify dashboard login or customer Oven role alone does not grant portal access.
3. If **Register your second factor** appears and enrollment is available, check **I am registering this device for my platform administrator account**, select **Register security key or passkey**, and complete the browser/device verification prompt. If a key is already registered, use **Verify security key or passkey** instead.
4. Confirm that Overview opens, then open Customers and refresh a deep link. In **Audit & Settings**, locate the successful `owner_bootstrap` entry for the confirmed identity and record its timestamp with timezone. That establishes the original window start; the bootstrap's original 24-hour deadline is that time plus 24 hours. A successful `mfa_enrolled` event establishes completed enrollment.
5. In browser developer tools, inspect **only the attributes** of `__Host-cp_admin`: host `admin.mycottagepantry.com`, Path `/`, Secure, HttpOnly, SameSite `Strict`, and no parent-domain scope. The password-only session is limited to five minutes; the MFA-verified session is limited to thirty minutes and rotates. Do not copy or share the cookie value.
6. Sign out and confirm that admin data disappears and a direct admin data request returns 401. Sign in again and verify the enrolled second factor.

If a future enrollment attempt reports that the window is closed, stop enrollment attempts and use an explicitly authorized, audited operator recovery for the exact immutable identity. Preserve revoked grants, invalidate prior pending sessions, record the reason and previous/new deadline, and use a new reviewed change through the deployment process. Do not replay the bootstrap, remove the MFA requirement, restore a disabled grant, or extend enrollment silently. The current owner reported successful MFA, so no recovery was performed.

An authorized production database reader can independently establish grant and bootstrap evidence with this read-only inspection. It returns no session tokens, credential material, or customer data:

```sql
BEGIN READ ONLY;
SELECT set_config('app.platform_gateway', 'true', true);
SELECT identity_id, role, enabled, created_at, enrollment_until,
       (SELECT count(*) FROM platform_credentials c
        WHERE c.identity_id = a.identity_id) AS enrolled_key_count
FROM platform_admins a
WHERE identity_id = '8a87b82e-1393-4c4d-9885-62f946204b6e';
SELECT action, outcome, created_at
FROM platform_audit
WHERE target = '8a87b82e-1393-4c4d-9885-62f946204b6e'
  AND action IN ('owner_bootstrap', 'mfa_enrolled')
ORDER BY created_at;
COMMIT;
```

Successful first-device enrollment clears the grant's `enrollment_until`; the original successful bootstrap audit timestamp still records when the initial 24-hour window began. An empty result must be assessed with the connection's row permissions, rather than treated automatically as a missing grant.

## Automated fixtures and remaining acceptance

The focused administration API, UI, and owner-bootstrap suites were rerun during this verification: **31 tests passed across three files**. They used disposable database state, generated cryptographic keys, and mocked Identity responses. They covered customer-role denial, host/origin checks, MFA, cookies and rotation, revocation, enrollment expiry, immutable audit history, last-owner protection, and guarded bootstrap replay. These were automated fixtures and did not prove real production account authentication.

Real owner login, MFA, authenticated refresh/relogin, ordinary-customer admin denial, and customer Oven access passed according to the owner's supplied production outcomes. The runner independently reconfirmed public reachability and unauthenticated authorization boundaries. Remaining verification gaps were the exact stored grant/bootstrap evidence, actual initial enrollment start and expiration, and deployed authenticated cookie attributes. The production database inspection permission blocker and the recovered production hydration error remained open. No secrets, further confirmations, new bootstrap, or MFA bypass were requested. Full release closure was not claimed while these gaps remained.
