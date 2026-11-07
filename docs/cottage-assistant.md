# AI assistant — Deferred (internal)

AI is excluded from the public release and all launch subscriptions. `AI_ENABLED` defaults OFF; only exact server-side `true` opts in. Customer assistant controls/settings are unmounted. Workspace, handler, inference and document adapters block requests before provider calls. No automatic tests/research/suggestions/background inference occurs. No live request was made.

Text/URL/manual recipe import and direct product-link import work without AI. Recipe PDF/image OCR and receipt OCR depended on Google GenAI/Gateway; these paths are disabled honestly while preserving originals/manual review. Receipt upload no longer auto-extracts. No alternative provider was substituted.

Existing Gateway/Perplexity assistant and Google document-reading adapters/tests are retained. Future release requires independent approval of usage, cost, privacy, limits, operations and UI restoration; it cannot be enabled as a plan-name entitlement. Read [the integrations audit](integrations-audit.md) for safeguards and existing limits. Credentials remain server-side. Do not make real tests without explicit approval.
