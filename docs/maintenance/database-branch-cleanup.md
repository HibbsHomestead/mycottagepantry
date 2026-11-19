# Database branch cleanup

This owner-run CLI is separate from the customer app. It never resets databases, touches migrations or deletes Git branches. Inventory is the default. No scheduled deletion is configured.

## API and access

Checked the official Netlify OpenAPI specification at https://open-api.netlify.com/swagger.json during implementation. It currently defines `listSiteDatabaseBranches` as `GET /sites/{site_id}/database/branches` and `deleteSiteDatabaseBranch` as `DELETE /sites/{site_id}/database/branch/{branch_id}` (204 on deletion). This differs from the requested `{deploy_id}` parameter. The tool only permits deletion where a unique deploy explicitly returns `database_branch_id` equal to the branch ID **and the deploy ID is the same value**. It always passes that verified deploy ID. Different identifiers, missing association fields and shared dependencies remain unknown and cannot be deleted. Do not loosen this rule by guessing IDs. The published deploy schema does not guarantee that association field is available.

The first read-only builder inventory using existing CLI authorization returned `JSONHTTPError: Unauthorized`. No repeated authenticated inventory or deletion requests were made. The response did not distinguish expired credentials from insufficient permissions. Builder enumeration and quota verification remain unavailable; no candidates or current preview IDs were verified. An older historical Git cleanup candidate is not evidence for deleting a database branch.

Run from an owner's trusted terminal with a Netlify personal access token authorized to access this site and database. Supply `NETLIFY_AUTH_TOKEN` through a secret manager or silent shell prompt; never commit it, paste it in chat, or put it on the command line. CLI login alone is not used by this script. Consult https://docs.netlify.com/api/get-started/ for personal access token setup. A 401/403 stops immediately without exposing the response body. Account-specific permission requirements must be resolved by the owner; the API did not report a specific missing scope.

## Protect work first

Create `.netlify/database-cleanup/policy.json` locally (the whole `.netlify` directory is ignored). All policy, inventory, manifest and execution files are private operational artifacts, not application business storage. Do not place them in a public directory. Keep a secure backup of the approved manifest and log.

```json
{
  "siteId": "299e7942-6246-467a-bef5-fa3f6817b210",
  "currentPreviewProtected": true,
  "protectedBranchIds": [
    "production",
    "EXACT_CURRENT_DATABASE_BRANCH_ID",
    "EXACT_STAGING_OR_RETAINED_BRANCH_ID"
  ],
  "protectedDeployIds": ["EXACT_CURRENT_DEPLOY_ID"],
  "closedWork": []
}
```

Replace placeholders with verified IDs. Include every active agent run, open PR/work, preview awaiting review and branch holding data to retain. `currentPreviewProtected` is an owner attestation that this review is complete; it does not discover a run automatically. Production and named staging are always protected. Missing workflow evidence stays unknown. All branches are protected from deletion by default because `closedWork` is empty.

For an actually closed branch only, add an owner-verified record to `closedWork`:

```json
{
  "branchId": "EXACT_BRANCH_ID",
  "deployId": "EXACT_ASSOCIATED_DEPLOY_ID",
  "checkedAt": "REPLACE_WITH_CURRENT_ISO_TIMESTAMP",
  "workflowStatus": "closed",
  "activeRun": false,
  "openWork": false,
  "awaitingReview": false,
  "keepData": false,
  "dependenciesVerified": true,
  "evidence": "Specific reviewed run/PR/deploy evidence and owner data-retention decision; no secrets or private URLs."
}
```

These attestations expire after 24 hours. Age, names, build failures, idle compute, and completed runs alone never qualify. Run/PR status and preview-only data cannot be reliably inferred from branch metadata. Owner verification is mandatory; missing evidence blocks deletion. Refresh the policy before execution if state changes. Do not let another cleanup process run concurrently.

## Inventory and exact review

```sh
node scripts/database-branch-cleanup.mjs
# Equivalent explicit mode:
node scripts/database-branch-cleanup.mjs inventory
```

Inspect `.netlify/database-cleanup/report.md`, `inventory.json` and `manifest.json` locally. Inventory includes exact branch IDs/names, verified deploy IDs, available PR/Git associations, available creation/activity dates, database and owner-verified workflow status, classification and evidence. Agent run IDs remain null when unverified. Connection strings and raw metadata are discarded. Deploy listing is paginated; branch listing follows pagination when advertised (the current API documents an all-branches response). Unexpected schemas or duplicate pages stop the script.

The manifest records the site, exact proposed targets, reasons, count and excluded protected/unknown branches. No authorized current report was available during implementation. The script prints the manifest SHA256. **Deletion permanently removes branch-specific data and can make its preview unusable.** Present the exact manifest/table to the owner and obtain explicit approval before using execute. A candidate is not approval. No deletion was performed during implementation.

To approve a subset, make a private copy, remove unwanted entries from `targets`, update `total`, and calculate a new digest:

```sh
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {digest} from "./scripts/database-branch-cleanup.mjs"; console.log(digest(JSON.parse(readFileSync(process.argv[1], "utf8"))))' .netlify/database-cleanup/approved.json
```

Obtain approval for that exact subset and hash. Never add targets after approval. A changed manifest needs a new approval and a new execution log.

## Execute and resume

After exact owner approval, one command processes the fixed list sequentially:

```sh
node scripts/database-branch-cleanup.mjs execute --manifest=.netlify/database-cleanup/approved.json --approve-sha256=APPROVED_SHA256 --log=.netlify/database-cleanup/execution.json
```

Use the identical command to resume. The log is bound to the manifest digest and written atomically before each mutation. Completed deletions are never retried. Pending/failed requests are reconciled against fresh inventory before attempting again. A missing target is only marked already absent after a successful full inventory. Identity/protection changes cause a skip. Authentication failures, ambiguous transport/server errors and unexpected API responses stop the batch. Read retries are bounded to three attempts, honoring Retry-After up to 60 seconds; longer waits require resuming later. Delete rate limits can retry, but uncertain delete server/transport failures stop for reconciliation.

The execution log records per-target outcomes, before/after counts, remaining protected/unknown branches and count reconciliation. If counts disagree, stop and investigate external branch creation/deletion or an interrupted request. Do not infer quota reduction solely from a successful HTTP response.

Refresh final counts without deploying:

```sh
node scripts/database-branch-cleanup.mjs inventory
node --test scripts/database-branch-cleanup.test.mjs
```

No deployment is needed to run this tool. Current access limits prevent actual inventory, cleanup approval, branch reduction or quota-freed claims. No branches have been deleted.
