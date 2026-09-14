# Build the tenant console overlay for the IAP hub (/console/).
# Bakes api.{apex} / auth.{apex}. Stamps IAP chrome CSS.
# Then rebuilds console-app/dist with the platform .env so a later
# platform frontend deploy does not upload this overlay.
#
# Does not terraform. Does not upload (see deploy.ps1).

$ErrorActionPreference = "Stop"
$Storefront = $PSScriptRoot
$ConsoleApp = Join-Path $Storefront "..\..\..\symlfy-baas\console-app"
$Overlay = Join-Path $Storefront "console-dist"
$ThemeCss = Join-Path $Storefront "console-overlay\iap-console.css"

if (-not (Test-Path $ThemeCss)) { throw "missing $ThemeCss" }

$shellLinks = '[{"label":"Hub","href":"/#home"},{"label":"Rentals","href":"/#rentals"},{"label":"Orders","href":"/#orders"},{"label":"Stock","href":"/#stock"},{"label":"Vault","href":"/console/index.html?as=tenant"}]'

Push-Location $ConsoleApp
try {
    $env:VITE_API_GATEWAY_URL = "https://api.inapinchav.com"
    $env:VITE_AUTH_URL = "https://auth.inapinchav.com"
    $env:VITE_CONSOLE_URL = "https://hub.inapinchav.com/console/index.html"
    $env:VITE_BRAND_NAME = "In a Pinch AV"
    $env:VITE_SHELL_LINKS = $shellLinks
    npm run build -- --base=/console/
    if ($LASTEXITCODE -ne 0) { throw "tenant console overlay build failed" }
} finally {
    Pop-Location
}

if (Test-Path $Overlay) { Remove-Item -Recurse -Force $Overlay }
Copy-Item -Recurse (Join-Path $ConsoleApp "dist") $Overlay
Copy-Item $ThemeCss (Join-Path $Overlay "iap-console.css")

$index = Join-Path $Overlay "index.html"
$html = Get-Content $index -Raw
if ($html -notmatch 'iap-console\.css') {
    $link = "  <link rel=`"stylesheet`" href=`"./iap-console.css`" />`n</head>"
    $html = $html.Replace('</head>', $link)
    Set-Content -Path $index -Value $html -NoNewline
}

# Clear overlay env so the restore build uses console-app/.env (platform).
foreach ($key in @(
    'VITE_API_GATEWAY_URL', 'VITE_AUTH_URL', 'VITE_CONSOLE_URL',
    'VITE_BRAND_NAME', 'VITE_SHELL_LINKS'
)) {
    Remove-Item "Env:$key" -ErrorAction SilentlyContinue
}

Push-Location $ConsoleApp
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "platform console-app restore build failed" }
} finally {
    Pop-Location
}

Write-Host "Overlay ready at $Overlay"
Write-Host "Platform console-app/dist restored. Upload with storefront deploy.ps1"
