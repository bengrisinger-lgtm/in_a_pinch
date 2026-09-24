# GitHub Actions deploy (Workload Identity Federation)

Uses pool **`iap-cloud-agent-1`**, provider **`github`**, project **`securedbackend-production`** (number `248381849073`). No service account JSON keys.

## After creating the pool (you did this)

### 1. Service account IAM (one-time) — PowerShell or Terraform

**Full permission matrix (why each role exists):** [IAP-GITHUB-DEPLOY-SA-IAM.md](./IAP-GITHUB-DEPLOY-SA-IAM.md)  
**Terraform:** `infra/github-wif-deploy-sa.tf` (same grants as bootstrap script)

**Run once as project owner** (GrizzTeam PC). This is what makes **GitHub Actions** work — not `deploy.ps1`.

```powershell
cd D:\GrizzTeam_Application\micro-applications\in-a-pinch
.\scripts\bootstrap-iap-github-deploy-sa.ps1
```

If `gcloud projects add-iam-policy-binding` prompts **“specify a condition”**, this project uses conditional IAM on storage. For **Run / Cloud Build** roles choose **`None`** (option 2), or pass **`--condition=None`** on each project binding (the bootstrap script does).

That grants **`iap-cloud-agent-deploy@securedbackend-production.iam.gserviceaccount.com`**:

| Scope | Roles |
|-------|--------|
| **Project** | `run.admin`, `cloudbuild.builds.editor`, `cloudsql.client`, `artifactregistry.writer`, `serviceusage.serviceUsageConsumer` |
| **Runtime SA** `backend-backend-sa@…` | `iam.serviceAccountUser` for deploy SA |
| **Secrets** `quote-service-hmac`, `REGISTRATION_KEY`, `RUNTIME_DB_PASSWORD` | `secretAccessor`; `secretVersionManager` on `quote-service-hmac` |
| **IAP buckets** | `storage.objectAdmin` on hub + apex tenant buckets |
| **Cloud Run source staging** | `storage.admin` on **`gs://run-sources-{project}-us-central1`** (only this bucket — `gcloud run deploy --source` needs `storage.buckets.get`) |

**Typical Actions error if step 1 was skipped:** `Permission 'run.services.get' denied` on `quote-service` — fixed by **`roles/run.admin`** above.

Template for future tenants: [SYMLVAULT-CLOUD-DEPLOY-STANDARD.md](./SYMLVAULT-CLOUD-DEPLOY-STANDARD.md).

You do **not** need a JSON key on GitHub when WIF is configured.

**Manual Secret Manager only** (if you already ran project roles but not secrets):

**PowerShell (copy all, paste into one session):**

```powershell
$DeploySa = "iap-cloud-agent-deploy@securedbackend-production.iam.gserviceaccount.com"
$Project = "securedbackend-production"
$Member = "serviceAccount:$DeploySa"

foreach ($Sec in @("quote-service-hmac", "REGISTRATION_KEY", "RUNTIME_DB_PASSWORD")) {
  gcloud secrets add-iam-policy-binding $Sec `
    --project=$Project `
    --member=$Member `
    --role="roles/secretmanager.secretAccessor"
}

gcloud secrets add-iam-policy-binding quote-service-hmac `
  --project=$Project `
  --member=$Member `
  --role="roles/secretmanager.secretVersionManager"
```

<details>
<summary>bash (GitHub Actions / Linux only — not GrizzTeam PowerShell)</summary>

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

</details>

Do **not** grant project-wide `secretmanager.admin` to the deploy SA unless you accept create/delete.

**Verify (PowerShell)** — after bootstrap:

```powershell
$Project = "securedbackend-production"
$DeploySa = "iap-cloud-agent-deploy@securedbackend-production.iam.gserviceaccount.com"

gcloud projects get-iam-policy $Project `
  --flatten="bindings[].members" `
  --filter="bindings.members:serviceAccount:$DeploySa" `
  --format="table(bindings.role)"

gcloud secrets get-iam-policy quote-service-hmac --project=$Project
```

Do **not** use `--impersonate-service-account` unless your user has **Service Account Token Creator** on the deploy SA; GitHub WIF does not use your user.

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
