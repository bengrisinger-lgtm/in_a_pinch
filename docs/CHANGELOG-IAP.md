# IAP changelog (`in_a_pinch`)

Platform-wide recurring patterns: **`symlfy-baas/RECURRING-BUG-CLASSES.md`**. Feature IDs: [IAP-FEATURE-INDEX.md](../IAP-FEATURE-INDEX.md).

## 2026-09-23

- **Docs:** Added canonical `RECURRING-BUG-CLASSES.md` to `symlfy-baas` repo root; agent read-first + cloud-first deploy docs in `in_a_pinch`.
- **Prod diagnosis:** Guest session OK; `GET /api/v1/quotes/inventory/skus` **500** — missing `quote_id` on upgraded tenant schema (RECURRING §1). **Fix:** merge PR #3, run Actions **Deploy IAP quote-service**.
- **Code:** `quote_id` reservation shims run at start of `ensureQuoteTables()` (§1 ordering).
- **CI (PR #3):** Deploy workflows + cloud-first docs; quote-service and storefront tests green locally.

## 2026-09-12 (live platform + IAP)

- **RECURRING §18:** IAP hub stock **403** (core-only `allowedServices`) and add-SKU **500** (spoke CORS throwing). Revisions `api-gateway-00048-khx`, `quote-service-00010-bxt`. See RECURRING-BUG-CLASSES §18 cross-refs.
