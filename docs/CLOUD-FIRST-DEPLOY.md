# Cloud-first deploy (no desktop PC)

IAP production changes should ship from **GitHub Actions** (works from the GitHub mobile app) or a **Cloud Agent**, not from GrizzTeam PowerShell.

## One-time GCP setup

See [GITHUB-WIF-DEPLOY.md](./GITHUB-WIF-DEPLOY.md): Workload Identity Federation for `in_a_pinch`, bucket IAM for storefront, and **Cloud Run + Secret Manager** roles for quote-service.

GitHub secret: **`SYMLFY_BAAS_GITHUB_TOKEN`** (read private `symlfy-baas`).

## Run from phone or laptop

[Actions → bengrisinger-lgtm/in_a_pinch](https://github.com/bengrisinger-lgtm/in_a_pinch/actions) → pick workflow → **Run workflow**:

| Workflow | Fixes |
|----------|--------|
| **Deploy IAP quote-service** | SKUs 500, `quote_id` migration, backend bugs |
| **Deploy IAP storefront** | Hub + apex UI, `kit.ts`, catalog UX |
| **Deploy IAP hub console overlay** | Vault `/console/` on hub only |

Typical IAP recovery order after merging to `main`:

1. **Deploy IAP quote-service** (unblocks API/catalog).
2. **Deploy IAP storefront** → target **both** (optional: enable **build_console_overlay** if Vault changed).

## GrizzTeam PC (PowerShell — your normal path)

```powershell
cd D:\GrizzTeam_Application\micro-applications\in-a-pinch\quote-service
.\deploy.ps1 -TenantId 987bcdaf-320d-46bf-bfb3-4bdcdffe1de1

cd ..\storefront
.\deploy.ps1 -Build
```

## Cloud Agent / Linux only (bash)

After environment install (`scripts/cloud-agent-install.sh`):

```bash
bash scripts/iap-deploy-quote-service.sh
IAP_DEPLOY_BUILD=1 IAP_CONSOLE_OVERLAY=1 IAP_APP_SLUG=hub bash scripts/iap-deploy-storefront.sh
```

Requires **`GCP_SA_KEY_JSON`** on the agent environment with the same IAM as WIF (or use Actions instead).

## Loan Conduit / platform auth

Tenant **auth-service** (console login cookie fixes) lives in **`symlfy-baas`**, not this repo. Deploy **`auth-service`** from platform `deploy.ps1` or add a matching GitHub workflow in `symlfy-baas` — IAP workflows here do not redeploy platform auth.

## PC scripts (optional)

`storefront/deploy.ps1` and `quote-service/deploy.ps1` remain for GrizzTeam layout parity; they are **not** required for production if WIF + Actions are configured.
