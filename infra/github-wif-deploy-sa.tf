# GitHub WIF deploy service account IAM (securedbackend-production).
# Apply once: terraform apply (project owner). Canonical list: docs/IAP-GITHUB-DEPLOY-SA-IAM.md

variable "project_id" {
  type    = string
  default = "securedbackend-production"
}

variable "deploy_sa_email" {
  type    = string
  default = "iap-cloud-agent-deploy@securedbackend-production.iam.gserviceaccount.com"
}

variable "runtime_sa_email" {
  type    = string
  default = "backend-backend-sa@securedbackend-production.iam.gserviceaccount.com"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "iap_tenant_slug" {
  type    = string
  default = "cadel-7414"
}

locals {
  deploy_member = "serviceAccount:${var.deploy_sa_email}"
  project_roles = [
    "roles/run.sourceDeveloper",
    "roles/run.admin",
    "roles/serviceusage.serviceUsageConsumer",
    "roles/cloudbuild.builds.editor",
    "roles/cloudsql.client",
    "roles/artifactregistry.writer",
    "roles/storage.bucketViewer",
  ]
  deploy_secrets = toset(["quote-service-hmac", "REGISTRATION_KEY", "RUNTIME_DB_PASSWORD"])
}

resource "google_project_iam_member" "deploy_sa" {
  for_each = toset(local.project_roles)
  project  = var.project_id
  role     = each.value
  member   = local.deploy_member
}

resource "google_service_account_iam_member" "deploy_as_runtime" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.runtime_sa_email}"
  role               = "roles/iam.serviceAccountUser"
  member             = local.deploy_member
}

resource "google_secret_manager_secret_iam_member" "deploy_secret_accessor" {
  for_each  = local.deploy_secrets
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = local.deploy_member
}

resource "google_secret_manager_secret_iam_member" "quote_hmac_version_manager" {
  project   = var.project_id
  secret_id = "quote-service-hmac"
  role      = "roles/secretmanager.secretVersionManager"
  member    = local.deploy_member
}

resource "google_storage_bucket_iam_member" "run_sources" {
  bucket = "run-sources-${var.project_id}-${var.region}"
  role   = "roles/storage.admin"
  member = local.deploy_member
}

resource "google_storage_bucket_iam_member" "iap_hub" {
  bucket = "${var.project_id}-ta-${var.iap_tenant_slug}-hub-app"
  role   = "roles/storage.objectAdmin"
  member = local.deploy_member
}

resource "google_storage_bucket_iam_member" "iap_apex" {
  bucket = "${var.project_id}-ta-${var.iap_tenant_slug}-coming-soon-app"
  role   = "roles/storage.objectAdmin"
  member = local.deploy_member
}
