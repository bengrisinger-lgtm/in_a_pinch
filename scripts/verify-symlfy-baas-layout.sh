#!/usr/bin/env bash
# Print symlfy-baas tree expected by IAP deploy (Actions + overlay). Exit 1 if SDK missing.
set -euo pipefail

ROOT="${1:-${GITHUB_WORKSPACE:-}/symlfy-baas}"
if [[ ! -d "$ROOT" ]]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)/symlfy-baas"
fi
if [[ ! -d "$ROOT" ]]; then
  echo "ERROR: symlfy-baas not found (pass path or checkout to symlfy-baas/)" >&2
  exit 1
fi

echo "=== symlfy-baas root: $ROOT ==="
ls -la "$ROOT" | head -40

SDK="$ROOT/syml-platform/client-sdk/package.json"
RECURRING="$ROOT/RECURRING-BUG-CLASSES.md"
CONSOLE_ROOT="$ROOT/console-app/package.json"
CONSOLE_PLATFORM="$ROOT/syml-platform/console-app/package.json"

echo ""
echo "=== IAP deploy expectations ==="
if [[ -f "$SDK" ]]; then
  echo "OK  client-sdk (required for storefront build): $SDK"
else
  echo "MISSING client-sdk: $SDK" >&2
  exit 1
fi

if [[ -f "$RECURRING" ]]; then
  echo "OK  RECURRING-BUG-CLASSES (agent read-first): $RECURRING"
else
  echo "WARN RECURRING-BUG-CLASSES missing at repo root (add before agent/deploy work): $RECURRING" >&2
fi

if [[ -f "$CONSOLE_ROOT" ]]; then
  echo "OK  console-app at repo root (overlay): $CONSOLE_ROOT"
elif [[ -f "$CONSOLE_PLATFORM" ]]; then
  echo "OK  console-app under syml-platform (overlay): $CONSOLE_PLATFORM"
else
  echo "MISSING console-app (hub /console/ overlay cannot build in CI until this exists on GitHub)"
  echo "      checked: $ROOT/console-app"
  echo "               $ROOT/syml-platform/console-app"
  exit 0
fi
