# SymlaVault cloud deploy standard (GitHub Actions + WIF)

**Goal:** Every tenant frontend + spoke backend deploys from **GitHub → Actions** (phone/laptop), not from a GrizzTeam PC. One repeatable pattern.

## Pattern (copy per tenant repo)

| Piece | Where |
|-------|--------|
| App code | Tenant repo (e.g. `in_a_pinch`) |
| Platform SDK + infra JSON | Private `symlfy-baas` checkout in CI |
| GCP auth | **Workload Identity Federation** → **`iap-cloud-agent-deploy@…`** (no JSON keys in GitHub) |
| Clone baas | GitHub repo secret **`SYMLFY_BAAS_GITHUB_TOKEN`** (Actions only — not Cursor) |
| One-time GCP IAM | **[IAP-GITHUB-DEPLOY-SA-IAM.md](./IAP-GITHUB-DEPLOY-SA-IAM.md)** + `infra/github-wif-deploy-sa.tf` or **`scripts/bootstrap-iap-github-deploy-sa.ps1`** |
| Spoke deploy | `gcloud run deploy --source` + stage `file:` SDK under `vendor/sdk` (RECURRING §20a) |
| Static hub/apex | `gcloud storage rsync` to `gs://{project}-ta-{slug}-hub-app` (+ coming-soon) |

New tenant: duplicate workflows, change **`IAP_TENANT_ID`**, **`IAP_TENANT_SLUG`**, bucket names; run bootstrap script once per **project** (same deploy SA can serve multiple tenant buckets if IAM added).

## GrizzTeam PC

**PowerShell `deploy.ps1`** remains parity/emergency — not the primary model. Cloud path must work with bootstrap + Actions alone.

## Docs

- [GITHUB-WIF-DEPLOY.md](./GITHUB-WIF-DEPLOY.md) — WIF principal + GitHub secret
- [CLOUD-FIRST-DEPLOY.md](./CLOUD-FIRST-DEPLOY.md) — which workflow when
- `symlfy-baas/RECURRING-BUG-CLASSES.md` — §18 hub/spoke, §20 Cloud Run `file:` deps
