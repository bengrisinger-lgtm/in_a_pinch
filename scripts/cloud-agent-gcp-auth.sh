#!/usr/bin/env bash
# Activate GCP credentials for IAP deploy scripts. Never echo secret contents.
set -euo pipefail

iap_gcp_project="${TF_VAR_gcp_project_id:-securedbackend-production}"
iap_gcp_region="${TF_VAR_gcp_region:-us-central1}"

export TF_VAR_gcp_project_id="$iap_gcp_project"
export TF_VAR_gcp_region="$iap_gcp_region"
export TF_VAR_base_domain="${TF_VAR_base_domain:-inapinchav.com}"
export TF_VAR_resource_prefix="${TF_VAR_resource_prefix:-syml}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI is not installed (expected in Cloud Agent Dockerfile)." >&2
  return 1 2>/dev/null || exit 1
fi

key_json="${GCP_SA_KEY_JSON:-}"
key_file="${GCP_SA_KEY_FILE:-$HOME/.config/gcloud/iap-agent-sa.json}"

if [[ -n "$key_json" ]]; then
  mkdir -p "$(dirname "$key_file")"
  chmod 700 "$(dirname "$key_file")"
  printf '%s' "$key_json" >"$key_file"
  chmod 600 "$key_file"
fi

if [[ -f "$key_file" ]]; then
  gcloud auth activate-service-account --key-file="$key_file" --quiet
fi

if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "No active gcloud account. Set secret GCP_SA_KEY_JSON (service account JSON) on this environment." >&2
  return 1 2>/dev/null || exit 1
fi

gcloud config set project "$iap_gcp_project" --quiet
gcloud config set compute/region "$iap_gcp_region" --quiet 2>/dev/null || true
