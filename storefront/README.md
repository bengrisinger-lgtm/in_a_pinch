# IAP storefront

Two hosts, one Vite app. Host decides the surface — not the session role.

| Host | Who | What |
|---|---|---|
| `https://inapinchav.com` | Renters | Consumer shop. Guest HttpOnly cookie. Catalog → cart → details → kit → Square. |
| `https://hub.inapinchav.com` | Staff | Login wall. Stock, orders, mark paid, Vault overlay. |
| `https://auth.inapinchav.com/login` | Staff | Sign-in. Apex Staff link redirects here then **hub**, not back to the shop. |

A staff cookie on the apex must not open Hub / Stock / Orders. Local Vite
(`localhost`) is the staff hub so `npm run dev` keeps the login wall.
`VITE_STOREFRONT_SURFACE=consumer` forces the shop in local if you need it.

This is the IAP tenant app, not console-service. The session cookie is HttpOnly.
API calls go through the gateway with `credentials: 'include'`. Never send
`tenant_id` from the browser.

Checkout is **Order → Details & Delivery → Agreement → Payment**. Agreement
uses kit `client.signing.applyTemplate`. Payment is Square Payment Link or
staff Mark paid (hub only). **No card PAN. No typed-name signature.** Do not
send renters through platform Create Account.

## Local

```powershell
cd micro-applications/in-a-pinch/storefront
copy .env.example .env
npm install
npm run dev
```

Opens `http://localhost:5174` as the **staff hub**. Login redirects to
`VITE_AUTH_URL`. After login, CORS / cookie scope must include this origin
(apex cookie does not include `localhost`). For a real session, host this app
on an IAP host (`*.inapinchav.com`).

`npm test` greps the source: no JWT, no `localStorage` secrets, no PAN fields,
no canvas / typed-name signature, kit `client.signing`, host split, no
`@securedbackend/sdk/server`.

## Live API

`VITE_API_GATEWAY_URL=https://api.inapinchav.com`  
`VITE_SIGNER_URL=https://sign.symlavault.com` (kit invite host; `sign.inapinchav.com` is Application Not Found until a `sign` app exists)

**Vault** is `https://hub.{apex}/console/index.html` on the same host (same cookie). Do not point it at `app.symlavault.com` — that kicks staff to `auth.symlavault.com/login` (`RECURRING-BUG-CLASSES.md` §19). The overlay uses IAP colors and a Hub / Rentals / Stock / Vault bar. Rebuild with `.\build-console-overlay.ps1` before `.\deploy.ps1` so hub rsync `--delete` does not drop `/console/`.

## Deploy

Same `dist/` goes to two buckets. Hub keeps `/console/`. Coming-soon does not.

```powershell
cd D:\GrizzTeam_Application\micro-applications\in-a-pinch\storefront
.\build-console-overlay.ps1
.\deploy.ps1 -Build
.\deploy.ps1 -AppSlug coming-soon
```

Do not use `in-a-pinch-apex\deploy.ps1` — it refuses so Coming Soon HTML
cannot overwrite the shop. Do not add this app to the Loan Conduit
`deploy-to-gcs.ps1`. Do not terraform apply unless Ben asks. Do not deploy
`api-gateway`.

Pinch-service (inventory tables) must already be deployed. HMAC is already minted.

## Stock

`#stock` on the **hub** — add SKU + serial. Same tables the catalog and calendar read.
