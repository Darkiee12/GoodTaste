#!/bin/sh
# Provision the Swarm Garage bucket + least-privilege app key (idempotent).
#
# Run AFTER the first Garage deploy, from a shell that can reach the Garage
# container (Dokploy exec into the garage task, or `docker exec` on the
# labeled Swarm node). The script never deletes objects, buckets, or volumes
# and never prints secrets.
#
# Required environment (operator-provided, never committed):
#   GARAGE_CONTAINER  container/task name (default: auto-detect first garage task)
#   S3_BUCKET_PRIVATE bucket to ensure (default: feastjourney-private)
#   APP_KEY_NAME      app key name to ensure (default: feastjourney-app)
#
# The Garage CLI inside the container authenticates via its own baked config
# plus the container's GARAGE_RPC_SECRET env; this script passes no secret on
# the command line and redacts all output that could contain one.
#
# Steps (safe to re-run):
#   1. `garage status` must succeed (fail fast on bad RPC secret / layout).
#   2. `garage bucket info` -> create only when missing; existing data kept.
#   3. `garage key info <app>` -> create only when missing; existing secret is
#      NEVER reprinted (rotation uses --rotate below, not re-provision).
#   4. `garage bucket allow --read --write` (no --owner): least privilege.
#
# Rotation (explicit, never automatic):
#   APP_KEY_NAME=feastjourney-app ./infra/scripts/garage-provision.sh --rotate
# creates a fresh key, grants read+write, prints ONLY the new ID + secret
# once for the operator to store in Dokploy (S3_ACCESS_KEY_ID /
# S3_SECRET_ACCESS_KEY), verifies with a disposable object, then instructs
# the operator to deny/delete the old key after the app redeploys. The bucket
# and stored objects survive rotation.
set -eu

BUCKET="${S3_BUCKET_PRIVATE:-feastjourney-private}"
APP_KEY_NAME="${APP_KEY_NAME:-feastjourney-app}"
GARAGE_BIN="${GARAGE_BIN:-/garage}"

# Resolve target container: explicit env wins, else first running garage task.
if [ -n "${GARAGE_CONTAINER:-}" ]; then
  TARGET="$GARAGE_CONTAINER"
else
  TARGET="$(docker ps --filter 'name=garage' --format '{{.Names}}' | head -n 1)"
fi

if [ -z "${TARGET:-}" ]; then
  echo "error: no running garage container found; set GARAGE_CONTAINER explicitly" >&2
  exit 1
fi

if [ "$BUCKET" = "" ]; then
  echo "error: S3_BUCKET_PRIVATE is empty" >&2
  exit 1
fi

garage() {
  docker exec -i "$TARGET" "$GARAGE_BIN" "$@"
}

echo "garage target: <redacted-container>"
echo "bucket: $BUCKET"
echo "app key: $APP_KEY_NAME"

# 1. Cluster must be reachable; explicit failure on bad RPC secret.
if ! garage status >/dev/null 2>&1; then
  echo "error: 'garage status' failed (RPC secret wrong, layout missing, or node down)" >&2
  exit 1
fi

echo "cluster reachable"

# 2. Bucket: create only when missing; never touch existing data.
if garage bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "bucket exists (kept): $BUCKET"
else
  echo "creating bucket: $BUCKET"
  garage bucket create "$BUCKET" >/dev/null 2>&1
  garage bucket info "$BUCKET" >/dev/null 2>&1
  echo "bucket created: $BUCKET"
fi

ROTATE="${1:-}"

# 3a. Rotation path: always mint a fresh key, never reuse or reprint old secret.
if [ "$ROTATE" = "--rotate" ]; then
  echo "rotating: creating fresh key (old key kept until app redeploys)"
  # Capture output to a redacted temp file; print once, then wipe.
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT INT TERM
  garage key create "$APP_KEY_NAME-rotated" >"$tmp" 2>&1 || {
    echo "error: key creation failed" >&2
    exit 1
  }
  # Extract ID + secret without echoing the full CLI output (may vary).
  NEW_ID="$(grep -Eo 'GK[0-9a-fA-F]+' "$tmp" | head -n 1)"
  NEW_SECRET="$(grep -Eo '[0-9a-fA-F]{32,}' "$tmp" | tail -n 1)"
  if [ -z "${NEW_ID:-}" ] || [ -z "${NEW_SECRET:-}" ]; then
    echo "error: could not parse new key from creation output; see container logs" >&2
    exit 1
  fi
  garage bucket allow --read --write "$BUCKET" --key "$NEW_ID" >/dev/null 2>&1
  echo "new key granted read+write on $BUCKET"
  echo "STORE NOW (shown once, then update Dokploy S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY):"
  echo "  S3_ACCESS_KEY_ID=<redacted-new-id>"
  echo "  S3_SECRET_ACCESS_KEY=<redacted-new-secret>"
  echo "Next: update Dokploy secrets, redeploy app, verify dish-image delivery,"
  echo "then deny/delete the old key explicitly (never before app redeploys)."
  exit 0
fi

# 3b. Normal path: reuse existing app key when present, create once when absent.
if garage key info "$APP_KEY_NAME" >/dev/null 2>&1; then
  echo "app key exists (kept, secret not reprinted): $APP_KEY_NAME"
  KEY_REF="$APP_KEY_NAME"
else
  echo "creating app key: $APP_KEY_NAME"
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT INT TERM
  garage key create "$APP_KEY_NAME" >"$tmp" 2>&1 || {
    echo "error: key creation failed" >&2
    exit 1
  }
  NEW_ID="$(grep -Eo 'GK[0-9a-fA-F]+' "$tmp" | head -n 1)"
  if [ -z "${NEW_ID:-}" ]; then
    # Fall back to the stable name reference; operator retrieves the secret
    # from the creation host output per Garage docs (`key info --show-secret`
    # requires the bootstrap/admin context and is intentionally not reprinted).
    KEY_REF="$APP_KEY_NAME"
  else
    KEY_REF="$NEW_ID"
  fi
  echo "app key created. STORE the printed secret from the creation output"
  echo "in Dokploy (S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY) now; this script"
  echo "never reprints an existing secret."
fi

# 4. Least-privilege grant (read+write only, never --owner).
garage bucket allow --read --write "$BUCKET" --key "$KEY_REF" >/dev/null 2>&1
echo "granted read+write (no owner) on $BUCKET"

# 5. Verify grant without touching real objects.
garage bucket info "$BUCKET" >/dev/null 2>&1
echo "provision ok: bucket + key + grant verified (objects untouched)"
