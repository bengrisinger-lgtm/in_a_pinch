#!/usr/bin/env bash
# Build @securedbackend/sdk for IAP Vite (browser). Default `npm run build` may emit Node transport.js.
set -euo pipefail

SDK_DIR="${1:?path to syml-platform/client-sdk}"
cd "$SDK_DIR"

echo "=== client-sdk package.json (scripts + exports) ==="
node <<'NODE'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
console.log('scripts:', JSON.stringify(pkg.scripts || {}, null, 2));
console.log('exports:', JSON.stringify(pkg.exports || null, null, 2));
console.log('browser field:', pkg.browser || '(none)');
NODE

npm install

if grep -q '"build:browser"' package.json; then
  echo "=== npm run build:browser ==="
  npm run build:browser
elif grep -q '"build:client"' package.json; then
  echo "=== npm run build:client ==="
  npm run build:client
else
  echo "=== npm run build (no build:browser script found) ==="
  npm run build
fi

echo "=== dist/ ==="
ls -la dist/ || true

ENTRY=""
if [[ -f dist/browser.js ]]; then
  ENTRY="dist/browser.js"
elif [[ -f dist/client.js ]]; then
  ENTRY="dist/client.js"
elif [[ -f dist/index.js ]] && ! grep -q 'node:fs' dist/transport.js 2>/dev/null; then
  ENTRY="dist/index.js"
elif [[ -f dist/index.js ]]; then
  echo "ERROR: dist/transport.js uses Node built-ins; client-sdk needs npm run build:browser (or fix exports.browser) in symlfy-baas." >&2
  exit 1
else
  echo "ERROR: no dist/*.js entry after SDK build" >&2
  exit 1
fi

SDK_BROWSER_ENTRY="$(pwd)/$ENTRY"
echo "SDK_BROWSER_ENTRY=$SDK_BROWSER_ENTRY"
if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "SDK_BROWSER_ENTRY=$SDK_BROWSER_ENTRY" >>"$GITHUB_ENV"
fi
