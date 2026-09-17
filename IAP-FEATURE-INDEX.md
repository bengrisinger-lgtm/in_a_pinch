# In-a-Pinch — feature index

**Audience:** Developers and agents finding IAP behavior without spelunking the whole monorepo. Platform contract: `micro-applications/TENANT-SECURITY-RULES.md`. Product boundary: `SYMLAVAULT-ALIGNMENT.md` (IAP is a tenant app, not the vault).

**Execution playbook:** `OCTOBER-BUILD-PLAYBOOK.md` (IAP October slices). **Do not** put IAP business in `console-service`.

**Deploy hosts:** Hub staff `https://hub.inapinchav.com/` · Consumer shop `https://inapinchav.com/` · API via gateway · Backend Cloud Run `quote-service` (pinch/quote store).

---

## How to read a row

| Column | Meaning |
|--------|---------|
| **ID** | Stable name (use in changelog + playbook) |
| **Status** | Live + date, or Planned |
| **User-visible** | Who sees it |
| **Backend** | Service + main routes |
| **Data** | Tenant schema tables / GCS paths |
| **Deploy** | What Ben runs (high level) |

---

## Live features

| ID | Status | User-visible | Backend | Data | Deploy / notes |
|----|--------|--------------|---------|------|----------------|
| IAP-8 | Live | Catalog, calendar, cart holds | `quote-service` `/inventory/*` | `inventory_skus`, `inventory_units`, `inventory_reservations` | `quote-service/deploy.ps1` + hub storefront |
| IAP-G | Live 2026-09-14 | Guest checkout on apex | `POST /checkout` guest session | `customers`, `quotes` | pinch + hub + apex |
| IAP-Apex | Live 2026-09-14 | Consumer shop on apex | Same SPA; `isConsumerSurface()` | — | `storefront/deploy.ps1 -AppSlug coming-soon` |
| IAP-Cart | Live 2026-09-14 | Continue shopping; still-shopping prompt | `POST /holds/extend` | holds | pinch + storefront |
| IAP-UX | Live 2026-09-14 | Logos, billing, categories | categories API + billing helpers | `inventory_categories` | pinch + storefront |
| IAP-Catalog-UX | Live 2026-09-15 | Dates banner on catalog | storefront only | — | hub + apex |
| IAP-Stock-Hold | Live 2026-09-15 | Add-to-cart holds; Stock categories | inventory + `expireStaleHolds` | same inventory tables | pinch + hub |
| Platform-Session-Idle | Live 2026-09-15 | 60 min idle; modal hub staff + vault consoles | auth-service + SDK | — | auth + console/operator + hub |
| IAP-Sticky-Cart | Live 2026-09-15 | Sticky cart; 2h sign / 24h pay after renter signs | checkout PATCH, `renterHasSigned` | quotes + holds | pinch + hub + apex |
| IAP-Catalog-Media | Live 2026-09-16 | SKU description + photo on catalog (hub + apex) | `PATCH /skus`, `POST .../catalog-image` | `description`, `image_url`; GCS `catalog-media/{skuId}.ext` | pinch + hub + apex; optional `$env:CATALOG_MEDIA_BUCKETS` |
| IAP-Stock-Ops | Live 2026-09-16 | Category delete (type DELETE); retired serials hidden; remove photo | categories delete uncategorizes SKUs | `customers` unique email index | pinch + hub |
| IAP-Orders-Phone | Live 2026-09-16 | Phone on Orders list | `GET /quotes` includes `customer_phone` | `customers.phone` | pinch + hub |
| IAP-Stock-Codes | Live 2026-09-17 | Unit codes `MIC-0001`; Manage categories modal; retired SKUs off Stock | `stockCodes.js`, category prefix PATCH, unit POST | `stock_prefix`, `stock_code`, `inventory_stock_sequences` | pinch + hub |
| IAP-Catalog-Photo-UX | Live 2026-09-17 | Orange banner + thumb; lightbox; apex tenant recovery | `catalogImage.js` public read; storefront guest remint | GCS `catalog-media/`; default both buckets in deploy | pinch + hub + apex; TenantId `987bcdaf-320d-46bf-bfb3-4bdcdffe1de1` |
| IAP-Customers-Hub | Live 2026-09-17 | Hub Customers list; search; merge/edit/remove | `customers.js` staff routes | `customers.first_name`, `last_name` | pinch + hub |
| IAP-Staff-Onboarding | Live 2026-09-17 | New hire entry; onboarding gate; custom profile fields | `staff.js` `/staff/*` | `staff_members`, `staff_profiles`, `staff_profile_field_defs` | pinch + hub; invite via Vault Projects |

**Catalog media security:** Public storefront assets only — **not** vault §8 document scan path. Staff-only upload; https or `/catalog-media/` paths validated.

**Storefront deploy:** `deploy.ps1` rsync **excludes** `catalog-media/` so uploads survive deploys.

---

## Planned (October+ — do not start unless playbook says so)

| ID | Feature | Notes |
|----|---------|-------|
| IAP-N1 | Itemized gear on signed agreement PDF | November |
| IAP-CRM | Contacts / leads / venues / promoters | Beyond **IAP-Customers-Hub** (renters only); multi-role — later |
| IAP-Open-Board | Staff “open rentals” view (gear + customer + phone) | Extend `#orders` / new hub nav |
| IAP-Find-Retired | Restore retired serials UI | After retired hidden (IAP-Stock-Ops) |
| IAP-SMS | Phone proof at checkout | Pulled from IAP-G; later |
| IAP-Maps | Delivery mileage automation | Later |

---

## Key paths (repo)

| Area | Path |
|------|------|
| Quote + inventory API | `micro-applications/in-a-pinch/quote-service/` |
| Hub + apex SPA | `micro-applications/in-a-pinch/storefront/` |
| Catalog image helper | `storefront/src/lib/catalogImage.ts` |
| Upload implementation | `quote-service/src/catalogImage.js` |
