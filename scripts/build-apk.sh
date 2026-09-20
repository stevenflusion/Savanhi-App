#!/usr/bin/env bash
set -euo pipefail

cd /workspace
mkdir -p artifacts

pnpm install --frozen-lockfile

cd apps/Tenderos/mobile
eas build \
  --platform android \
  --profile preview \
  --local \
  --freeze-credentials \
  --non-interactive \
  --output /workspace/artifacts/tenderos-preview.apk
