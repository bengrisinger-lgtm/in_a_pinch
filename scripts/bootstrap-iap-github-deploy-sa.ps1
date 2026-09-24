# One-time IAM for GitHub Actions WIF deploy SA (In A Pinch + template for tenant repos).
# Run in PowerShell as a GCP project owner. Does NOT use desktop deploy.ps1 — this unblocks Actions.
param(
  [string]$Project = "securedbackend-production",
  [string]$DeploySa = "iap-cloud-agent-deploy@securedbackend-production.iam.gserviceaccount.com",
  [string]$ResourcePrefix = "backend",
  [string]$IapTenantSlug = "cadel-7414"
)

$ErrorActionPreference = "Stop"
$Member = "serviceAccount:$DeploySa"
$RuntimeSa = "${ResourcePrefix}-backend-sa@${Project}.iam.gserviceaccount.com"

Write-Host "Project: $Project"
Write-Host "Deploy SA: $DeploySa"
Write-Host "Runtime SA (Cloud Run identity): $RuntimeSa"

$ProjectRoles = @(
  "roles/run.admin",
  "roles/cloudbuild.builds.editor",
  "roles/cloudsql.client",
  "roles/artifactregistry.writer",
  "roles/serviceusage.serviceUsageConsumer"
)

function Invoke-GcloudOk {
  param([string[]]$Args, [string]$Label)
  & gcloud @Args
  if ($LASTEXITCODE -ne 0) {
    throw "gcloud failed: $Label (exit $LASTEXITCODE)"
  }
}

Write-Host "`n=== Project IAM (Cloud Run deploy from source) ===" -ForegroundColor Cyan
foreach ($Role in $ProjectRoles) {
  Write-Host "  + $Role"
  Invoke-GcloudOk @(
    "projects", "add-iam-policy-binding", $Project,
    "--member=$Member", "--role=$Role"
  ) "projects add-iam-policy-binding $Role"
}

Write-Host "`n=== Deploy SA may act as runtime Cloud Run SA ===" -ForegroundColor Cyan
Invoke-GcloudOk @(
  "iam", "service-accounts", "add-iam-policy-binding", $RuntimeSa,
  "--project=$Project", "--member=$Member", "--role=roles/iam.serviceAccountUser"
) "serviceAccountUser on $RuntimeSa"

$Secrets = @("quote-service-hmac", "REGISTRATION_KEY", "RUNTIME_DB_PASSWORD")
Write-Host "`n=== Secret Manager (existing secrets only) ===" -ForegroundColor Cyan
foreach ($Sec in $Secrets) {
  Write-Host "  accessor: $Sec"
  gcloud secrets add-iam-policy-binding $Sec `
    --project=$Project `
    --member=$Member `
    --role="roles/secretmanager.secretAccessor" `
    --quiet | Out-Null
}
Write-Host "  versionManager: quote-service-hmac"
gcloud secrets add-iam-policy-binding quote-service-hmac `
  --project=$Project `
  --member=$Member `
  --role="roles/secretmanager.secretVersionManager" `
  --quiet | Out-Null

$HubBucket = "${Project}-ta-${IapTenantSlug}-hub-app"
$ApexBucket = "${Project}-ta-${IapTenantSlug}-coming-soon-app"
Write-Host "`n=== Storefront GCS buckets ===" -ForegroundColor Cyan
foreach ($Bucket in @($HubBucket, $ApexBucket)) {
  Write-Host "  objectAdmin: gs://$Bucket"
  gcloud storage buckets add-iam-policy-binding "gs://$Bucket" `
    --member=$Member `
    --role="roles/storage.objectAdmin" `
    --quiet 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "    (skip or create bucket if missing: $Bucket)" -ForegroundColor Yellow
  }
}

Write-Host "`n=== Verify deploy SA project roles ===" -ForegroundColor Cyan
$Need = @("roles/run.admin", "roles/cloudbuild.builds.editor")
$PolicyJson = gcloud projects get-iam-policy $Project --format=json | ConvertFrom-Json
$Granted = @()
foreach ($b in $PolicyJson.bindings) {
  if ($b.members -contains $Member) { $Granted += $b.role }
}
foreach ($Role in $Need) {
  if ($Granted -contains $Role) {
    Write-Host "  OK  $Role" -ForegroundColor Green
  } else {
    Write-Host "  MISSING $Role — binding did not apply; check org policy or your project IAM admin role." -ForegroundColor Red
    exit 1
  }
}

Write-Host "`nDone. Re-run GitHub Actions: Deploy IAP quote-service (main)." -ForegroundColor Green
Write-Host "WIF pool binding (workloadIdentityUser) is separate — see docs/GITHUB-WIF-DEPLOY.md section 2." -ForegroundColor Yellow
