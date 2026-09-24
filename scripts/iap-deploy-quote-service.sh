#!/usr/bin/env bash
# Cloud Run deploy + register for IAP quote-service (parity with quote-service/deploy.ps1).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/load-platform-production-env.sh
source "$ROOT/scripts/load-platform-production-env.sh"

TENANT_ID="${IAP_TENANT_ID:-987bcdaf-320d-46bf-bfb3-4bdcdffe1de1}"
TENANT_SLUG="${IAP_TENANT_SLUG:-cadel-7414}"
SERVICE_NAME="${QUOTE_SERVICE_NAME:-quote-service}"
REGISTRY_NAME="${QUOTE_REGISTRY_NAME:-quotes}"
PATH_PREFIX="${QUOTE_PATH_PREFIX:-/api/v1/quotes}"
SKIP_TESTS="${QUOTE_SKIP_TESTS:-0}"
SKIP_REGISTER="${QUOTE_SKIP_REGISTER:-0}"

# Tenant API host branding (IAP apex), not platform symlavault.com.
IAP_API_DOMAIN="${IAP_API_DOMAIN:-inapinchav.com}"
IAP_AUTH_URL="${IAP_AUTH_URL:-https://auth.${IAP_API_DOMAIN}}"

if [[ ! "$TENANT_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  echo "IAP_TENANT_ID must be a UUID" >&2
  exit 1
fi

BAAS="${SYMLFY_BAAS_ROOT:-}"
for candidate in "$ROOT/../symlfy-baas" "$ROOT/symlfy-baas" "${GITHUB_WORKSPACE:-}/symlfy-baas" /symlfy-baas; do
  if [[ -f "$candidate/syml-platform/client-sdk/package.json" ]]; then
    BAAS="$candidate"
    break
  fi
done
export SYMLFY_BAAS_ROOT="$BAAS"
load_platform_production_env "$BAAS"

if [[ -f "$ROOT/scripts/cloud-agent-gcp-auth.sh" ]] && [[ -z "${CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE:-}" ]]; then
  # Cloud Agent: optional SA JSON. GitHub Actions uses WIF before this script runs.
  # shellcheck source=scripts/cloud-agent-gcp-auth.sh
  source "$ROOT/scripts/cloud-agent-gcp-auth.sh" || true
fi

gcloud config set project "$TF_VAR_gcp_project_id" --quiet

PROJECT="$TF_VAR_gcp_project_id"
REGION="${TF_VAR_gcp_region:-us-central1}"
PREFIX="${TF_VAR_resource_prefix:-syml}"
SQL_INSTANCE="${PREFIX}-main-instance"
SQL_DATABASE="${PREFIX}-db"
SQL_USER="${PREFIX}_app_runtime"
SERVICE_ACCOUNT="${PREFIX}-backend-sa@${PROJECT}.iam.gserviceaccount.com"
SQL_CONNECTION_NAME="${PROJECT}:${REGION}:${SQL_INSTANCE}"
HMAC_SECRET_NAME="quote-service-hmac"
QUOTE_SERVICE_DIR="$ROOT/quote-service"

ALLOWED_ORIGINS="${QUOTE_ALLOWED_ORIGINS:-https://api.${IAP_API_DOMAIN}}"

bash "$ROOT/scripts/link-symlfy-sdk-for-npm.sh"

if [[ "$SKIP_TESTS" != "1" ]]; then
  echo "=== quote-service npm test ==="
  (cd "$QUOTE_SERVICE_DIR" && rm -f package-lock.json && npm install && npm test)
fi

SDK_ROOT="$BAAS/syml-platform/client-sdk"
if [[ ! -f "$SDK_ROOT/dist/server.js" ]]; then
  echo "=== building client-sdk (dist/server.js missing) ==="
  (cd "$SDK_ROOT" && npm install && npm run build)
fi

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

mkdir -p "$STAGING/vendor/sdk"
rsync -a --exclude node_modules --exclude .git --exclude env.yaml --exclude deploy.ps1 \
  "$QUOTE_SERVICE_DIR/" "$STAGING/"
cp "$SDK_ROOT/package.json" "$STAGING/vendor/sdk/"
[[ -f "$SDK_ROOT/README.md" ]] && cp "$SDK_ROOT/README.md" "$STAGING/vendor/sdk/" || true
cp -a "$SDK_ROOT/dist" "$STAGING/vendor/sdk/"

node <<NODE
const fs = require('fs');
const pkgPath = '$STAGING/package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const dep = pkg.dependencies && pkg.dependencies['@securedbackend/sdk'];
if (!dep || !String(dep).startsWith('file:')) {
  console.error('Expected file: dependency on @securedbackend/sdk');
  process.exit(1);
}
pkg.dependencies['@securedbackend/sdk'] = 'file:./vendor/sdk';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
NODE

cat >"$STAGING/Dockerfile" <<'DOCKER'
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
DOCKER

cat >"$STAGING/.gcloudignore" <<'IGNORE'
.git
.gitignore
node_modules
test
*.md
.deploy-staging
env.yaml
IGNORE

# Existence: use versions access (matches deploy-time need). describe/create need extra IAM
# that WIF deploy SAs should not require when quote-service-hmac already exists from PC deploy.
hmac_access_err=""
if ! gcloud secrets versions access latest --secret="$HMAC_SECRET_NAME" --project="$PROJECT" >/dev/null 2>&1; then
  hmac_access_err="$(gcloud secrets versions access latest --secret="$HMAC_SECRET_NAME" --project="$PROJECT" 2>&1)" || true
  if echo "$hmac_access_err" | grep -qi PERMISSION_DENIED; then
    echo "ERROR: deploy SA cannot read Secret Manager secret '$HMAC_SECRET_NAME'." >&2
    echo "Grant roles/secretmanager.secretAccessor on that secret to the GitHub WIF deploy SA" >&2
    echo "(iap-cloud-agent-deploy@securedbackend-production.iam.gserviceaccount.com)." >&2
    exit 1
  fi
  if [[ "${QUOTE_ALLOW_HMAC_CREATE:-0}" == "1" ]]; then
    echo "=== bootstrap HMAC secret $HMAC_SECRET_NAME (QUOTE_ALLOW_HMAC_CREATE=1) ==="
    bootstrap="$(openssl rand -base64 32)"
    printf '%s' "$bootstrap" | gcloud secrets create "$HMAC_SECRET_NAME" \
      --project="$PROJECT" --data-file=- --replication-policy=automatic
  else
    echo "ERROR: Secret '$HMAC_SECRET_NAME' is missing or has no versions." >&2
    echo "One-time from an admin account (PC deploy.ps1), or set QUOTE_ALLOW_HMAC_CREATE=1 only" >&2
    echo "when the deploy principal has secretmanager.secrets.create." >&2
    exit 1
  fi
else
  echo "OK  HMAC secret $HMAC_SECRET_NAME (latest version readable)"
fi

if [[ "${QUOTE_SKIP_SECRET_IAM:-1}" != "1" ]]; then
  gcloud secrets add-iam-policy-binding "$HMAC_SECRET_NAME" \
    --project="$PROJECT" \
    --member "serviceAccount:$SERVICE_ACCOUNT" \
    --role "roles/secretmanager.secretAccessor" \
    --quiet 2>/dev/null || true
fi

# Runtime SA must read ADMIN_DB_PASSWORD for startup owner migrate (terraform usually grants this).
if [[ "${QUOTE_ENSURE_ADMIN_SECRET_IAM:-1}" == "1" ]]; then
  gcloud secrets add-iam-policy-binding ADMIN_DB_PASSWORD \
    --project="$PROJECT" \
    --member "serviceAccount:$SERVICE_ACCOUNT" \
    --role "roles/secretmanager.secretAccessor" \
    --quiet 2>/dev/null || true
fi

CONSOLE_SERVICE_URL=""
INTEGRATIONS_SERVICE_URL=""
CONSOLE_SERVICE_URL="$(gcloud run services describe console-service --project="$PROJECT" --region="$REGION" --format='value(status.url)' 2>/dev/null || true)"
INTEGRATIONS_SERVICE_URL="$(gcloud run services describe integrations-service --project="$PROJECT" --region="$REGION" --format='value(status.url)' 2>/dev/null || true)"

DEFAULT_BUCKETS="${PROJECT}-ta-${TENANT_SLUG}-hub-app,${PROJECT}-ta-${TENANT_SLUG}-coming-soon-app"
CATALOG_MEDIA_BUCKETS="${CATALOG_MEDIA_BUCKETS:-$DEFAULT_BUCKETS}"

{
  echo "DB_USER: \"$SQL_USER\""
  echo "DB_NAME: \"$SQL_DATABASE\""
  echo "DB_HOST: \"$SQL_CONNECTION_NAME\""
  echo "RESOURCE_PREFIX: \"$PREFIX\""
  echo "ALLOWED_ORIGINS: \"$ALLOWED_ORIGINS\""
  echo "TENANT_ID: \"$TENANT_ID\""
  echo "CALENDAR_TIMEZONE: \"America/Denver\""
  [[ -n "$CONSOLE_SERVICE_URL" ]] && echo "CONSOLE_SERVICE_URL: \"$CONSOLE_SERVICE_URL\""
  [[ -n "$INTEGRATIONS_SERVICE_URL" ]] && echo "INTEGRATIONS_SERVICE_URL: \"$INTEGRATIONS_SERVICE_URL\""
  echo "CATALOG_MEDIA_BUCKETS: \"$CATALOG_MEDIA_BUCKETS\""
} >"$STAGING/env.yaml"

if [[ -n "$CONSOLE_SERVICE_URL" ]]; then
  gcloud run services add-iam-policy-binding console-service \
    --project="$PROJECT" --region="$REGION" \
    --member "serviceAccount:$SERVICE_ACCOUNT" \
    --role "roles/run.invoker" --quiet 2>/dev/null || true
fi
if [[ -n "$INTEGRATIONS_SERVICE_URL" ]]; then
  gcloud run services add-iam-policy-binding integrations-service \
    --project="$PROJECT" --region="$REGION" \
    --member "serviceAccount:$SERVICE_ACCOUNT" \
    --role "roles/run.invoker" --quiet 2>/dev/null || true
fi

# Never use --to-latest when the newest *created* revision failed startup (e.g.
# quote-service-00035-xmk): LATEST points at a not-Ready revision and update-traffic
# fails before deploy runs (Actions run 36034029961). Pin to latestReadyRevisionName.
route_traffic_to_latest_ready() {
  local label="${1:-traffic}"
  local ready created
  ready="$(gcloud run services describe "$SERVICE_NAME" \
    --project="$PROJECT" --region="$REGION" \
    --format='value(status.latestReadyRevisionName)' 2>/dev/null || true)"
  created="$(gcloud run services describe "$SERVICE_NAME" \
    --project="$PROJECT" --region="$REGION" \
    --format='value(status.latestCreatedRevisionName)' 2>/dev/null || true)"
  if [[ -z "$ready" ]]; then
    echo "=== quote-service: no ready revision; skip traffic update ($label) ==="
    return 0
  fi
  echo "=== quote-service: route 100% to ready revision ($label): $ready (latest created: ${created:-n/a}) ==="
  gcloud run services update-traffic "$SERVICE_NAME" \
    --project="$PROJECT" \
    --region="$REGION" \
    --to-revisions="${ready}=100" \
    --quiet
}

route_traffic_to_latest_ready "pre-deploy"

echo "=== gcloud run deploy $SERVICE_NAME ==="
(
  cd "$STAGING"
  gcloud run deploy "$SERVICE_NAME" \
    --source . \
    --project "$PROJECT" \
    --region "$REGION" \
    --platform managed \
    --no-allow-unauthenticated \
    --ingress internal-and-cloud-load-balancing \
    --service-account "$SERVICE_ACCOUNT" \
    --network default \
    --subnet default \
    --vpc-egress private-ranges-only \
    --add-cloudsql-instances "$SQL_CONNECTION_NAME" \
    --env-vars-file env.yaml \
    --set-secrets "HMAC_SECRET=${HMAC_SECRET_NAME}:latest,DB_PASSWORD=RUNTIME_DB_PASSWORD:latest,ADMIN_DB_PASSWORD=ADMIN_DB_PASSWORD:latest" \
    --memory 512Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 10 \
    --timeout 60
)

route_traffic_to_latest_ready "post-deploy"

echo "=== quote-service traffic (must sum to 100% on one ready revision) ==="
gcloud run services describe "$SERVICE_NAME" \
  --project="$PROJECT" \
  --region="$REGION" \
  --format='yaml(status.latestReadyRevisionName,status.traffic)'

echo "=== recent quote-service SKU / migration log lines (Cloud Logging) ==="
LOG_FILTER='resource.type="cloud_run_revision"
resource.labels.service_name="'"$SERVICE_NAME"'"
(textPayload=~"sku list failed"
 OR textPayload=~"quote-store startup"
 OR textPayload=~"startup migration"
 OR textPayload=~"42501"
 OR textPayload=~"42703"
 OR textPayload=~"must be owner"
 OR jsonPayload.message=~"sku list failed")'
gcloud logging read "$LOG_FILTER" \
  --project="$PROJECT" \
  --freshness=120m \
  --limit=20 \
  --format='json(timestamp,resource.labels.revision_name,textPayload,jsonPayload)' \
  || echo "(logging read failed — deploy SA needs roles/logging.viewer)"

gcloud run services add-iam-policy-binding "$SERVICE_NAME" \
  --project="$PROJECT" --region="$REGION" \
  --member "allUsers" --role "roles/run.invoker" --quiet 2>/dev/null || true

QUOTE_URL="$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
echo "Cloud Run: $QUOTE_URL"

if [[ "$SKIP_REGISTER" == "1" ]]; then
  echo "Skipped register (QUOTE_SKIP_REGISTER=1)"
  exit 0
fi

echo "=== POST ${IAP_AUTH_URL}/auth/services ==="
REGISTRATION_KEY="$(gcloud secrets versions access latest --secret=REGISTRATION_KEY --project="$PROJECT" | tr -d '\r\n')"
if [[ -z "$REGISTRATION_KEY" ]]; then
  echo "REGISTRATION_KEY secret empty" >&2
  exit 1
fi

reg_body="$(mktemp)"
trap 'rm -f "$reg_body"' RETURN
printf '{"service_name":"%s","url":"%s","path_prefix":"%s","tenant_id":"%s"}' \
  "$REGISTRY_NAME" "$QUOTE_URL" "$PATH_PREFIX" "$TENANT_ID" >"$reg_body"

raw="$(curl -sS -X POST "${IAP_AUTH_URL%/}/auth/services" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: $REGISTRATION_KEY" \
  --data-binary "@$reg_body")"

if [[ -z "$raw" ]]; then
  echo "Empty register response" >&2
  exit 1
fi

reg_err="$(echo "$raw" | jq -r '.error // empty' 2>/dev/null || true)"
if [[ -n "$reg_err" ]]; then
  echo "Register failed: $reg_err" >&2
  exit 1
fi

hmac_secret="$(echo "$raw" | jq -r '.hmac_secret // empty')"
if [[ -n "$hmac_secret" ]]; then
  hmac_tmp="$(mktemp)"
  printf '%s' "$hmac_secret" >"$hmac_tmp"
  if ! gcloud secrets versions add "$HMAC_SECRET_NAME" --project="$PROJECT" --data-file="$hmac_tmp"; then
    rm -f "$hmac_tmp"
    echo "ERROR: could not add HMAC version — grant roles/secretmanager.secretVersionManager on" >&2
    echo "'$HMAC_SECRET_NAME' to the deploy SA, or run register from PC deploy.ps1 once." >&2
    exit 1
  fi
  rm -f "$hmac_tmp"
  gcloud run services update "$SERVICE_NAME" \
    --project="$PROJECT" --region="$REGION" \
    --update-secrets "HMAC_SECRET=${HMAC_SECRET_NAME}:latest"
  echo "HMAC secret updated in Secret Manager (not printed)."
else
  echo "No new hmac_secret in register response (already issued)."
fi

echo "=== quote-service deploy complete ==="
echo "Gateway: https://api.${IAP_API_DOMAIN}${PATH_PREFIX}"
echo "TenantId: $TENANT_ID ($TENANT_SLUG)"
