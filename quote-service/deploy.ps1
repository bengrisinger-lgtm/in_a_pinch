# deploy.ps1 — Cloud Run + register quote-service (tenant spoke, not core)
#
# Does not terraform. Does not deploy api-gateway. Does not mount COOKIE_SECRET.
#
# Prerequisites: gcloud logged in. First run will load set-env.ps1 production
# if TF_VAR_gcp_project_id is not already in the shell.
#
# Usage:
#   cd micro-applications\in-a-pinch\quote-service
#   .\deploy.ps1 -TenantId "<uuid from operator console>"
#
# Optional:
#   -AllowedOrigins "https://staff.example.com,https://api.example.com"
#   -SkipTests
#   -SkipRegister   (image only; no POST /auth/services)

param(
    [Parameter(Mandatory = $true)]
    [string]$TenantId,

    [string]$AllowedOrigins = $env:QUOTE_ALLOWED_ORIGINS,
    [string]$ServiceName = "quote-service",
    [string]$RegistryName = "quotes",
    [string]$PathPrefix = "/api/v1/quotes",
    [switch]$SkipTests,
    [switch]$SkipRegister
)

$ErrorActionPreference = "Stop"
$ScriptRoot = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $ScriptRoot "..\..\..")).Path

if ($TenantId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
    throw "TenantId must be a UUID from the operator console (not a slug, not from the browser)."
}

if (-not $env:TF_VAR_gcp_project_id) {
    $setEnv = Join-Path $RepoRoot "symlfy-baas\syml-platform\infra\set-env.ps1"
    if (-not (Test-Path $setEnv)) {
        throw "TF_VAR_gcp_project_id is not set and $setEnv was not found. Run: . <baas>\syml-platform\infra\set-env.ps1 production"
    }
    Write-Host "Loading $setEnv production" -ForegroundColor Cyan
    . $setEnv production
}

$PROJECT = $env:TF_VAR_gcp_project_id
if (-not $PROJECT) { throw "TF_VAR_gcp_project_id not set after set-env." }

$REGION = $env:TF_VAR_gcp_region
if (-not $REGION) { $REGION = "us-central1" }

$baseDomain = $env:TF_VAR_base_domain
if (-not $baseDomain) { throw "TF_VAR_base_domain not set. Run set-env.ps1 production." }

$PREFIX = $env:TF_VAR_resource_prefix
if (-not $PREFIX) { $PREFIX = "syml" }

$SQL_INSTANCE        = "${PREFIX}-main-instance"
$SQL_DATABASE        = "${PREFIX}-db"
$SQL_USER            = "${PREFIX}_app_runtime"
$SERVICE_ACCOUNT     = "${PREFIX}-backend-sa@${PROJECT}.iam.gserviceaccount.com"
$SQL_CONNECTION_NAME = "${PROJECT}:${REGION}:${SQL_INSTANCE}"
$HMAC_SECRET_NAME    = "quote-service-hmac"

if (-not $AllowedOrigins) {
    $AllowedOrigins = "https://api.$baseDomain"
}

