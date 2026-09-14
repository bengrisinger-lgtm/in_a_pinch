# deploy.ps1 — upload the IAP storefront
#
# Hub (staff): default AppSlug hub. Includes /console/ overlay.
# Apex (consumer shop): AppSlug coming-soon (or apex / landing / www).
#   Same dist/. No /console/ overlay. Do not upload hub onto the landing
#   bucket. Do not terraform. Do not deploy api-gateway.
#
# Usage:
#   cd micro-applications\in-a-pinch\storefront
#   .\build-console-overlay.ps1   # hub /console/ overlay
#   .\deploy.ps1 -Build            # hub staff SPA
#   .\deploy.ps1 -AppSlug coming-soon   # apex shop (same dist, no rebuild)

param(
    [string]$TenantSlug = "cadel-7414",
    [string]$AppSlug = "hub",
    [switch]$Build
)

$ErrorActionPreference = "Stop"
$ScriptRoot = $PSScriptRoot

$LandingSlugs = @("apex", "landing", "coming-soon", "www")
$IsLanding = $LandingSlugs -contains $AppSlug

if ($AppSlug -ne "hub" -and -not $IsLanding) {
    throw "AppSlug must be hub or a landing slug (apex, landing, coming-soon, www). Got '$AppSlug'."
}

if (-not $env:TF_VAR_gcp_project_id) {
    $setEnv = Join-Path $ScriptRoot "..\..\..\symlfy-baas\syml-platform\infra\set-env.ps1"
    if (Test-Path $setEnv) {
        Write-Host "Loading $setEnv production" -ForegroundColor Cyan
        . $setEnv production
    }
}

$PROJECT = $env:TF_VAR_gcp_project_id
if (-not $PROJECT) { $PROJECT = "securedbackend-production" }

$BucketName = "${PROJECT}-ta-${TenantSlug}-${AppSlug}-app"
$BucketUri = "gs://${BucketName}"
$DistDir = Join-Path $ScriptRoot "dist"

if ($Build) {
    Push-Location $ScriptRoot
    try {
        npm test
        if ($LASTEXITCODE -ne 0) { throw "storefront tests failed" }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "storefront build failed" }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path (Join-Path $DistDir "index.html"))) {
    throw "dist/index.html not found. Run: npm run build  (or .\deploy.ps1 -Build)"
}

Write-Host "Checking $BucketUri ..." -ForegroundColor Cyan
gcloud storage ls $BucketUri 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    if ($IsLanding) {
        Write-Host @"

Bucket $BucketName does not exist yet.

Create it through the IAP tenant Applications page (not operator, not terraform):
  1. Sign in at https://app.symlavault.com as a member of the IAP tenant
  2. Applications, then New application
  3. Name: Coming Soon
     The wizard mints the slug from the name. It must be coming-soon (or
     apex / landing / www) so apex+www already route here. Do not name it hub.

Then re-run: .\deploy.ps1 -AppSlug coming-soon

"@ -ForegroundColor Yellow
    } else {
        Write-Host @"

Bucket $BucketName does not exist yet.

Create it through the IAP tenant Applications page (not operator, not terraform):
  1. Sign in at https://app.symlavault.com as a member of the IAP tenant
  2. Applications, then New application
  3. Name: hub
     The wizard mints the slug from the name. It must be hub so the host
     is hub.<domain> (already on the cert and URL map). Do not name it
     Storefront — that slug would miss the URL map and look like marketing.
  4. Close the upload step without dropping files. Do not replace the coming-soon landing app.

Then re-run this script. After upload, click Deploy on that application so
app-resolver sees status=active (up to 60s cache).

"@ -ForegroundColor Yellow
    }
    throw "Application slug '$AppSlug' is not provisioned yet."
}

Write-Host "Uploading $DistDir → $BucketUri" -ForegroundColor Cyan
gcloud storage rsync --recursive --delete-unmatched-destination-objects $DistDir $BucketUri
if ($LASTEXITCODE -ne 0) { throw "gcloud storage rsync failed" }

$ConsoleOverlay = Join-Path $ScriptRoot "console-dist"
if ($IsLanding) {
    Write-Host "Console overlay skipped on landing slug (staff Vault stays on hub)." -ForegroundColor Cyan
} elseif (Test-Path (Join-Path $ConsoleOverlay "index.html")) {
    Write-Host "Re-applying /console/ overlay (hub rsync --delete would drop it)" -ForegroundColor Cyan
    gcloud storage rsync --recursive --delete-unmatched-destination-objects $ConsoleOverlay "$BucketUri/console"
    if ($LASTEXITCODE -ne 0) { throw "gcloud storage rsync console overlay failed" }
}

Write-Host ""
Write-Host "Uploaded. Public URL after Applications → Deploy:" -ForegroundColor Green
if ($IsLanding) {
    Write-Host "  https://inapinchav.com/"
    Write-Host "Consumer shop. Hub stays https://hub.inapinchav.com/"
} else {
    Write-Host "  https://hub.inapinchav.com/"
    Write-Host "Staff hub. Apex shop is a second upload: .\deploy.ps1 -AppSlug coming-soon"
}
Write-Host "Do not deploy api-gateway. Do not terraform."
