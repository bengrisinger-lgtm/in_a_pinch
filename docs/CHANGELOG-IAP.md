# IAP changelog (`in_a_pinch`)

Platform-wide recurring patterns: **`symlfy-baas/RECURRING-BUG-CLASSES.md`**. Feature IDs: [IAP-FEATURE-INDEX.md](../IAP-FEATURE-INDEX.md).

## 2026-09-23

- **Docs:** Added canonical `RECURRING-BUG-CLASSES.md` to `symlfy-baas` repo root; agent read-first + cloud-first deploy docs in `in_a_pinch`.
- **Prod diagnosis:** Guest session OK; `GET /api/v1/quotes/inventory/skus` **500** — missing `quote_id` column on upgraded tenant schema (RECURRING §1). Fix: deploy quote-service with migration shim on `main`.
- **CI (draft PR #3):** GitHub Actions **Deploy IAP quote-service** + storefront workflow layout fix (`file:` SDK staging per RECURRING §20a). Pending security/IAM review before merge.

## 2026-09-12 (live platform + IAP)

- **RECURRING §18:** IAP hub stock **403** (core-only `allowedServices`) and add-SKU **500** (spoke CORS throwing). Revisions `api-gateway-00048-khx`, `quote-service-00010-bxt`. See RECURRING-BUG-CLASSES §18 cross-refs.
