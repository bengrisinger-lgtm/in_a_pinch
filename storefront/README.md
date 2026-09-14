# IAP staff hub

`https://hub.inapinchav.com` is the post-login staff home (same idea as LC hub). Public site staff sign-in is `https://auth.inapinchav.com/login`. Logged-out visits to hub redirect there. Do not treat hub as a second login page.

After sign-in: **Rentals** (`#rentals`) is the date-aware catalog, calendar, and cart holds. **Inventory** (`#stock`) is SKU + serial. **Vault** opens the tenant console (`VITE_CONSOLE_URL`, Documents / Signatures / Branding / Domain / Integrations). Photos, customers, reports, and marketing are listed on the hub as later desks — not wired yet.

This is the IAP tenant app, not console-service. The session cookie is HttpOnly. API calls go through the gateway with `credentials: 'include'`. The kit (`createClient`) is used for session validate / logout only. Inventory is `fetch` to `/api/v1/quotes/inventory/*`. Never send `tenant_id` from the browser.

Until renter self-signup exists, this is a **staff** catalog. Public unauthenticated browse would need a different gateway registration (`require_session` is forced true on this spoke).

Add-to-cart calls `POST /holds` (2-hour TTL). Checkout is **Order → Details & Delivery → Agreement → Payment**. Details (`POST /api/v1/quotes/checkout`) is staff-filled: renter name/email/phone, pickup vs delivery, event address, one-way miles/minutes. Delivery fee is four legs × $0.66/mi + $30/hr on pinch-service — not a client-supplied amount. Maps/GPS later. Agreement uses kit `client.signing.applyTemplate` (tenant-placed blocks in Signatures → Templates; signer app, not a typed name, canvas, or default corner box on this page) and `PATCH`es the envelope UUID onto the quote. Payment is Square Payment Link or staff Mark paid. **No card PAN. No typed-name signature.** Renter magic-link signup is later; do not send renters through platform Create Account.

## Local

```powershell
cd micro-applications/in-a-pinch/storefront
copy .env.example .env
npm install
npm run dev
```

Opens `http://localhost:5174`. Login redirects to `VITE_AUTH_URL`. After login, CORS / cookie scope must include this origin (apex cookie does not include `localhost`). For a real session, host this app on an IAP host (`*.inapinchav.com`).

`npm test` greps the source: no JWT, no `localStorage` secrets, no PAN fields, no canvas / typed-name signature, kit `client.signing`, no `@securedbackend/sdk/server`.

## Live API

`VITE_API_GATEWAY_URL=https://api.inapinchav.com`  
`VITE_SIGNER_URL=https://sign.symlavault.com` (kit invite host; `sign.inapinchav.com` is Application Not Found until a `sign` app exists)

**Vault** is `https://hub.{apex}/console/index.html` on the same host (same cookie). Do not point it at `app.symlavault.com` — that kicks staff to `auth.symlavault.com/login` (`RECURRING-BUG-CLASSES.md` §19). The overlay uses IAP colors and a Hub / Rentals / Stock / Vault bar. Rebuild with `.\build-console-overlay.ps1` before `.\deploy.ps1` so hub rsync `--delete` does not drop `/console/`.

Staff calls through `api.*` **401 until gateway HMAC cutover**. Do **not** deploy `api-gateway` until LC spokes verify the minted secret. The UI still talks to the correct path.

## Deploy

Host is `https://hub.inapinchav.com` (reserved tenant subdomain already on the cert and URL map). Do not upload to the coming-soon landing bucket. Do not use a new slug such as `storefront` — that host is not on the URL map and would serve marketing.

```powershell
cd D:\GrizzTeam_Application\micro-applications\in-a-pinch\storefront
.\deploy.ps1 -Build
```

The Applications page must already have an IAP app whose **name is `hub`** (the wizard mints the slug from the name). After rsync, click **Deploy** on that app so app-resolver sees `status=active`. Do not add this app to the Loan Conduit `deploy-to-gcs.ps1`. Do not terraform apply unless Ben asks. Do not deploy `api-gateway` until LC spokes verify HMAC.

Pinch-service (inventory tables) must already be deployed:

```powershell
cd D:\GrizzTeam_Application\micro-applications\in-a-pinch\quote-service
.\deploy.ps1 -TenantId "987bcdaf-320d-46bf-bfb3-4bdcdffe1de1"
```

HMAC is already minted; register will not print it again.

## Stock

`#stock` — add SKU + serial. Same tables the catalog and calendar read.
