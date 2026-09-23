# Agent read-first (SymlaVault + IAP)

SymlaVault is **fail-closed**. Shortcuts that “make it work” without matching platform invariants will be rejected by gateway, RLS, HMAC, or migrations — by design.

Read in this order before changing deploy scripts, auth, or tenant backends:

1. **`symlfy-baas/RECURRING-BUG-CLASSES.md`** — pattern-match on sight (§1 migrations, §18 hub/spoke CORS+allowlist, §19 tenant console host, §20 Cloud Run `file:` deps).
2. **`symlfy-baas/TENANT-SECURITY-RULES.md`** — tenant integration MUST/MUST NOT.
3. **`symlfy-baas/SECURITY-WHITEPAPER.md` §23–§24** — hub-spoke boundary and RLS (platform); skim §6.9 fail-closed HMAC.
4. **This repo:** [IAP-FEATURE-INDEX.md](../IAP-FEATURE-INDEX.md), [CLOUD-FIRST-DEPLOY.md](./CLOUD-FIRST-DEPLOY.md), [DEPLOY-PARITY-LOCAL-VS-CI.md](./DEPLOY-PARITY-LOCAL-VS-CI.md).

**Do not** from IAP repos: `terraform apply`, `api-gateway` deploy, mount `COOKIE_SECRET` on quote-service, or patch storefront around backend 500s when §1 migration ordering is the cause.

**Ship without a PC:** GitHub Actions workflows in `.github/workflows/iap-deploy-*.yml` (see CLOUD-FIRST-DEPLOY).

## Where agents edit living docs

| Doc | Canonical path | Scope |
|-----|----------------|--------|
| Recurring bug classes | `symlfy-baas/RECURRING-BUG-CLASSES.md` (repo **root**) | All GrizzTeam repos |
| IAP changelog | `in_a_pinch/docs/CHANGELOG-IAP.md` | Tenant IAP only |
| IAP build playbook | `in_a_pinch/docs/OCTOBER-BUILD-PLAYBOOK.md` | Deploy slices + checklists |

Cloud Agent checkout: `/symlfy-baas/RECURRING-BUG-CLASSES.md` after `repositoryDependencies` + install. Stub in this repo: [RECURRING-BUG-CLASSES.md](./RECURRING-BUG-CLASSES.md).
