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
  mkdir -p /symlfy-baas 2>/dev/null || true
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
  if [[ ! -d /symlfy-baas ]]; then
    echo "Missing /symlfy-baas mount (Cloud Agent Dockerfile should create it)." >&2
    exit 1
  fi
  ln -sfn "$baas_root" /symlfy-baas

  local sdk_root="$baas_root/syml-platform/client-sdk"
  # Match local deploy.ps1: storefront does not rebuild client-sdk. Only build if dist is absent.
  if [[ ! -f "$sdk_root/dist/index.js" && -f "$sdk_root/package.json" ]]; then
    echo "Building @securedbackend/sdk (dist/index.js missing)…"
    (cd "$sdk_root" && npm install && npm run build)
  fi
}

if ! baas="$(find_symlfy_baas)"; then
  if [[ -n "${SYMLFY_BAAS_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
    bash "$ROOT/scripts/cloud-agent-clone-symlfy-baas.sh"
    baas="$(find_symlfy_baas)" || true
  fi
fi

if [[ -z "${baas:-}" ]]; then
  cat >&2 <<'EOF'
symlfy-baas not found. Cloud Agent needs the platform repo for @securedbackend/sdk.

Fix (pick one that matches your GitHub layout):

A) Environment secret SYMLFY_BAAS_GITHUB_TOKEN — fine-grained PAT with Contents:Read
   on symlfy-baas (same idea as GitHub Actions). Optional SYMLFY_BAAS_GITHUB_REPO if
   the repo is not bengrisinger-lgtm/symlfy-baas (run `git remote get-url origin`
   inside your local symlfy-baas folder and use owner/repo only).

B) Cursor repositoryDependencies + GitHub App read on that exact repo
   (github.com/<owner>/symlfy-baas — must match a real repo URL, not a guess).

C) SYMLFY_BAAS_ROOT — absolute path if baas is already on disk.

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
