# GitHub Actions deploy (Workload Identity Federation)

Uses pool **`iap-cloud-agent-1`**, provider **`github`**, project **`securedbackend-production`** (number `248381849073`). No service account JSON keys.

## After creating the pool (you did this)

### 1. Service account bucket access

On **`iap-cloud-agent-deploy@securedbackend-production.iam.gserviceaccount.com`**, grant **Storage Object Admin** on:

- `securedbackend-production-ta-cadel-7414-hub-app`
- `securedbackend-production-ta-cadel-7414-coming-soon-app`

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

### 4. Run the workflow

**Actions → Deploy IAP storefront → Run workflow**

- **target:** `both` (hub + apex), or hub/apex only  
- **build_console_overlay:** enable when hub `/console/` changed and `console-app` is available in symlfy-baas  

## Workflow file

`.github/workflows/iap-deploy-storefront.yml`

## Verify WIF

After the first run, in GCP **Workload Identity Federation → iap-cloud-agent-1**, the usage chart should show activity. If auth fails, check the run log for `google-github-actions/auth` and the SA **Permissions** tab for the principalSet binding.
