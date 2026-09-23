#!/usr/bin/env bash
# Install google-cloud-cli when the base image is the default Cloud Agent snapshot (no custom Dockerfile).
set -euo pipefail

if command -v gcloud >/dev/null 2>&1; then
  exit 0
fi

if ! command -v sudo >/dev/null; then
  echo "gcloud not installed and sudo unavailable (custom Dockerfile should provide gcloud)." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y --no-install-recommends ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/cloud.google.gpg
echo "deb [signed-by=/etc/apt/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
  | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list >/dev/null
sudo apt-get update
sudo apt-get install -y --no-install-recommends google-cloud-cli rsync git
sudo rm -rf /var/lib/apt/lists/*
