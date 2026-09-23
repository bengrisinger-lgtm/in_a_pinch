#!/usr/bin/env bash
# Upload storefront dist/ to IAP hub or apex GCS buckets (same behavior as deploy.ps1).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/cloud-agent-gcp-auth.sh
source "$ROOT/scripts/cloud-agent-gcp-auth.sh"

TENANT_SLUG="${IAP_TENANT_SLUG:-cadel-7414}"
APP_SLUG="${IAP_APP_SLUG:-hub}"
DO_BUILD="${IAP_DEPLOY_BUILD:-0}"
DO_CONSOLE_OVERLAY="${IAP_CONSOLE_OVERLAY:-0}"

LANDING_SLUGS="apex landing coming-soon www"
is_landing=0
if [[ " $LANDING_SLUGS " == *" $APP_SLUG "* ]]; then
  is_landing=1
fi
if [[ "$APP_SLUG" != "hub" && "$is_landing" -ne 1 ]]; then
  echo "IAP_APP_SLUG must be hub or a landing slug (apex, landing, coming-soon, www). Got: $APP_SLUG" >&2
  exit 1
fi

PROJECT="${TF_VAR_gcp_project_id:-securedbackend-production}"
BUCKET="${PROJECT}-ta-${TENANT_SLUG}-${APP_SLUG}-app"
BUCKET_URI="gs://${BUCKET}"
STOREFRONT="$ROOT/storefront"
DIST="$STOREFRONT/dist"

if [[ "$DO_CONSOLE_OVERLAY" == "1" && "$is_landing" -eq 0 ]]; then
  bash "$ROOT/scripts/iap-build-console-overlay.sh"
fi

if [[ "$DO_BUILD" == "1" ]]; then
  echo "=== storefront npm test + build ==="
  (cd "$STOREFRONT" && npm test && npm run build)
fi

if [[ ! -f "$DIST/index.html" ]]; then
  echo "dist/index.html missing. Set IAP_DEPLOY_BUILD=1 or run npm run build in storefront/." >&2
  exit 1
fi

echo "Checking $BUCKET_URI …"
if ! gcloud storage ls "$BUCKET_URI" >/dev/null 2>&1; then
  echo "Bucket $BUCKET does not exist. Provision the application slug in Vault Applications first." >&2
  exit 1
fi

echo "Uploading $DIST → $BUCKET_URI"
gcloud storage rsync --recursive --delete-unmatched-destination-objects \
  "$DIST" "$BUCKET_URI" --exclude='^catalog-media/.*'

OVERLAY="$STOREFRONT/console-dist"
if [[ "$is_landing" -eq 1 ]]; then
  echo "Console overlay skipped on landing slug."
elif [[ -f "$OVERLAY/index.html" ]]; then
  echo "Re-applying /console/ overlay"
  gcloud storage rsync --recursive --delete-unmatched-destination-objects \
    "$OVERLAY" "$BUCKET_URI/console"
fi

if [[ "$is_landing" -eq 1 ]]; then
  echo "Done. Consumer shop: https://inapinchav.com/"
else
  echo "Done. Staff hub: https://hub.inapinchav.com/"
  echo "Apex upload: IAP_APP_SLUG=coming-soon bash scripts/iap-deploy-storefront.sh"
fi
