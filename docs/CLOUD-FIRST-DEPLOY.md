# Cloud-first deploy (no desktop PC)

IAP production changes should ship from **GitHub Actions** (works from the GitHub mobile app) or a **Cloud Agent**, not from GrizzTeam PowerShell.

## One-time GCP setup

See [GITHUB-WIF-DEPLOY.md](./GITHUB-WIF-DEPLOY.md): Workload Identity Federation for `in_a_pinch`, bucket IAM for storefront, and **Cloud Run + Secret Manager** roles for quote-service.

## Secrets — GitHub vs Cursor (not interchangeable)

Create **one** fine-grained PAT (Contents **read** on `bengrisinger-lgtm/symlfy-baas` only). Paste the **same token value** only where your workflow runs.

| Name | **GitHub** (`in_a_pinch` → Settings → Secrets and variables → **Actions**) | **Cursor** (Dashboard → Cloud Agents → **Environments** → your IAP env → **Secrets**) |
|------|-----------------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| `SYMLFY_BAAS_GITHUB_TOKEN` | **Required** for Actions **Deploy IAP …** workflows (second checkout of private `symlfy-baas`). Your **Bad credentials** error = fix **here only**. | Optional fallback when the agent install script clones baas (`cloud-agent-clone-symlfy-baas.sh`). **Not** used by GitHub Actions. |
| `GCP_SA_KEY_JSON` | **Not used** — deploy workflows auth with **WIF** (see GITHUB-WIF-DEPLOY). | Optional — only if you run `iap-deploy-*.sh` **from a Cloud Agent** instead of Actions. |
| Cursor **GitHub App** repo access | N/A (configure at github.com → Settings → Applications → **Cursor**) | Lets agents read/write repos; **does not** replace `SYMLFY_BAAS_GITHUB_TOKEN` in Actions. |

**Deploy from phone (Actions):** you only need the **GitHub** row for `SYMLFY_BAAS_GITHUB_TOKEN`. You do **not** need to duplicate anything in Cursor for that.

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

## Cloud Agent (same scripts)

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
