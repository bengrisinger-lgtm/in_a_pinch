# Quote store (this tenant app)

Staff-session API for customers, quotes, **serial inventory**, and the **IAP booking calendar**.
Tables are created in schema `t_<tenant-uuid-without-hyphens>` on the shared
Postgres. PDFs and signatures stay in the kit (`document_id`, `envelope_id`
on the quote). This service does **not** live in console-service.

A checkout **hold** lasts **two hours**, then it stops blocking that serial.
Confirmed (paid) reservations do not expire. Pushing a paid booking onto
Cadel’s Outlook/Google calendar is a later one-way automation, not this table.

## Auth

Gateway session cookie → HMAC headers. This process verifies with
`createServerClient({ hmacSecret: process.env.HMAC_SECRET })`.
Never mount `COOKIE_SECRET`. Never send tenant id from the browser.

## Deploy (Cloud Run + register)

From this directory, with gcloud logged in:

```powershell
.\deploy.ps1 -TenantId "<uuid from the operator console>"
```

If `TF_VAR_gcp_project_id` is not already in the shell, the script loads `symlfy-baas/syml-platform/infra/set-env.ps1 production`.

That script:

1. Stages a Cloud Build context that vendors `@securedbackend/sdk` (the local `file:` path will not install in Cloud Build).
2. Deploys Cloud Run with `{prefix}_app_runtime` + `RUNTIME_DB_PASSWORD`. **Does not** mount `COOKIE_SECRET`.
3. `POST /auth/services` with `path_prefix` `/api/v1/quotes` and this tenant id.
4. Stores the minted `hmac_secret` (once) in Secret Manager `quote-service-hmac`. Re-runs do not print it again.

Do **not** run baas `deploy.ps1` for this spoke. Do **not** terraform apply. Do **not** deploy `api-gateway` from here. Live gateway still signs tenant proxies with `COOKIE_SECRET`; staff calls through `api.*` will 401 until that cutover.

Optional: `-AllowedOrigins "https://…,https://…"` (no `*`). `-SkipTests`. `-SkipRegister`.

## Register

If you are not using `deploy.ps1`: `POST /auth/services` as a non-core spoke.

- `path_prefix`: `/api/v1/quotes`
- `require_session`: forced true
- Save `hmac_secret` (once) into Secret Manager / Cloud Run `HMAC_SECRET`
- Optional `TENANT_ID` (reject other tenants)

## Env

| Var | Role |
|-----|------|
| `HMAC_SECRET` | Minted at register |
| `DB_HOST` `DB_USER` `DB_PASSWORD` `DB_NAME` | Runtime role, same instance as the vault |
| `ALLOWED_ORIGINS` | Staff frontend origins (comma-separated). No `*` |
| `TENANT_ID` | Optional lock: HMAC tenant must match |
| `PORT` | Default 8080 |

## Staff routes (after gateway)

Prefix `/api/v1/quotes`:

- `POST /customers` `GET /customers`
- `POST /` `GET /` `GET /:id`
- `POST /:id/payments` (staff-recorded until Square)

Inventory (prefix `/api/v1/quotes/inventory`):

- `POST /skus` `GET /skus`
- `POST /skus/:skuId/units` `GET /skus/:skuId/units` (serial numbers)
- `GET /availability?sku_id=&starts_on=&ends_on=` — N of M plus per-serial free/busy
- `GET /skus?starts_on=&ends_on=` — catalog list with `units_available` + `band` for those dates
- `GET /calendar?sku_id=&year=&month=` — per-day plenty / limited / fully booked
- `POST /holds` — `{ unit_id }` or `{ sku_id, quantity }` + dates. Hold TTL 2 hours.
- `POST /holds/:id/confirm` (paid / committed) `POST /holds/:id/cancel`

Delivery miles / drive time / fee are columns on the quote. Maps pricing
is this app’s job later, not a vault API.

## Tests

```
npm test
```
