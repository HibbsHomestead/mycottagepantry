Cottage Pantry account-aware support

The existing help desk API, Identity verification, selected-business cookie, Netlify Database transactions, approved help corpus, and OpenAI tool-calling loop were reused. No second chat service or database query interface was introduced.

| Tool/workflow | Existing source | Implemented scope |
| --- | --- | --- |
| search_help | Approved support knowledge | Current product workflows and verified in-app article links |
| account_status | Verified Identity and active users membership | Sign-in, verified email and business role; no credentials |
| business_status | workspace_billing and integrations | Role-authorized recorded plan/status and integration metadata; no live-payment or connection-health claims |
| troubleshoot | receipt_extractions and label_recovery_drafts | Permitted receipt status counts and the requester’s unresolved label checkpoints; no files or raw errors |
| inspect_timezone | Business settings | Owner-only exact settings target, recorded timezone and effective default |
| propose_timezone | Existing settings field and registration timezone validator | Owner-only, exact timezone proposal; no model execution capability |
| Approve exact change | Human-only support endpoint | Exact proposal ID and timezone, current membership and shared entitlement/access checks, transactional compare/apply/readback |
| Review undo proposal | Durable correction audit | Separate expiring approval for previous timezone; rejects intervening timezone changes |
| Contact support | Existing tickets/messages/conversation attachment | Reviewed summary, conversation, server tool outcomes and exact correction audit |

Timezone was selected as the first correction because the existing application explicitly validates it and uses it for business-local date defaults. It is available across plans; approval does not grant a paid feature. Existing effective-access resolution, suspension checks and the workspace settings write gate run again at proposal and execution. No stock, monetary amounts, transaction dates, historical accounting, membership, entitlements or subscription data are changed. Unset timezone undo restores its established America/Chicago behavior explicitly.

The online OpenAI provider receives only the allowlisted tools. A bounded server loop resolves model calls through fresh verified Identity, current conversation ownership, selected business, active membership, input validation and role checks. The model cannot supply business IDs to select targets, execute SQL, approve proposals, or invoke deployment/admin tools. Plain conversation agreement cannot execute a change. Existing provider configuration and usage reservations remain in use; no new credentials or paid service was configured.

Proposals bind the actor, business, settings ID and before/after payload and expire in 15 minutes. Execution locks the proposal and settings, revalidates access, rejects changed state and reads back the exact saved value. The mutation and approval/verification audit commit together. Repeated confirmation returns the recorded result without writing again. Rejected or failed execution attempts also record a content-free audit linked to the proposal ID. Undo prepares another proposal and never changes settings on its own. If the original chat expired or was deleted, start a fresh inspected proposal instead.

Approval records persist separately from conversation retention and include the actor, business, exact target, before/after values, approval timestamp, verification timestamp and outcome. Deleting a chat does not erase those records. Unsupported questions and actions use human escalation or existing authorized workflows. Financial transactions, billing changes/reconciliation, destructive operations, historical adjustments, inventory changes, user permissions and platform configuration are excluded from model tools.

The interface labels guidance, observed diagnostics, proposed changes and failed-provider escalation separately. Applied changes and saved-setting verification come from backend responses and audit records. A saved-setting match does not prove the original symptom disappeared; users are told to refresh the oven and check it separately.

Validation used an embedded PostgreSQL-compatible database with the new migration and forced approval-row policies, authenticated API handlers, a mocked online-provider transport exercising real tool-call sequencing, and React interaction tests. Hosted AI transport and a deployed authenticated owner walkthrough were not established locally. Automatic deployment must apply the new forward migration. No applied migration or LIVE billing configuration was changed; no real customer subscription or financial mutation was tested.

The subsequent GPT-5.4 mini candidate evaluation, configurable limits, private rollout gate, screenshot review and spending meter are described in `docs/support-ai-gpt54-mini-evaluation.md`. That report supersedes the earlier unverified-provider limitation above for the bounded live synthetic evaluation only.
