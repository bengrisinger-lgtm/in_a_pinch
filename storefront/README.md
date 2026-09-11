# IAP staff hub

`https://hub.inapinchav.com` is the post-login staff home (same idea as LC hub). Public site staff sign-in is `https://auth.inapinchav.com/login`. Logged-out visits to hub redirect there. Do not treat hub as a second login page.

After sign-in: **Rentals** (`#rentals`) is the date-aware catalog, calendar, and cart holds. **Inventory** (`#stock`) is SKU + serial. Photos, customers, reports, and marketing are listed on the hub as later desks — not wired yet.

This is the IAP tenant app, not console-service. The session cookie is HttpOnly. API calls go through the gateway with `credentials: 'include'`. The kit (`createClient`) is used for session validate / logout only. Inventory is `fetch` to `/api/v1/quotes/inventory/*`. Never send `tenant_id` from the browser.

Until renter self-signup exists, this is a **staff** catalog. Public unauthenticated browse would need a different gateway registration (`require_session` is forced true on this spoke).

Add-to-cart calls `POST /holds` (2-hour TTL). Checkout details, kit agreement, and Square are later playbook steps. **No card PAN. No typed-name signature.**

## Local

```powershell
cd micro-applications/in-a-pinch/storefront
copy .env.example .env
npm install
npm run dev
```

Opens `http://localhost:5174`. Login redirects to `VITE_AUTH_URL`. After login, CORS / cookie scope must include this origin (apex cookie does not include `localhost`). For a real session, host this app on an IAP host (`*.inapinchav.com`).

`npm test` greps the source: no JWT, no `localStorage` secrets, no PAN fields, no `@securedbackend/sdk/server`.

## Live API

`VITE_API_GATEWAY_URL=https://api.inapinchav.com`

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
