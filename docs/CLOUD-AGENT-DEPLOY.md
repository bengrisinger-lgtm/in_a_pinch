# Cloud Agent deployment (IAP)

Run **hub**, **apex**, and **quote-service** deploys from a Cursor Cloud Agent or **GitHub Actions** (see [CLOUD-FIRST-DEPLOY.md](./CLOUD-FIRST-DEPLOY.md)) — not from a desktop PC.

## Full SymlaVault scope (platform + micro-apps)

SymlaVault is **fail-closed by design**: gateway, auth, tenant rules, and micro-apps must stay aligned. Agents that only see one app repo will mis-diagnose (patch IAP when the gateway is wrong, or vice versa).

**Goal:** every Cloud Agent that works on tenants (IAP, Loan Conduit, etc.) also has a **read checkout of `symlfy-baas`** at the same relative paths as your PC (`../../../symlfy-baas` from `micro-applications/.../storefront`).

### Why agents often see only `in_a_pinch`

Cursor can run a **Personal** saved environment for a repo. That override may list **only the primary repo**, even when `.cursor/environment.json` on the branch already declares `repositoryDependencies` for `symlfy-baas`. Fix one of:

1. **Prefer repo-managed config (recommended):** merge `.cursor/` on `main`, open [Cloud Agents → Environments](https://cursor.com/dashboard/cloud-agents/environments), and use / attach the **repository** environment from `in_a_pinch` (not a stale Personal snapshot that omits dependencies).
2. **Or edit Personal environment:** add **`github.com/bengrisinger-lgtm/symlfy-baas`** under repository / additional repos (same string as in `environment.json` — no `https://`, no trailing slash).

Then **GitHub → Settings → Applications → Cursor → Configure** → grant **read** on **`symlfy-baas`** (and any other private repos you use).

Start a **new** agent after Save. On boot, install should find baas at `../symlfy-baas` or via `SYMLFY_BAAS_ROOT`.

### Optional: platform-first environment

For gateway / Loan Conduit / console work, you can instead attach the environment to **`symlfy-baas` as the primary repo** and add micro-app repos as `repositoryDependencies`. Same GitHub app read access; inverted “home” repo.

### GitHub Actions (deploy) vs Cloud Agent (diagnose)

| Need | Where |
|------|--------|
| Clone private `symlfy-baas` in CI | `in_a_pinch` secret **`SYMLFY_BAAS_GITHUB_TOKEN`** |
| Agent reads platform source on the VM | **`repositoryDependencies`** + GitHub app on `symlfy-baas` |
| Production deploy IAM | WIF / `GCP_SA_KEY_JSON` (unchanged) |

Agents diagnose; Actions (or your PC `deploy.ps1`) ship. Both need baas checkout for builds that import `@securedbackend/sdk` or `console-app`.

---

## One-time environment setup

### A. Open the right place in Cursor

1. Sign in at [cursor.com](https://cursor.com).
2. Open **Dashboard** (avatar menu → **Dashboard**, or go to [Cloud Agents → Environments](https://cursor.com/dashboard/cloud-agents/environments)).
3. Open the environment tied to **`bengrisinger-lgtm/in_a_pinch`** (personal env example: [079c4a27-b770-11f1-bb68-864e54d14197](https://cursor.com/dashboard/cloud-agents/environments/e/079c4a27-b770-11f1-bb68-864e54d14197)).
4. On that environment page you should see sections such as **Repositories**, **Secrets**, **Network / egress**, and **Builds**. Exact labels can vary slightly; look for **Secrets** and repo / dependency access.

After you change secrets or repo access, **Save** the environment and start a **new** Cloud Agent (old pods do not pick up new secrets).

### B. Platform repo (`symlfy-baas`)

This repo’s `.cursor/environment.json` already lists:

```json
"repositoryDependencies": [
  "github.com/bengrisinger-lgtm/symlfy-baas"
]
```

You still need Cursor to **clone** that repo when the agent starts:

1. In the environment settings, find **Repository dependencies** or **Additional repositories** (wording varies).
2. Confirm **`github.com/bengrisinger-lgtm/symlfy-baas`** is included (same string as above — no `https://`, no trailing slash).
3. Under **GitHub access** / **Connected repositories**, ensure the GitHub account or org connection can read **private** `symlfy-baas` (install or approve the Cursor GitHub app on that repo if it is private).

Repo URL for your notes: [https://github.com/bengrisinger-lgtm/symlfy-baas](https://github.com/bengrisinger-lgtm/symlfy-baas)

### C. Secret `GCP_SA_KEY_JSON` — where it comes from

This is **not** in Cursor. You create it once in **Google Cloud** and paste the **entire JSON file** into the environment secret named exactly **`GCP_SA_KEY_JSON`**.

**1. Create a dedicated service account (recommended name: `iap-cloud-agent-deploy`)**

- Console: [Google Cloud Console → IAM](https://console.cloud.google.com/iam-admin/serviceaccounts) (project **`securedbackend-production`**).
- **Create service account** → name e.g. `iap-cloud-agent-deploy` → Create.
- **Grant roles** (storefront-only minimum):
  - **Storage Object Admin** on the two IAP buckets only (narrower than project-wide):
    - `securedbackend-production-ta-cadel-7414-hub-app`
    - `securedbackend-production-ta-cadel-7414-coming-soon-app`  
    (IAM → select bucket → Permissions → Grant access → principal = that SA → role **Storage Object Admin**.)
  - Or, if you already use a deploy SA locally with `gcloud storage rsync`, you may reuse that SA instead of creating a new one.

**2. Create a JSON key**

- Open the service account → **Keys** → **Add key** → **Create new key** → **JSON** → download.
- Open the downloaded `.json` in a text editor. The whole file looks like `{ "type": "service_account", "project_id": "...", ... }`.

**3. Paste into Cursor**

- Environment → **Secrets** → **Add secret**.
- **Name:** `GCP_SA_KEY_JSON` (must match exactly).
- **Value:** paste the **full JSON** (one object). Do not commit this file to git.

**4. Rotate / delete**

- Delete the downloaded JSON from your laptop after pasting if you can; store only in Cursor secrets (and GCP’s key list).
- If the key leaks, delete it in GCP and create a new key.

Optional secret **`SYMLFY_BAAS_ROOT`**: only if install cannot find the symlfy-baas checkout automatically.

### D. Merge config and build

1. **Commit** `.cursor/environment.json` is the source of truth once merged. Merge [PR #1](https://github.com/bengrisinger-lgtm/in_a_pinch/pull/1) or ensure `main` has the `.cursor/` files.
2. In the environment, run **Build** (or ask an agent to trigger a build from **`main`**) so the Dockerfile (Node + `gcloud`) is baked in.
3. Approve **egress** for **Docker Hub** (`registry-1.docker.io`) if Cursor prompts — needed to pull the base image.

### Secrets summary

| Secret | Required for | Purpose |
|--------|----------------|---------|
| `GCP_SA_KEY_JSON` | GCS deploy | Full service account JSON from GCP |
| `SYMLFY_BAAS_ROOT` | Optional | Absolute path to symlfy-baas if auto-detect fails |

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

### Quote-service (Cloud Run — no PC)

Same as GitHub Actions (preferred from phone: **Actions → Deploy IAP quote-service**):

```bash
bash scripts/iap-deploy-quote-service.sh
```

Requires the deploy service account (WIF in Actions, or `GCP_SA_KEY_JSON` on the agent) with Cloud Run + Secret Manager IAM — see `docs/GITHUB-WIF-DEPLOY.md`.

PowerShell `quote-service/deploy.ps1` remains for parity on a GrizzTeam PC but is **not** required.

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
