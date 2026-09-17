# Quote store (this tenant app)

Staff-session API for customers, quotes, **serial inventory**, and the **IAP booking calendar**.
Tables are created in schema `t_<tenant-uuid-without-hyphens>` on the shared
Postgres. PDFs and signatures stay in the kit (`document_id`, `envelope_id`
on the quote). This service does **not** live in console-service.

A checkout **hold** lasts **two hours**, then it stops blocking that serial.
Confirmed (paid) reservations do not expire. After **paid**, pinch-service
asks integrations-service (OIDC) to copy the booking onto the connected
calendar (Outlook first if both are linked). IAP serial stock stays the
source of truth. A calendar failure does **not** un-pay.

## Auth

Gateway session cookie → HMAC headers. This process verifies with
`createServerClient({ hmacSecret: process.env.HMAC_SECRET })`.
Never mount `COOKIE_SECRET`. Never send tenant id from the browser.

## Deploy (Cloud Run + register)

From this directory, with gcloud logged in:

```powershell
.\deploy.ps1
# defaults to TenantId 987bcdaf-320d-46bf-bfb3-4bdcdffe1de1 (In A Pinch / cadel-7414)
```

If `TF_VAR_gcp_project_id` is not already in the shell, the script loads `symlfy-baas/syml-platform/infra/set-env.ps1 production`.

That script:

1. Stages a Cloud Build context that vendors `@securedbackend/sdk` (the local `file:` path will not install in Cloud Build).
2. Deploys Cloud Run with `{prefix}_app_runtime` + `RUNTIME_DB_PASSWORD`. **Does not** mount `COOKIE_SECRET`.
3. `POST /auth/services` with `path_prefix` `/api/v1/quotes` and this tenant id.
4. Stores the minted `hmac_secret` (once) in Secret Manager `quote-service-hmac`. Re-runs do not print it again.

Do **not** run baas `deploy.ps1` for this spoke. Do **not** terraform apply. Do **not** deploy `api-gateway` from here. Live gateway still signs tenant proxies with `COOKIE_SECRET`; staff calls through `api.*` will 401 until that cutover.

Optional: `-AllowedOrigins "https://hub.example.com"` (must include the staff hub origin for CORS + Square return). No `*`. `-SkipTests`. `-SkipRegister`.

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
| `CONSOLE_SERVICE_URL` | Cloud Run URL of console-service. Spoke mints OIDC and `GET /internal/tenant-credentials/:tenantId/square`. Do **not** mount `TOKEN_ENCRYPTION_KEY` here |
| `INTEGRATIONS_SERVICE_URL` | Cloud Run URL of integrations-service. Spoke mints OIDC and `POST /internal/calendar/events` after pay. Do **not** mount `TOKEN_ENCRYPTION_KEY` or `COOKIE_SECRET` here |
| `CALENDAR_TIMEZONE` | Default `America/Denver`. All-day events on the connected calendar |
| `CALENDAR_PROJECT_ID` | Tenant-console project UUID that holds Gmail/Outlook tokens. Required when hub HMAC has no `projectId` (tokens are FORCE-RLS on `project_id`) |
| `CALENDAR_USER_ID` | Optional. Calendar owner’s user UUID. Else quote `created_by`, else any connected user in that project |
| `SQUARE_ACCESS_TOKEN` | Optional local/test fallback only. Production reads Credentials (`provider` slug `square`) |
| `SQUARE_LOCATION_ID` | Optional. Else the first active Square location |
| `SQUARE_API_BASE` | Default `https://connect.squareup.com` |
| `PORT` | Default 8080 |

## Staff routes (after gateway)

Prefix `/api/v1/quotes`:

- `POST /customers` `GET /customers`
- `POST /` `GET /` `GET /:id`
- `PATCH /:id` — store kit `document_id` / `envelope_id` (UUIDs only) and optional signing tokens so staff can reopen links. HMAC tenant in `WHERE`. Ignores body `tenant_id`.
- `POST /:id/cancel` — cancel unpaid quote and release holds. Paid quotes refund (Square if a payment exists) then `refunded`.
- `GET /?q=` — staff search by customer name or email.
- `POST /:id/awaiting-payment` — after both kit signers finish; extends unpaid hold to 24 hours.
- `POST /checkout` — staff: renter + pickup/delivery + attach holds. Delivery fee is four legs × $0.66/mi + $30/hr from one-way miles/minutes (Maps later). Ignores client `delivery_fee`. Does not confirm holds until paid. `renter_magic_link` is null until renter self-signup.
- `POST /:id/payment-link` — Square Payment Link from **server** quote total. Redirects the renter/staff to Square. No PAN. Needs vaulted `square` credential (console-service reveal) after console-service is redeployed with `CONSOLE_CREDENTIAL_REVEAL_ALLOWLIST`.
- `POST /:id/payments` — staff mark-paid (default). Confirms attached holds and sets quote `paid`, then one-way copies the booking onto the connected calendar. Response includes `calendar: { pushed, reason?, provider?, eventId? }`. Webhooks are later (V11-011). Calendar failure does **not** un-pay.

Inventory (prefix `/api/v1/quotes/inventory`):

- `POST /skus` `GET /skus` — optional `description`, `image_url` (https or `/catalog-media/{skuId}.ext`)
- `PATCH /skus/:skuId` — `description`, `image_url`, name, category, rate, active
- `POST /skus/:skuId/catalog-image` — staff JSON `{ content_type, data_base64 }` (max 2MB); writes to `CATALOG_MEDIA_BUCKETS` and sets `image_url`
- `POST /skus/:skuId/units` `GET /skus/:skuId/units` (serial numbers)
- `GET /availability?sku_id=&starts_on=&ends_on=` — N of M plus per-serial free/busy
- `GET /skus?starts_on=&ends_on=` — catalog list with `units_available` + `band` for those dates
- `GET /calendar?sku_id=&year=&month=` — per-day plenty / limited / fully booked
- `POST /holds` — `{ unit_id }` or `{ sku_id, quantity }` + dates. Cart hold 15 minutes; 2 hours after send; 24 hours after both sign if still unpaid. Paid bookings do not expire.
- `POST /holds/:id/confirm` (paid / committed) `POST /holds/:id/cancel`

Delivery miles / drive time / fee are columns on the quote. Maps pricing
is this app’s job later, not a vault API.

## Tests

```
npm test
```
