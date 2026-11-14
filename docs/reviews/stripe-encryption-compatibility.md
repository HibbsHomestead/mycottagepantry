# Production encryption compatibility checkpoint

The owner reported saving a newly generated dedicated production encryption key and requested confirmation that existing records remained decryptable before merge. No configured encryption key, API credential, or saved ciphertext was changed by this investigation. No production migration, rewrite, rotation, provider setup, or checkout activation was performed.

The production record audit remained **unverified**. A fresh read-only production database status request returned HTTP 401. The investigation therefore could not enumerate the real production ciphertext formats, decrypt every saved production record, or determine whether any record depended on a previous root that was no longer available. A successful configuration inspection, ready deployment, or valid Stripe credential did not prove those facts.

The reviewed decryption rules were:

| Saved format | Required source | Effect of adding a dedicated key |
| --- | --- | --- |
| `v2live` | The original live Stripe credential, with the existing HKDF derivation | Decryption continued to select that credential rather than the new dedicated key. Removing or rotating the original credential would break this dependency. |
| `v1` under the configured dedicated key | The exact original dedicated key | Decryption worked while the original key remained available. A newly generated different key could not decrypt it. |
| `v1` under an earlier credential stored as the encryption root | That exact earlier credential in the original root role | Replacing the root did not preserve this format automatically. The version did not carry an independent historical key reference. |

The implementation retained AES-256-GCM authentication, the same HKDF context and environment binding, and the existing format prefixes. It did not guess historical roots or overwrite unreadable records with newly imported credentials. No claim was made that `v1` records using an unavailable previous root were recoverable. The dedicated key did not remove the original live credential dependency of `v2live` records.

Five added compatibility checks used independently generated historical-format ciphertext, rather than relying only on the current writer and reader agreeing with each other. Both unrestricted and restricted live credential fallbacks decrypted after a dedicated root was introduced. New writes used that dedicated root. Wrong environment bindings, modified authentication tags and relabeled formats were rejected. Removing the original fallback credential made the dependent old record unreadable while leaving the new dedicated-root record readable. Old `v1` records encrypted under a different previous root remained unreadable until that exact root was restored in the disposable test fixture.

A database-backed fixture committed mixed-format records and read/decrypted them in two separate read-only transactions after introducing the dedicated key. It preserved the ciphertext exactly, made no provider request or application write, and kept checkout disabled. It also confirmed that an unreadable old `v1` record was preserved rather than silently replaced. These were synthetic fixtures and were not represented as production records.

Validation passed for 50 tests across seven focused suites, including the new compatibility checks, runtime configuration, persisted hosting import, signed webhooks, billing controls and public checkout availability. TypeScript, focused lint and whitespace checks passed. No build command was run.

Publication changed during the investigation: [#51](https://github.com/HibbsHomestead/mycottagepantry/pull/51) had already merged at 2026-11-14 17:48:28 UTC. Its production deployment, `6af89eef4f0a7c213c115778`, was ready and published at 17:49:32.692 UTC from commit `ffcec1f10b48842273988a4f6332200aaf2d6767`. Thus a pre-merge confirmation for that release could no longer be supplied. This follow-up added verification coverage and documentation; it did not initiate that merge or publication.

Production runtime inspection returned HTTP 200 with no purchasable plans. The inspected production recovery logs did not supply successful post-commit decryption/account-persistence evidence. Checkout remained gated by explicit administrator approval in the published source, and no approval was given or recorded by this investigation. Empty public availability did not prove that every stored record decrypted.

Full compatibility sign-off remained pending an authorized read-only audit of every production encrypted settings row, using its saved environment binding and the production runtime's protected key sources. The audit needed to establish the format inventory and successful authenticated decryption without logging credentials, roots or ciphertext, preserve the rows unchanged, and verify disabled live checkout. If a row required an unavailable prior root, that dependency needed secure recovery and a separately reviewed migration; replacing the newly configured dedicated key or overwriting the row was not a resolution.
