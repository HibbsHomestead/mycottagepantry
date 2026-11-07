# Private package-photo pilot operations

The owner approved this private pilot for **contact@hibbshomestead.com**, verified Identity `8a87b82e-1393-4c4d-9885-62f946204b6e` in workspace `8081ae5d-576f-4bf6-8dd4-a69b39a47bf1`. The forward migration seeds exactly this grant only if that active Owner membership exists. It does not grant access to other admins, workspace members, or subscription tiers. This implementation has not manually applied the migration, mutated the live grant, or made a paid inference request.

## Release and cost bounds

The pilot uses the supported Netlify AI Gateway model `gpt-4.1-mini` through the server-only official OpenAI SDK. It replaces the earlier proposed Gemini reader because a non-reasoning model makes the request maximum explicit. There is no fallback model and no automatic retry; the SDK timeout is 45 seconds and retries are set to zero.

The following bounds and standard provider rates were checked against the official documentation on November 7, 2026:

| Bound                                   | Enforced value                                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Photos                                  | At most four JPEG/PNG/WebP images; total input at most 4 MiB                                                                                 |
| Prepared dimensions                     | Rotate, remove metadata, fit inside 2000 × 2000 pixels without enlargement                                                                   |
| Text                                    | At most 6000 UTF-8 bytes, with a conservative 2000-token framing allowance                                                                   |
| Conservative image tokens               | `4 × ceil(2000 / 32)² × 2 = 31752`; the documented 1.62 patch multiplier is rounded up to 2 and image downscaling is ignored to overestimate |
| Input budget                            | 40000 tokens, greater than `31752 + 6000 + 2000 = 39752`                                                                                     |
| Completion budget                       | Explicit `max_completion_tokens: 6000`; no reasoning step                                                                                    |
| Standard input rate                     | $0.40 per million tokens, conservatively ignoring cached discounts                                                                           |
| Standard output rate                    | $1.60 per million tokens                                                                                                                     |
| Maximum estimated provider token charge | `(40000 × 0.40 + 6000 × 1.60) / 1000000 = $0.0256`                                                                                           |
| Reservation                             | $0.05 per request, below the approved monthly cap                                                                                            |

The grant enables processing after deployment because the approved reservation exceeds this conservative maximum. These are estimated provider token charges, not a customer charge or a cap on unrelated Netlify platform charges. The provider rate expires closed on **December 7, 2026 UTC**. Renew it only after rechecking the model, price, input geometry, completion cap, and tests. The current catalog supports the alias; the official model page marks its dated snapshot deprecated. Provider availability and extraction quality have not been exercised with a paid live call. There is no automatic substitute if the model becomes unavailable.

Usage must report the expected alias or `gpt-4.1-mini-2025-04-14`, nonnegative integer input/completion counts within the bounds, and zero reasoning tokens. An unknown model, missing usage, or out-of-bound count retains the full reservation and automatically clears the processing and verification flags. A timeout or unknown transport outcome also retains the full reservation. The server never reports a failed request as free without verified usage.

## Operator controls and accounting

The account grant in Netlify Database has separate visibility, processing, and bounds-verification controls. `enabled=false` hides and denies the pilot; `processingEnabled=false` blocks new provider calls while retaining the configured UI; `boundsVerified=false` also blocks calls. The global `PACKAGE_PHOTO_PILOT_ENABLED=false` switch blocks all new pilot requests. A call already dispatched can still incur its reserved charge.

The approved hard ceilings are **20 requests per UTC day, 100 per UTC month, and $2 per UTC month** of estimated token spending, including outstanding reservations. Grant limits can be lowered; values above the approved ceilings fail closed. Amounts use integer microdollars (`1000000 = $1`). Reservations must cover the verified maximum and cannot exceed $0.05. Owner/admin roles receive no exception.

A locked grant row serializes reservations across all sessions. The reservation commits before any inference; the dispatched-attempt count must also persist before sending the provider request. One request can be in flight. Actor/idempotency-key hashes remain unique persistently, while matching photo-content hashes are blocked for 15 minutes. After five minutes, a stranded in-flight request becomes uncertain but retains its full spend reservation. Active/recent requests across a month boundary remain counted conservatively. Corrupt spending metadata stops further processing.

The tenant-scoped `photo_extraction_attempts` ledger records actor, timestamps, outcome, request/model/provider identifiers, rate version, attempt count, token counts, and reserved or estimated microdollars. It does not store photographs, OCR fields, prompts, credentials, or provider response text. Both pilot tables have forced tenant row-level policies. No subscription policy or billing workflow reads this grant.

For an accounting review, use an authorized tenant-scoped database session to inspect attempts and the grant. Reconcile uncertain usage with provider records before lowering a reservation; preserve the request outcome and evidence of that reconciliation. Re-enable a suspended grant only after resolving the cause and verifying the bounds. Raising the approved ceilings or changing the target requires a new decision; routine renewal at unchanged limits does not require another target confirmation.

## Workflow and verification

Only the authenticated enabled account receives the server-derived UI capability. Every extraction rechecks the exact Identity, workspace grant, permitted workspace role, kill switch, rate validity, budget, duplicate protection, and in-flight state. Other accounts retain manual, URL, and barcode entry.

Front/back photos and optional close-ups feed the existing shared draft and compact evidence review. Applying selected evidence does not save the ingredient, post stock, or change labels. The owner must explicitly save. Images are transient on the application server; the disclosure states OpenAI may retain inputs for abuse monitoring for up to 30 days, subject to its documented exceptions. Removing a local preview does not remove provider copies.

Synthetic provider tests verify SDK retry/output settings, metadata stripping, evidence validation, dispatch persistence, usage bounds, and unknown-model handling. Disposable database tests exercise target isolation, visibility/release gates, durable reservations, duplicates, in-flight limits, all budgets, stale outcomes, and automatic suspension. They do not prove live model availability or extraction accuracy.

Official references:

- [GPT-4.1 mini model and rates](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [Image patch token accounting](https://developers.openai.com/api/docs/guides/images-vision)
- [Data controls and retention](https://developers.openai.com/api/docs/guides/your-data)
