# GitHub WIF deploy SA — complete IAM (canonical)

**Service account:** `iap-cloud-agent-deploy@securedbackend-production.iam.gserviceaccount.com`  
**Used by:** GitHub Actions in tenant repos (`in_a_pinch`, future apps) via Workload Identity Federation.

**Official Google reference (Cloud Run `--source`):**  
https://cloud.google.com/run/docs/deploying-source-code#required-roles

---

## Why desktop “just worked” but CI did not

| Principal | Typical roles | What happens |
|-----------|---------------|--------------|
| **You (`ben@symlavault.com`)** | **`roles/owner`** on the project | Every `gcloud` in `deploy.ps1` succeeds; no permission errors. |
| **CI deploy SA** | Only what you **explicitly grant** | Each missing permission fails until IAM is complete. |

The **commands are the same** (`quote-service/deploy.ps1` ≈ `scripts/iap-deploy-quote-service.sh`). The **identity is different**. This doc is the full grant list so you are not discovering permissions one error at a time.

**Conditional IAM:** This project uses **conditional `storage.admin`** for tenant buckets. All **project-level** roles below must use **`--condition=None`** in PowerShell (prompt option **2**).

---

## A. Deployer SA — project roles (`--condition=None`)

These match **Google’s “deploy from source” deployer account** plus what our scripts call beyond that.

| Role | Required by | Why |
|------|-------------|-----|
| **`roles/run.sourceDeveloper`** | [Cloud Run docs](https://cloud.google.com/run/docs/deploying-source-code) | **`gcloud run deploy --source`** — includes `run.locations.uploadSource`, **`storage.buckets.list`**, staging to `run-sources-*` |
| **`roles/run.admin`** | Our `iap-deploy-quote-service.sh` | `gcloud run services add-iam-policy-binding` (invoker on quote/console/integrations), full service update |
| **`roles/serviceusage.serviceUsageConsumer`** | Cloud Run docs | API enablement / consumer |
| **`roles/cloudbuild.builds.editor`** | `--source` (Cloud Build) | Submit builds for source deploy |
| **`roles/artifactregistry.writer`** | Cloud Run docs | Repo `cloud-run-source-deploy` (auto-created per region) |
| **`roles/cloudsql.client`** | Our deploy | Cloud SQL volume on Cloud Run |

**Do not use only `run.admin`** for `--source` — it does **not** include **`storage.buckets.list`** (you hit this in Actions).

---

## B. Deployer SA — `serviceAccountUser` (actAs)

The deploy SA must **`iam.serviceAccounts.actAs`** every identity Cloud Run / Cloud Build uses during **`gcloud run deploy --source`**.

| Service account | Role for deploy SA | Why |
|-----------------|-------------------|-----|
| **`backend-backend-sa@…`** (runtime / Cloud Run identity) | `roles/iam.serviceAccountUser` | Service runs as this SA |
| **`248381849073-compute@developer.gserviceaccount.com`** | `roles/iam.serviceAccountUser` | Default **build** SA for `--source` (error: *caller does not have permission to act as service account …104288244146164866320*) |

Older projects may also use **`PROJECT_NUMBER@cloudbuild.gserviceaccount.com`**; if `gcloud` reports **NOT_FOUND**, skip it — this project uses the **compute default** SA only.

Resolve numeric ID → email:

```powershell
gcloud iam service-accounts list --project=securedbackend-production `
  --format="table(email,uniqueId)" `
  --filter="uniqueId=104288244146164866320"
```

Then grant **`serviceAccountUser`** on that email to **`iap-cloud-agent-deploy@…`**.

---

## C. Deployer SA — Secret Manager (resource-level, no project secret admin)

| Secret | Roles |
|--------|--------|
| `quote-service-hmac` | `secretAccessor`, `secretVersionManager` |
| `REGISTRATION_KEY` | `secretAccessor` |
| `RUNTIME_DB_PASSWORD` | `secretAccessor` |

Do **not** grant `secretmanager.secrets.create` to the deploy SA; secrets are created from PC/terraform once.

---

## D. Deployer SA — GCS

| Resource | Role | Why |
|----------|------|-----|
| `gs://run-sources-securedbackend-production-us-central1` | **`roles/storage.admin`** (bucket-only) | Extra bucket ACL if project roles lag; optional if `run.sourceDeveloper` + bucketViewer suffice |
| `gs://securedbackend-production-ta-{slug}-hub-app` | **`roles/storage.objectAdmin`** | Storefront workflow rsync |
| `gs://securedbackend-production-ta-{slug}-coming-soon-app` | **`roles/storage.objectAdmin`** | Apex rsync |

Tenant buckets may also use your existing **conditional** storage model for other SAs; deploy SA often has **unconditional** `objectAdmin` on `-ta-` buckets from bootstrap.

---

## E. Cloud Build default SA

On **`248381849073-compute@developer.gserviceaccount.com`** (project number **248381849073**):

| Grant | Role | Why |
|-------|------|-----|
| **On the compute SA (project IAM member)** | **`roles/run.builder`** | [Cloud Run source build](https://cloud.google.com/run/docs/deploying-source-code) — build step may fail without this |

Your project may already give that SA **`run.admin`**; if builds still fail, add **`run.builder`** explicitly.

---

## F. WIF (separate from deploy permissions)

GitHub repo **`bengrisinger-lgtm/in_a_pinch`** → **`roles/iam.workloadIdentityUser`** on the deploy SA. See [GITHUB-WIF-DEPLOY.md](./GITHUB-WIF-DEPLOY.md).

---

## G. Apply in code (not ad hoc)

| Mechanism | Location |
|-----------|----------|
| **PowerShell (today)** | `scripts/bootstrap-iap-github-deploy-sa.ps1` — should match sections A–D |
| **Terraform (target)** | `infra/github-wif-deploy-sa.tf` in this repo — apply once per project |
| **New tenant app** | Same WIF SA + add bucket names for new `-ta-{slug}-*`; no new permission archaeology |

After bootstrap matches this doc, **new Cloud Agents** only need: merged workflows, `SYMLFY_BAAS_GITHUB_TOKEN`, and **already-applied** project IAM.

---

## H. Verify deploy SA (PowerShell)

```powershell
$Project = "securedbackend-production"
$DeploySa = "iap-cloud-agent-deploy@securedbackend-production.iam.gserviceaccount.com"

gcloud projects get-iam-policy $Project `
  --flatten="bindings[].members" `
  --filter="bindings.members:serviceAccount:$DeploySa" `
  --format="table(bindings.role)"
```

Expect at least: **`roles/run.sourceDeveloper`**, **`roles/run.admin`**, **`roles/cloudbuild.builds.editor`**, **`roles/serviceusage.serviceUsageConsumer`**.
