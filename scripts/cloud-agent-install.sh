#!/usr/bin/env bash
# Idempotent bootstrap for Cloud Agents: platform SDK path + npm installs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bash "$ROOT/scripts/cloud-agent-bootstrap-gcloud.sh"

ensure_symlfy_mount() {
  if [[ -d /symlfy-baas ]]; then
    return 0
  fi
  if command -v sudo >/dev/null; then
    sudo mkdir -p /symlfy-baas
    sudo chown "$(id -u):$(id -g)" /symlfy-baas
    return 0
  fi
  echo "Missing /symlfy-baas mount (Cloud Agent Dockerfile or bootstrap should create it)." >&2
  exit 1
}

find_symlfy_baas() {
  if [[ -n "${SYMLFY_BAAS_ROOT:-}" && -f "${SYMLFY_BAAS_ROOT}/syml-platform/client-sdk/package.json" ]]; then
    printf '%s' "$SYMLFY_BAAS_ROOT"
    return 0
  fi
  local candidate
  for candidate in \
    "$ROOT/../symlfy-baas" \
    "$ROOT/symlfy-baas" \
    "/symlfy-baas"; do
    if [[ -f "$candidate/syml-platform/client-sdk/package.json" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

link_platform_sdk() {
  local baas_root="$1"
  ensure_symlfy_mount
  ln -sfn "$baas_root" /symlfy-baas

  local sdk_root="$baas_root/syml-platform/client-sdk"
  # Match local deploy.ps1: storefront does not rebuild client-sdk. Only build if dist is absent.
  if [[ ! -f "$sdk_root/dist/index.js" && -f "$sdk_root/package.json" ]]; then
    echo "Building @securedbackend/sdk (dist/index.js missing)…"
    (cd "$sdk_root" && npm install && npm run build)
  fi
}

if ! baas="$(find_symlfy_baas)"; then
  cat >&2 <<'EOF'
symlfy-baas not found. Cloud Agent needs the platform repo for @securedbackend/sdk.

1. Add your private symlfy-baas repo under repositoryDependencies in
   .cursor/environment.json (github.com/<org>/symlfy-baas), Save the environment,
   and ensure the GitHub token can read that repo.
2. Or set environment secret SYMLFY_BAAS_ROOT to the checkout path.

Then start a new agent (install re-runs on boot).
EOF
  exit 1
fi

link_platform_sdk "$baas"

for app in storefront quote-service; do
  if [[ ! -f "$ROOT/$app/package.json" ]]; then
    continue
  fi
  echo "=== npm install: $app ==="
  (cd "$ROOT/$app" && (npm ci 2>/dev/null || npm install))
done

echo "Cloud Agent IAP bootstrap OK (symlfy-baas → /symlfy-baas)."
