#!/usr/bin/env bash
# Load GCP project/region/prefix from symlfy-baas production.json (no DNS secret gate).
# IAP deploy scripts override tenant-facing domains via IAP_* env vars.
set -euo pipefail

load_platform_production_env() {
  local baas_root="${1:?symlfy-baas root}"
  local env_file="$baas_root/syml-platform/infra/environments/production.json"
  if [[ ! -f "$env_file" ]]; then
    echo "Missing $env_file" >&2
    return 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required to read production.json" >&2
    return 1
  fi
  export TF_VAR_gcp_project_id
  TF_VAR_gcp_project_id="$(jq -r '.gcp_project_id' "$env_file")"
  export TF_VAR_gcp_region
  TF_VAR_gcp_region="$(jq -r '.gcp_region // "us-central1"' "$env_file")"
  export TF_VAR_resource_prefix
  TF_VAR_resource_prefix="$(jq -r '.resource_prefix // "syml"' "$env_file")"
  export TF_VAR_base_domain
  TF_VAR_base_domain="$(jq -r '.base_domain' "$env_file")"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  baas="${SYMLFY_BAAS_ROOT:-${1:-}}"
  if [[ -z "$baas" ]]; then
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    for candidate in "$root/../symlfy-baas" "$root/symlfy-baas" /symlfy-baas; do
      if [[ -f "$candidate/syml-platform/infra/environments/production.json" ]]; then
        baas="$candidate"
        break
      fi
    done
  fi
  load_platform_production_env "$baas"
  echo "TF_VAR_gcp_project_id=$TF_VAR_gcp_project_id"
  echo "TF_VAR_gcp_region=$TF_VAR_gcp_region"
  echo "TF_VAR_resource_prefix=$TF_VAR_resource_prefix"
  echo "TF_VAR_base_domain=$TF_VAR_base_domain"
fi
