#!/usr/bin/env bash
# Build hub /console/ overlay (requires symlfy-baas console-app).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STOREFRONT="$ROOT/storefront"

resolve_baas_root() {
  if [[ -n "${SYMLFY_BAAS_ROOT:-}" && -d "$SYMLFY_BAAS_ROOT" ]]; then
    printf '%s' "$SYMLFY_BAAS_ROOT"
    return 0
  fi
  if [[ -n "${GITHUB_WORKSPACE:-}" && -d "${GITHUB_WORKSPACE}/symlfy-baas" ]]; then
    printf '%s' "${GITHUB_WORKSPACE}/symlfy-baas"
    return 0
  fi
  if [[ -d "$ROOT/symlfy-baas" ]]; then
    printf '%s' "$ROOT/symlfy-baas"
    return 0
  fi
  if [[ -d /symlfy-baas ]]; then
    printf '%s' /symlfy-baas
    return 0
  fi
  return 1
}

resolve_console_app() {
  local baas="$1"
  for candidate in "$baas/console-app" "$baas/syml-platform/console-app"; do
    if [[ -f "$candidate/package.json" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

BAAS="$(resolve_baas_root)" || {
  echo "symlfy-baas checkout not found (set SYMLFY_BAAS_ROOT or run after Actions checkout)." >&2
  exit 1
}
CONSOLE_APP="$(resolve_console_app "$BAAS")" || {
  echo "console-app not found under $BAAS (expected console-app/ or syml-platform/console-app/)." >&2
  echo "Uncheck build_console_overlay in the workflow, or push console-app to symlfy-baas on GitHub." >&2
  exit 1
}
OVERLAY="$STOREFRONT/console-dist"
THEME="$STOREFRONT/console-overlay/iap-console.css"

if [[ ! -f "$CONSOLE_APP/package.json" ]]; then
  echo "console-app not found at $CONSOLE_APP (need symlfy-baas checkout)." >&2
  exit 1
fi
if [[ ! -f "$THEME" ]]; then
  echo "Missing $THEME" >&2
  exit 1
fi

SHELL_LINKS='[{"label":"Hub","href":"/#home"},{"label":"Rentals","href":"/#rentals"},{"label":"Orders","href":"/#orders"},{"label":"Stock","href":"/#stock"},{"label":"Vault","href":"/console/index.html?as=tenant"}]'

export VITE_API_GATEWAY_URL="${VITE_API_GATEWAY_URL:-https://api.inapinchav.com}"
export VITE_AUTH_URL="${VITE_AUTH_URL:-https://auth.inapinchav.com}"
export VITE_CONSOLE_URL="${VITE_CONSOLE_URL:-https://hub.inapinchav.com/console/index.html}"
export VITE_BRAND_NAME="${VITE_BRAND_NAME:-In a Pinch AV}"
export VITE_SHELL_LINKS="$SHELL_LINKS"

echo "=== console-app overlay build ==="
(
  cd "$CONSOLE_APP"
  npm install
  npm run build -- --base=/console/
)

rm -rf "$OVERLAY"
mkdir -p "$OVERLAY"
cp -a "$CONSOLE_APP/dist/." "$OVERLAY/"
cp "$THEME" "$OVERLAY/iap-console.css"

INDEX="$OVERLAY/index.html"
if ! grep -q 'iap-console.css' "$INDEX"; then
  sed -i 's|</head>|  <link rel="stylesheet" href="./iap-console.css" />\n</head>|' "$INDEX"
fi

echo "=== restore platform console-app dist ==="
(
  cd "$CONSOLE_APP"
  npm run build
)

echo "Overlay ready at $OVERLAY"
