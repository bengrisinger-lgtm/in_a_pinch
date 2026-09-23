# Cloud Agent deployment (IAP)

Run **hub**, **apex**, and (optionally) **quote-service** deploys from a Cursor Cloud Agent instead of local PowerShell.

## One-time environment setup

1. **Commit** `.cursor/environment.json` is the source of truth once merged. In the [Cloud Agent environment dashboard](https://cursor.com/dashboard/cloud-agents/environments), link this repo and **Save** after edits.

2. **Repository dependency** — add your private platform repo to `repositoryDependencies` in `.cursor/environment.json`, for example:
   ```json
   "repositoryDependencies": [
     "github.com/<your-org>/symlfy-baas"
   ]
   ```
   The agent token must be allowed to read that repo. Checkout is typically a sibling of `in_a_pinch`; install also honors `SYMLFY_BAAS_ROOT`.

3. **Secrets** (environment → Secrets, never in git):

   | Secret | Required for | Purpose |
   |--------|----------------|---------|
   | `GCP_SA_KEY_JSON` | GCS + Cloud Run deploy | Full JSON key for a GCP service account |
   | `SYMLFY_BAAS_ROOT` | Optional | Absolute path to symlfy-baas if dependency checkout is nonstandard |

4. **Service account IAM** (minimum for storefront only):
   - `roles/storage.objectAdmin` on `securedbackend-production-ta-cadel-7414-hub-app` and `…-coming-soon-app` (or `Storage Object Admin` on those buckets)

   Quote-service deploy additionally needs Cloud Build, Cloud Run, Secret Manager, and SQL client — keep storefront and backend deploy keys separate if you prefer.

5. **Trigger an environment build** after changing `.cursor/environment.json` or the Dockerfile, then start a **new** agent from that build.

## What the agent runs

### Storefront — hub (with Vault overlay)

```bash
IAP_CONSOLE_OVERLAY=1 IAP_DEPLOY_BUILD=1 IAP_APP_SLUG=hub bash scripts/iap-deploy-storefront.sh
```

### Storefront — apex shop (same dist, no overlay rebuild required if hub already built)

```bash
IAP_APP_SLUG=coming-soon bash scripts/iap-deploy-storefront.sh
```

### Quote-service (still use PowerShell locally unless you extend bash)

Cloud Run deploy is only implemented in `quote-service/deploy.ps1` today. From the agent, run tests and image staging after install:

```bash
cd quote-service && npm test
```

For production quote-service releases, use `deploy.ps1 -TenantId 987bcdaf-320d-46bf-bfb3-4bdcdffe1de1` on a machine with full IAM, or ask for a bash port in a follow-up.

## Non-secret defaults

Install and deploy scripts default to:

- `TF_VAR_gcp_project_id=securedbackend-production`
- `TF_VAR_gcp_region=us-central1`
- `TF_VAR_base_domain=inapinchav.com`
- `IAP_TENANT_SLUG=cadel-7414`

Override via environment variables on the Cloud Agent environment if needed.

## Security

- Do **not** commit service account JSON or HMAC secrets.
- Agents should not run `terraform` or `api-gateway` deploy unless explicitly requested.
- Storefront rsync **excludes** `catalog-media/` (same as `deploy.ps1`).
