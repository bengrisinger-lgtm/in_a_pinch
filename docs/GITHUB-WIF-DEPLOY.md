# GitHub Actions deploy (Workload Identity Federation)

Uses pool **`iap-cloud-agent-1`**, provider **`github`**, project **`securedbackend-production`** (number `248381849073`). No service account JSON keys.

## After creating the pool (you did this)

### 1. Service account IAM (one-time)

On **`iap-cloud-agent-deploy@securedbackend-production.iam.gserviceaccount.com`**:

**Storefront (GCS rsync)**

- **Storage Object Admin** on:
  - `securedbackend-production-ta-cadel-7414-hub-app`
  - `securedbackend-production-ta-cadel-7414-coming-soon-app`

**Quote-service (Cloud Run + register)** — required for **Deploy IAP quote-service**:

| Role | Why |
|------|-----|
| `roles/run.admin` (or `run.developer` + `iam.serviceAccountUser` on runtime SA) | `gcloud run deploy`, IAM bindings |
| `roles/cloudbuild.builds.editor` | `gcloud run deploy --source` |
| `roles/secretmanager.secretAccessor` | On secrets **`REGISTRATION_KEY`**, **`RUNTIME_DB_PASSWORD`**, **`quote-service-hmac`** (read for deploy + register) |
| `roles/secretmanager.secretVersionManager` | On **`quote-service-hmac` only** — if register mints a new HMAC (`versions add`). **Not** `secrets.create`. |
| `roles/cloudsql.client` | Cloud SQL attachment on Cloud Run |

Runtime service account (`backend-backend-sa@…` from production prefix) stays the **Cloud Run identity**; the GitHub deploy SA only needs permission to deploy **as** that runtime SA (`roles/iam.serviceAccountUser` on it).

You do **not** need a JSON key on your laptop when WIF is configured.

**One-time Secret Manager bindings** (if Actions failed on `secretmanager.secrets.create` — that was the deploy script trying to *create* a secret that already exists from PC deploy; merge the script fix, then ensure **accessor** on existing secrets):

```bash
DEPLOY_SA=iap-cloud-agent-deploy@securedbackend-production.iam.gserviceaccount.com
PROJECT=securedbackend-production
for SEC in quote-service-hmac REGISTRATION_KEY RUNTIME_DB_PASSWORD; do
  gcloud secrets add-iam-policy-binding "$SEC" --project="$PROJECT" \
    --member="serviceAccount:$DEPLOY_SA" --role="roles/secretmanager.secretAccessor"
done
gcloud secrets add-iam-policy-binding quote-service-hmac --project="$PROJECT" \
  --member="serviceAccount:$DEPLOY_SA" --role="roles/secretmanager.secretVersionManager"
```

Run the block as a project owner (your PC is fine). Do **not** grant project-wide `secretmanager.admin` to the deploy SA unless you accept create/delete.

### 2. Let GitHub impersonate the service account

**IAM & Admin → Service accounts →** `iap-cloud-agent-deploy` → **Permissions** → **Grant access**

- **New principal** (try in this order if one fails):

  **If you mapped `attribute.repository`:**

  ```text
  principalSet://iam.googleapis.com/projects/248381849073/locations/global/workloadIdentityPools/iap-cloud-agent-1/attribute.repository/bengrisinger-lgtm/in_a_pinch
  ```

  **If you only mapped `google.subject` (GitHub `sub` claim):**

  ```text
  principalSet://iam.googleapis.com/projects/248381849073/locations/global/workloadIdentityPools/iap-cloud-agent-1/subject/repo:bengrisinger-lgtm/in_a_pinch:ref:refs/heads/main
  ```

  (Use `refs/heads/main` or widen to `*` only if you accept any branch — narrower is better.)

- **Role:** **Service Account User** is wrong for WIF — use **Workload Identity User** (`roles/iam.workloadIdentityUser`).

Or CLI:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  iap-cloud-agent-deploy@securedbackend-production.iam.gserviceaccount.com \
  --project=securedbackend-production \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/248381849073/locations/global/workloadIdentityPools/iap-cloud-agent-1/attribute.repository/bengrisinger-lgtm/in_a_pinch"
```

### 3. GitHub repo secret (private symlfy-baas)

**in_a_pinch → Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|------|--------|
| `SYMLFY_BAAS_GITHUB_TOKEN` | GitHub PAT with **Contents: read** on `symlfy-baas` (fine-grained: only that repo) |

The default `GITHUB_TOKEN` cannot read other private repos.

### 4. Run workflows (phone or laptop — no PC)

GitHub mobile app or [Actions](https://github.com/bengrisinger-lgtm/in_a_pinch/actions) → **Run workflow**:

| Workflow | When |
|----------|------|
| **Deploy IAP quote-service** | Catalog SKUs 500, schema/backend fixes on `main` |
| **Deploy IAP storefront** | Hub/apex UI, `kit.ts`, storefront changes |
| **Deploy IAP hub console overlay** | Vault `/console/` only |

**Deploy IAP storefront**

- **target:** `both` (hub + apex), or hub/apex only  
- **build_console_overlay:** enable when hub `/console/` changed  

**Deploy IAP quote-service**

- Default tenant: In A Pinch (`987bcdaf-320d-46bf-bfb3-4bdcdffe1de1`)  
- **skip_register:** only for image-only experiments  

## Workflow files

- `.github/workflows/iap-deploy-storefront.yml`
- `.github/workflows/iap-deploy-quote-service.yml`
- `.github/workflows/iap-deploy-hub-console.yml`

## Verify WIF

After the first run, in GCP **Workload Identity Federation → iap-cloud-agent-1**, the usage chart should show activity. If auth fails, check the run log for `google-github-actions/auth` and the SA **Permissions** tab for the principalSet binding.
