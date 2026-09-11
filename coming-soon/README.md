# In a Pinch A/V — Coming Soon Page

Single-page static site that lives at `inapinchav.com` until the full Figma-designed
storefront (in `../../inapinch-figma/`) is production-ready.

## What's here

| File | Role |
|---|---|
| `index.html` | Single-page coming-soon — logo, brand tagline, equipment categories, contact CTA |
| `style.css` | Brand palette pulled from the lobster-claw logo (warm orange/red on cream/peach) |
| `pinch-logo.png` | Copied from `../../inapinch-figma/public/pinch-logo.png` (670×670) |

## Image quality note

The current `pinch-logo.png` is 670×670 — fine for the coming-soon page (renders at
180px on desktop, 140px on mobile, so 2x retina coverage is safe). When the full
storefront ships, replace with a higher-resolution source so it doesn't soften on
larger viewports.

The Figma's `header-banner.png` (1471×396) is **not** used here — coming-soon
intentionally avoids it since it's borderline-low-res and would look soft on
1920px+ displays. Bring in a hi-res banner before launching the full storefront.

## Deploy

Use `deploy-tenant-app.ps1` (NOT `deploy-static-app.ps1` — that one's for
platform-owned static apps like scan / hub on `*.symlavault.com`).

```powershell
cd d:\GrizzTeam_Application\symlfy-baas
.\deploy-tenant-app.ps1 -Slug cadel-7414 -SourcePath ..\micro-applications\in-a-pinch\coming-soon
```

The script auto-loads the production env. Tenant slug for IAP is
**`cadel-7414`** (verified 2026-05-07 — visible in the operator console
tenant detail page; tenant ID is `987bcdaf-320d-46bf-bfb3-4bdcdffe1de1`).

**Bucket pre-req:** the script throws if `gs://securedbackend-production-tenant-cadel-7414-app`
doesn't exist yet. Bucket provisioning happens via the tenant-app init flow
(POST `/api/v1/frontend-apps/{tenant-id}/init` on console-service, or the
"Initialize frontend app" button in the tenant console). If Cadel hasn't
done that, do it first.

After deploy, the GCS bucket serves at `inapinchav.com` (apex) via the LB host
rules created during the PL-013 tenant_managed provisioning that completed
2026-05-07. Cert is already active.

## When the full storefront is ready

1. Build the React app from `../../inapinch-figma/` with `pnpm install && pnpm build`
2. The build output lands in `../../inapinch-figma/dist/`
3. Re-deploy against the same tenant slug:

   ```powershell
   .\deploy-tenant-app.ps1 -Slug cadel-7414 -SourcePath ..\micro-applications\inapinch-figma\dist
   ```

The deploy script overwrites the bucket contents, so the coming-soon → full-app
swap is a single command.