function Assert-GcloudOk {
    param([string]$What)
    if ($LASTEXITCODE -ne 0) {
        throw "$What failed (exit $LASTEXITCODE)."
    }
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

gcloud config set project $PROJECT | Out-Null
Assert-GcloudOk "gcloud config set project"

# -----------------------------------------
# Tests (local tree, kit via file: path)
# -----------------------------------------
if (-not $SkipTests) {
    Write-Host "`n=== npm test ===" -ForegroundColor Yellow
    Push-Location $ScriptRoot
    try {
        if (-not (Test-Path "node_modules")) { npm install }
        npm test
        if ($LASTEXITCODE -ne 0) { throw "quote-service tests failed. Not deploying." }
    } finally {
        Pop-Location
    }
}

# -----------------------------------------
# Stage Cloud Build context (kit cannot use file:../../../…)
# -----------------------------------------
Write-Host "`n=== Staging image context (kit + quote-service) ===" -ForegroundColor Yellow

$sdkRoot = Join-Path $RepoRoot "symlfy-baas\syml-platform\client-sdk"
if (-not (Test-Path (Join-Path $sdkRoot "package.json"))) {
    throw "Kit not found at $sdkRoot"
}

$sdkDist = Join-Path $sdkRoot "dist\server.js"
if (-not (Test-Path $sdkDist)) {
    Write-Host "Building @securedbackend/sdk (dist missing)" -ForegroundColor Cyan
    Push-Location $sdkRoot
    try {
        if (-not (Test-Path "node_modules")) { npm install }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Kit build failed." }
    } finally {
        Pop-Location
    }
}

$staging = Join-Path $env:TEMP "quote-service-cloud-build"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Path $staging | Out-Null
New-Item -ItemType Directory -Path (Join-Path $staging "vendor\sdk") | Out-Null

Get-ChildItem $ScriptRoot -Force | Where-Object {
    $_.Name -notin @("node_modules", ".git", "env.yaml", "deploy.ps1")
} | ForEach-Object {
    Copy-Item $_.FullName -Destination (Join-Path $staging $_.Name) -Recurse -Force
}

Copy-Item (Join-Path $sdkRoot "package.json") (Join-Path $staging "vendor\sdk\package.json")
if (Test-Path (Join-Path $sdkRoot "README.md")) {
    Copy-Item (Join-Path $sdkRoot "README.md") (Join-Path $staging "vendor\sdk\README.md")
}
Copy-Item (Join-Path $sdkRoot "dist") (Join-Path $staging "vendor\sdk\dist") -Recurse -Force

$pkgPath = Join-Path $staging "package.json"
$pkgRaw = Get-Content $pkgPath -Raw
$patched = $pkgRaw -replace '"file:\.\./\.\./\.\./symlfy-baas/syml-platform/client-sdk"', '"file:./vendor/sdk"'
if ($patched -eq $pkgRaw) {
    throw "Failed to rewrite @securedbackend/sdk to file:./vendor/sdk in staged package.json"
}
Write-Utf8NoBom $pkgPath $patched

Write-Utf8NoBom (Join-Path $staging "Dockerfile") @"
FROM node:20-slim
WORKDIR /app
RUN groupadd -r appgroup && useradd -r -g appgroup appuser
COPY package.json ./
COPY vendor/sdk ./vendor/sdk
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
USER appuser
EXPOSE 8080
CMD ["node", "index.js"]
"@

Write-Utf8NoBom (Join-Path $staging ".gcloudignore") @"
.git
.gitignore
node_modules
test
*.md
.deploy-staging
env.yaml
"@

# -----------------------------------------
# HMAC secret: bootstrap random, replaced on first register
# -----------------------------------------
Write-Host "`n=== HMAC secret $HMAC_SECRET_NAME ===" -ForegroundColor Yellow

gcloud secrets describe $HMAC_SECRET_NAME --project $PROJECT 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $bootstrap = [Convert]::ToBase64String($bytes)
    $tmpSecret = Join-Path $env:TEMP "quote-hmac-bootstrap.txt"
    Write-Utf8NoBom $tmpSecret $bootstrap
    gcloud secrets create $HMAC_SECRET_NAME --project $PROJECT --data-file $tmpSecret --replication-policy automatic
    Assert-GcloudOk "gcloud secrets create $HMAC_SECRET_NAME"
    Remove-Item -Force $tmpSecret
    Write-Host "  Created bootstrap HMAC (will be replaced if register mints a new secret)." -ForegroundColor Cyan
}

gcloud secrets add-iam-policy-binding $HMAC_SECRET_NAME `
    --project $PROJECT `
    --member "serviceAccount:$SERVICE_ACCOUNT" `
    --role "roles/secretmanager.secretAccessor" `
    --quiet 2>$null

# -----------------------------------------
# env.yaml (no secrets)
# -----------------------------------------
$CONSOLE_SERVICE_URL = ""
$INTEGRATIONS_SERVICE_URL = ""
try {
    $CONSOLE_SERVICE_URL = (gcloud run services describe console-service --project $PROJECT --region $REGION --format "value(status.url)" 2>$null).Trim()
} catch {
    $CONSOLE_SERVICE_URL = ""
}
try {
    $INTEGRATIONS_SERVICE_URL = (gcloud run services describe integrations-service --project $PROJECT --region $REGION --format "value(status.url)" 2>$null).Trim()
} catch {
    $INTEGRATIONS_SERVICE_URL = ""
}

