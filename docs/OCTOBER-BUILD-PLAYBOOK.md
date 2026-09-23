# IAP October build playbook (agent + Ben)

**Index of live slices:** [IAP-FEATURE-INDEX.md](../IAP-FEATURE-INDEX.md). **Recurring failures:** `symlfy-baas/RECURRING-BUG-CLASSES.md` (§18 hub/spoke, §19 `/console/`, §1 schema shims).

**Boundary:** IAP business stays in `in_a_pinch` (storefront + quote-service). Do **not** add IAP domain logic to `console-service` (hub-spoke §23).

## Deploy (no desktop PC)

From phone/laptop: GitHub → Actions → run in order when recovering prod:

1. **Deploy IAP quote-service** — schema/backend (SKUs, holds, checkout).
2. **Deploy IAP storefront** — hub + apex (`target: both`). Enable **build_console_overlay** when Vault `/console/` changed.
3. **Deploy IAP hub console overlay** — `/console/` only.

Details: [CLOUD-FIRST-DEPLOY.md](./CLOUD-FIRST-DEPLOY.md). Parity with GrizzTeam PC: [DEPLOY-PARITY-LOCAL-VS-CI.md](./DEPLOY-PARITY-LOCAL-VS-CI.md).

## Pre-deploy checklist (fail-closed)

- [ ] Read RECURRING §1 if touching `quote-service/src/schema.js` (ALTER before references).
- [ ] Read RECURRING §18 if hub calls new spoke routes (CORS + gateway allowlist).
- [ ] Read RECURRING §19 if changing Vault links (`hub.{apex}/console/`, not `app.symlavault.com`).
- [ ] Read RECURRING §20a if changing deploy scripts (`file:` SDK must stage to `vendor/sdk`).
- [ ] Do **not** deploy api-gateway or terraform from this repo.

## Current prod focus (2026-09-23)

- Quote-service deploy to apply `inventory_reservations.quote_id` shim (catalog SKUs).
- Storefront Actions green upload after monorepo SDK link fix (PR #3).
