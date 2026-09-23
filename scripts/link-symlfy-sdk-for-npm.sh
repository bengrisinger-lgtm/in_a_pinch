#!/usr/bin/env bash
# Point storefront/quote-service at a symlfy-baas checkout (Actions + Cloud Agent).
# Rewrites package.json in the working tree only — do not commit. After linking,
# run `rm -f storefront/package-lock.json quote-service/package-lock.json` then npm install.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BAAS="${SYMLFY_BAAS_ROOT:-}"

if [[ -z "$BAAS" ]]; then
  for candidate in \
    "$ROOT/../symlfy-baas" \
    "$ROOT/symlfy-baas" \
    "${GITHUB_WORKSPACE:-}/symlfy-baas" \
    /symlfy-baas; do
    if [[ -f "$candidate/syml-platform/client-sdk/package.json" ]]; then
      BAAS="$candidate"
      break
    fi
  done
fi

if [[ ! -f "${BAAS:-}/syml-platform/client-sdk/package.json" ]]; then
  echo "symlfy-baas client-sdk not found (set SYMLFY_BAAS_ROOT)" >&2
  exit 1
fi

sdk_abs="$(cd "$BAAS/syml-platform/client-sdk" && pwd)"

for app in storefront quote-service; do
  app_dir="$ROOT/$app"
  [[ -f "$app_dir/package.json" ]] || continue
  rel="$(python3 -c "import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))" "$sdk_abs" "$app_dir")"
  echo "=== $app → @securedbackend/sdk file:$rel ==="
  npm pkg set "dependencies.@securedbackend/sdk=file:$rel" --prefix "$app_dir"
done
