# IAP deploy: local PC vs GitHub Actions / Cloud Agent

**GrizzTeam PC = PowerShell only.** Use `storefront\deploy.ps1`, `quote-service\deploy.ps1`, and `gcloud` from **PowerShell**. Doc blocks labeled **bash** are for **GitHub Actions / Linux Cloud Agents** — not for copy-paste on your machine.

Your machine uses a **parent folder** layout (see `storefront/package.json`):

```text
<parent>/
  symlfy-baas/
    syml-platform/client-sdk/
    console-app/
  micro-applications/in-a-pinch/
    storefront/          ← file:../../../symlfy-baas/syml-platform/client-sdk
    storefront/deploy.ps1
```

## What local `deploy.ps1 -Build` actually does

1. `npm test` + `npm run build` in **storefront only**
2. Does **not** run `npm run build` in `client-sdk`
3. Uses whatever `@securedbackend/sdk` **dist/** is already on disk from your platform checkout
4. Optional: `build-console-overlay.ps1` then rsync `dist/` and `console-dist/` to GCS

Remote automation must **match that layout and those steps**. Checking out `in_a_pinch` and `symlfy-baas` as siblings inside the repo root breaks `file:../../../symlfy-baas` unless paths are rewritten.

GitHub Actions check out **`in_a_pinch` at repo root** and **`symlfy-baas` as a sibling folder**, then `scripts/link-symlfy-sdk-for-npm.sh` rewrites the `file:` SDK path for that layout (working tree only — not committed).

## Platform repo access

Agents and CI need read access to **private** `symlfy-baas`:

| Surface | What to configure |
|--------|-------------------|
| GitHub Actions | Secret `SYMLFY_BAAS_GITHUB_TOKEN` (Contents read on `symlfy-baas`) |
| Cloud Agent | `.cursor/environment.json` → `repositoryDependencies` + GitHub app access to `symlfy-baas` |

Without that repo, automation only sees `in_a_pinch` and guesses SDK/console build steps.

## Files that define the real contract (in symlfy-baas)

If remote deploy still diverges from your PC, these are the source of truth:

| Path | Why |
|------|-----|
| `syml-platform/client-sdk/package.json` | `exports`, `main`, build scripts (browser vs Node `transport.js`) |
| `syml-platform/client-sdk/dist/*` | What Vite actually bundles when SDK is not rebuilt |
| `console-app/package.json` | Overlay build (`npm run build -- --base=/console/`) |
| `deploy-tenant-app.ps1` (repo root) | Established micro-app upload pattern (see `coming-soon/README.md`) |
| `syml-platform/infra/set-env.ps1` | GCP project id for `gcloud` (storefront `deploy.ps1` loads this) |

## IAP-only deploy entrypoints (this repo)

| Local | Remote equivalent |
|-------|-------------------|
| `storefront/build-console-overlay.ps1` | `scripts/iap-build-console-overlay.sh` |
| `storefront/deploy.ps1 -Build` | Actions **Deploy IAP storefront** |
| `storefront/deploy.ps1 -AppSlug coming-soon` | Same workflow, apex upload step |
| Hub `/console/` only | Actions **Deploy IAP hub console overlay** |
| `quote-service/deploy.ps1 -TenantId …` | **Actions → Deploy IAP quote-service** or `bash scripts/iap-deploy-quote-service.sh` (Cloud Agent) |
