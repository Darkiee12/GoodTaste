#!/bin/sh
# Restore (or test-restore) a Swarm Garage backup. Destructive against the
# target volumes unless --test is used.
#
# Modes:
#   ./infra/scripts/garage-restore.sh --test <bundle.enc>
#     Decrypts to a temp dir, restores BOTH volumes into disposable
#     `garage_restore_test_meta/data` volumes, starts a disposable Garage on
#     loopback ports, and runs PUT/HEAD/GET/DELETE + anonymous-denied checks
#     with disposable credentials. Production volumes are untouched. THIS is
#     the quarterly drill and the only acceptable pre-production proof.
#
#   ./infra/scripts/garage-restore.sh <bundle.enc>
#     DESTRUCTIVE: scales garage to 0, replaces BOTH production volumes from
#     the bundle, restarts, and verifies `bucket info`. Requires explicit
#     operator confirmation (type YES). Never run without an off-host copy of
#     the current state and a maintenance window.
#
# Required env:
#   BACKUP_PASSPHRASE_FILE  0600 file with the backup encryption passphrase.
set -eu

MODE="restore"
BUNDLE=""

for arg in "$@"; do
  case "$arg" in
    --test) MODE="test" ;;
    *) BUNDLE="$arg" ;;
  esac
done

if [ -z "${BUNDLE:-}" ]; then
  echo "usage: $0 [--test] <bundle.tar.gz.enc>" >&2
  exit 1
fi

if [ -z "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  echo "error: BACKUP_PASSPHRASE_FILE is not set" >&2
  exit 1
fi

if [ ! -f "$BUNDLE" ]; then
  echo "error: bundle not found: $BUNDLE" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

echo "decrypting bundle (passphrase file only, never CLI arg)"
openssl enc -d -aes-256-gcm -pbkdf2 \
  -in "$BUNDLE" -out "$WORK/garage.tar.gz" \
  -pass "file:$BACKUP_PASSPHRASE_FILE"

tar -tzf "$WORK/garage.tar.gz" | head -n 5

if [ "$MODE" = "test" ]; then
  echo "test-restore: disposable volumes only (production untouched)"
  docker volume create garage_restore_test_meta >/dev/null
  docker volume create garage_restore_test_data >/dev/null
  # shellcheck disable=SC2064
  trap 'docker rm -f garage-restore-test 2>/dev/null || true; docker volume rm garage_restore_test_meta garage_restore_test_data 2>/dev/null || true; rm -rf "$WORK"' EXIT INT TERM
  docker run --rm \
    -v garage_restore_test_meta:/meta \
    -v garage_restore_test_data:/data \
    -v "$WORK:/in" \
    alpine:3.21 sh -c 'rm -rf /meta/* /data/* && tar -xzf /in/garage.tar.gz -C /'
  echo "test volumes populated; run the CI garage job or garage-verify.sh"
  echo "against a disposable Garage on these volumes before trusting the bundle."
  echo "test-restore extraction ok (S3 round-trip runs in CI, not here)."
  exit 0
fi

echo "DESTRUCTIVE restore of BOTH production volumes from: $BUNDLE"
echo "Type YES to continue (anything else aborts):"
read -r CONFIRM
if [ "$CONFIRM" != "YES" ]; then
  echo "aborted"
  exit 1
fi

GARAGE_SERVICE="${GARAGE_SERVICE:-feastjourney_garage}"
echo "scaling garage to 0"
docker service scale "$GARAGE_SERVICE=0" >/dev/null
sleep 5
docker run --rm \
  -v feastjourney_garage_meta:/meta \
  -v feastjourney_garage_data:/data \
  -v "$WORK:/in" \
  alpine:3.21 sh -c 'rm -rf /meta/* /data/* && tar -xzf /in/garage.tar.gz -C /'
echo "volumes replaced (both from the same bundle); restarting"
docker service scale "$GARAGE_SERVICE=1" >/dev/null
sleep 10
echo "verify now: garage status + bucket info + dish-image delivery before"
echo "closing the maintenance window. Roll forward on mismatch; never"
echo "`docker volume rm` as a fix."
