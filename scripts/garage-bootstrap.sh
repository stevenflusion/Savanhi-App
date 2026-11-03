#!/usr/bin/env bash
#
# Idempotent development bootstrap for the Compose `garage` service.
#
# Run it as many times as you like: it assigns the single-node cluster layout,
# creates the bucket and imports the S3 key only when they are missing, and
# always re-applies the bucket permissions (which Garage treats as a set, not an
# append). It exits non-zero when Garage never becomes usable.
#
#   docker compose up -d garage
#   ./scripts/garage-bootstrap.sh
#
# Every credential below is the committed development fixture shared with
# infra/garage/garage.toml and .env.example. DEV-ONLY — never used in production.
set -euo pipefail

SERVICE="${GARAGE_COMPOSE_SERVICE:-garage}"
BUCKET="${GARAGE_BUCKET:-savanhi-dev}"
KEY_NAME="${GARAGE_KEY_NAME:-savanhi-dev}"
# DEV-ONLY SECRET
KEY_ID="${GARAGE_ACCESS_KEY_ID:-GK1a2b3c4d5e6f708192a3b4c5}"
# DEV-ONLY SECRET
SECRET_KEY="${GARAGE_SECRET_ACCESS_KEY:-a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90}"
ZONE="${GARAGE_ZONE:-dev}"
CAPACITY="${GARAGE_CAPACITY:-1G}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

garage() {
  docker compose exec -T "$SERVICE" /garage "$@"
}

wait_for() {
  local label="$1"
  shift
  local attempt=1
  until "$@" >/dev/null 2>&1; do
    if [ "$attempt" -ge 30 ]; then
      echo "garage-bootstrap: timed out waiting for ${label}" >&2
      return 1
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
}

echo "garage-bootstrap: waiting for the node to answer RPC"
wait_for "the garage node" garage status

NODE_ID="$(garage node id -q 2>/dev/null | tr -d '\r' | cut -d@ -f1)"
if [ -z "$NODE_ID" ]; then
  echo "garage-bootstrap: could not read the garage node id" >&2
  exit 1
fi

if garage layout show 2>/dev/null | grep -q "No nodes currently have a role"; then
  echo "garage-bootstrap: assigning the layout to node ${NODE_ID:0:16}"
  garage layout assign -z "$ZONE" -c "$CAPACITY" "$NODE_ID" >/dev/null
  # Layout version 0 is the empty layout, so the first applied version is 1.
  NEXT_VERSION="$(($(garage layout show 2>/dev/null | sed -n 's/^Current cluster layout version: //p' | tail -n 1) + 1))"
  garage layout apply --version "$NEXT_VERSION" >/dev/null
else
  echo "garage-bootstrap: layout already assigned"
fi

echo "garage-bootstrap: waiting for the cluster to report healthy"
wait_for "a healthy garage cluster" garage health -q

if garage bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "garage-bootstrap: bucket ${BUCKET} already exists"
else
  echo "garage-bootstrap: creating bucket ${BUCKET}"
  garage bucket create "$BUCKET" >/dev/null
fi

if garage key info "$KEY_ID" >/dev/null 2>&1; then
  echo "garage-bootstrap: key ${KEY_ID} already exists"
else
  echo "garage-bootstrap: importing key ${KEY_ID}"
  garage key import "$KEY_ID" "$SECRET_KEY" -n "$KEY_NAME" --yes >/dev/null
fi

echo "garage-bootstrap: granting read/write on ${BUCKET} to ${KEY_ID}"
garage bucket allow --read --write "$BUCKET" --key "$KEY_ID" >/dev/null

echo "garage-bootstrap: ready — bucket ${BUCKET} is writable with key ${KEY_ID}"
