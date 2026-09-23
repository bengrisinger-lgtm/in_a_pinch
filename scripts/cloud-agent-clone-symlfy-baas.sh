#!/usr/bin/env bash
# Clone symlfy-baas when Cursor repositoryDependencies cannot (private repo / app scope).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${SYMLFY_BAAS_CLONE_DIR:-$ROOT/../symlfy-baas}"
REPO="${SYMLFY_BAAS_GITHUB_REPO:-bengrisinger-lgtm/symlfy-baas}"

if [[ -f "$DEST/syml-platform/client-sdk/package.json" ]]; then
  exit 0
fi

TOKEN="${SYMLFY_BAAS_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "SYMLFY_BAAS_GITHUB_TOKEN not set — cannot clone $REPO." >&2
  exit 1
fi

if ! command -v git >/dev/null; then
  echo "git required to clone symlfy-baas." >&2
  exit 1
fi

echo "Cloning https://github.com/${REPO} → $DEST"
rm -rf "$DEST"
git clone --depth 1 "https://x-access-token:${TOKEN}@github.com/${REPO}.git" "$DEST"

if [[ ! -f "$DEST/syml-platform/client-sdk/package.json" ]]; then
  echo "Clone succeeded but layout unexpected (missing syml-platform/client-sdk)." >&2
  exit 1
fi