$envYamlPath = Join-Path $staging "env.yaml"
$consoleUrlLine = if ($CONSOLE_SERVICE_URL) { "CONSOLE_SERVICE_URL: `"$CONSOLE_SERVICE_URL`"" } else { "" }
$integrationsUrlLine = if ($INTEGRATIONS_SERVICE_URL) { "INTEGRATIONS_SERVICE_URL: `"$INTEGRATIONS_SERVICE_URL`"" } else { "" }
$catalogBuckets = if ($env:CATALOG_MEDIA_BUCKETS) { $env:CATALOG_MEDIA_BUCKETS.Trim() } else { '' }
$catalogBucketsLine = if ($catalogBuckets) { "CATALOG_MEDIA_BUCKETS: `"$catalogBuckets`"" } else { "" }
Write-Utf8NoBom $envYamlPath @"
DB_USER: "$SQL_USER"
DB_NAME: "$SQL_DATABASE"
DB_HOST: "$SQL_CONNECTION_NAME"
ALLOWED_ORIGINS: "$AllowedOrigins"
TENANT_ID: "$TenantId"
CALENDAR_TIMEZONE: "America/Denver"
$consoleUrlLine
$integrationsUrlLine
$catalogBucketsLine
"@

if ($CONSOLE_SERVICE_URL) {
    Write-Host "  CONSOLE_SERVICE_URL: $CONSOLE_SERVICE_URL (vault reveal for Square)" -ForegroundColor DarkGray
    gcloud run services add-iam-policy-binding console-service `
        --project $PROJECT `
        --region $REGION `
        --member "serviceAccount:$SERVICE_ACCOUNT" `
        --role "roles/run.invoker" `
        --quiet 2>$null
} else {
    Write-Host "  CONSOLE_SERVICE_URL unset — Payment Link needs console-service reveal or SQUARE_ACCESS_TOKEN" -ForegroundColor Yellow
}

if ($INTEGRATIONS_SERVICE_URL) {
    Write-Host "  INTEGRATIONS_SERVICE_URL: $INTEGRATIONS_SERVICE_URL (paid booking calendar copy)" -ForegroundColor DarkGray
    gcloud run services add-iam-policy-binding integrations-service `
        --project $PROJECT `
        --region $REGION `
        --member "serviceAccount:$SERVICE_ACCOUNT" `
        --role "roles/run.invoker" `
        --quiet 2>$null
} else {
    Write-Host "  INTEGRATIONS_SERVICE_URL unset — paid bookings stay paid; calendar copy skipped" -ForegroundColor Yellow
}

# -----------------------------------------
# Cloud Run
# -----------------------------------------
Write-Host "`n=== Deploying $ServiceName ===" -ForegroundColor Yellow
Write-Host "  DB user: $SQL_USER (runtime, not frontend)" -ForegroundColor DarkGray
Write-Host "  COOKIE_SECRET: not mounted" -ForegroundColor DarkGray

Push-Location $staging
try {
    gcloud run deploy $ServiceName `
        --source . `
        --project $PROJECT `
        --region $REGION `
        --platform managed `
        --no-allow-unauthenticated `
        --ingress internal-and-cloud-load-balancing `
        --service-account $SERVICE_ACCOUNT `
        --network default `
        --subnet default `
        --vpc-egress private-ranges-only `
        --add-cloudsql-instances $SQL_CONNECTION_NAME `
        --env-vars-file env.yaml `
        --set-secrets "HMAC_SECRET=${HMAC_SECRET_NAME}:latest,DB_PASSWORD=RUNTIME_DB_PASSWORD:latest" `
        --memory 512Mi `
        --cpu 1 `
        --min-instances 0 `
        --max-instances 10 `
        --timeout 60
    Assert-GcloudOk "gcloud run deploy $ServiceName"
} finally {
    Pop-Location
}

gcloud run services add-iam-policy-binding $ServiceName `
    --project $PROJECT `
    --region $REGION `
    --member "allUsers" `
    --role "roles/run.invoker" `
    --quiet 2>$null

$QUOTE_URL = (gcloud run services describe $ServiceName --project $PROJECT --region $REGION --format "value(status.url)").Trim()
Write-Host "  Cloud Run: $QUOTE_URL" -ForegroundColor Green

# -----------------------------------------
# Register (HMAC minted once)
# -----------------------------------------
if ($SkipRegister) {
    Write-Host "`nSkipped register (-SkipRegister). Set HMAC_SECRET from a prior mint before serving staff routes." -ForegroundColor Yellow
} else {
    Write-Host "`n=== POST /auth/services ===" -ForegroundColor Yellow

    $AUTH_URL = "https://auth.$baseDomain"
    $REGISTRATION_KEY = (gcloud secrets versions access latest --secret=REGISTRATION_KEY --project $PROJECT).Trim()
    if (-not $REGISTRATION_KEY) { throw "REGISTRATION_KEY secret is empty." }

    $regBody = @{
        service_name = $RegistryName
        url          = $QUOTE_URL
        path_prefix  = $PathPrefix
        tenant_id    = $TenantId
    } | ConvertTo-Json -Compress

    $regFile = Join-Path $env:TEMP "quote-register-body.json"
    Write-Utf8NoBom $regFile $regBody

    $raw = & curl.exe -sS -X POST "$AUTH_URL/auth/services" `
        -H "Content-Type: application/json" `
        -H "X-Internal-Key: $REGISTRATION_KEY" `
        --data-binary "@$regFile"
    Remove-Item -Force $regFile

    if (-not $raw) { throw "Empty response from $AUTH_URL/auth/services" }

    try {
        $parsed = $raw | ConvertFrom-Json
    } catch {
        throw "Register did not return JSON. Body: $raw"
    }

    if ($parsed.error) {
        $codeBit = if ($parsed.code) { " ($($parsed.code))" } else { "" }
        throw "Register failed: $($parsed.error)$codeBit. Response: $raw"
    }

    if ($parsed.app_schema) {
        Write-Host "  app_schema: $($parsed.app_schema)" -ForegroundColor Green
    }

    if ($parsed.hmac_secret) {
        $hmacTmp = Join-Path $env:TEMP "quote-hmac-minted.txt"
        Write-Utf8NoBom $hmacTmp ([string]$parsed.hmac_secret)
        gcloud secrets versions add $HMAC_SECRET_NAME --project $PROJECT --data-file $hmacTmp
        Assert-GcloudOk "gcloud secrets versions add $HMAC_SECRET_NAME"
        Remove-Item -Force $hmacTmp

        gcloud run services update $ServiceName `
            --project $PROJECT `
            --region $REGION `
            --update-secrets "HMAC_SECRET=${HMAC_SECRET_NAME}:latest"
        Assert-GcloudOk "gcloud run services update HMAC_SECRET"

        Write-Host "  hmac_secret minted once, stored in Secret Manager $HMAC_SECRET_NAME (not printed)." -ForegroundColor Green
        Write-Host "  Copy it into 1Password from Secret Manager now. GET /auth/services will not show it." -ForegroundColor Yellow
    } else {
        Write-Host "  No hmac_secret in response (already issued). Left existing $HMAC_SECRET_NAME in place." -ForegroundColor Cyan
    }
}

Write-Host "`n=== quote-service deploy complete ===" -ForegroundColor Green
Write-Host "Cloud Run:     $QUOTE_URL"
Write-Host "Gateway route: https://api.$baseDomain$PathPrefix  (after gateway poll ~60s)"
Write-Host ""
Write-Host "HMAC on staff calls through api.* will 401 until api-gateway is cut over" -ForegroundColor Yellow
Write-Host "to the minted secret (after LC scan/loa verify). Do not deploy api-gateway from this script." -ForegroundColor Yellow
Write-Host "Do not terraform apply." -ForegroundColor Yellow
Write-Host ""
Write-Host "Health is on the Cloud Run URL (internal ingress — use the LB or authenticated invoke, not a public curl from home)."
