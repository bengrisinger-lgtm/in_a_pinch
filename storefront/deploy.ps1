# deploy.ps1 — upload the IAP staff storefront to the hub app bucket
#
# Does not terraform. Does not deploy api-gateway. Does not create the
# Application row (that is the IAP tenant Applications page — it provisions
# the private GCS bucket). Do not add this app to Loan Conduit deploy-to-gcs.ps1.
# Do not upload to the landing bucket (apex / coming-soon).
#
# Host must already be on the URL map → app-resolver. Reserved tenant
# subdomains that are: hub, scan, loa, sign. This script uses hub.
#
# Usage:
#   cd micro-applications\in-a-pinch\storefront
#   .\deploy.ps1
#   .\deploy.ps1 -Build

param(
    [string]$TenantSlug = "cadel-7414",
    [string]$AppSlug = "hub",
    [switch]$Build
)

$ErrorActionPreference = "Stop"
$ScriptRoot = $PSScriptRoot

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
    throw "Application slug '$AppSlug' is not provisioned yet."
}

Write-Host "Uploading $DistDir → $BucketUri" -ForegroundColor Cyan
gcloud storage rsync --recursive --delete-unmatched-destination-objects $DistDir $BucketUri
if ($LASTEXITCODE -ne 0) { throw "gcloud storage rsync failed" }

Write-Host ""
Write-Host "Uploaded. Public URL after Applications → Deploy:" -ForegroundColor Green
Write-Host "  https://hub.inapinchav.com/"
Write-Host "Do not deploy api-gateway. Staff inventory through api.* still 401s until HMAC cutover."
Write-Host "App-resolver CSP for tenant api/auth is coded; deploy app-resolver or the SPA cannot fetch api.inapinchav.com."
