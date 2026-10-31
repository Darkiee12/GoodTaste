#!/usr/bin/env bash
# Back up Swarm Garage metadata + object data to one encrypted off-host bundle.
#
# Consistency model: Garage splits state across two volumes (meta + data). A
# backup is only restorable when BOTH volumes come from the same quiesced
# instant. This script stops the garage task, archives both volumes from a
# helper container, encrypts with OpenSSL (AES-256-GCM via `enc`), then
# restarts the task. Downtime is bounded to the archive duration; do NOT back
# up live volumes with `tar` while Garage writes ( torn meta/data pairs do not
# restore cleanly).
#
# Usage (on the labeled storage node, authorized shell only):
#   BACKUP_PASSPHRASE_FILE=/run/secrets/garage-backup-passphrase \
#   BACKUP_DIR=/var/backups/garage \
#   ./infra/scripts/garage-backup.sh
#
# Required env:
#   BACKUP_PASSPHRASE_FILE  path to a 0600 file with the backup encryption
#                           passphrase (never the Garage RPC/S3 secrets).
# Optional:
#   BACKUP_DIR              default /var/backups/garage (must exist, 0700).
#   GARAGE_SERVICE          Swarm service name (default: feastjourney_garage).
#   RETENTION_DAILY         default 7; RETENTION_WEEKLY default 4.
#
# Output: $BACKUP_DIR/garage-YYYYmmddTHHMMSSZ.tar.gz.enc plus a
# `.sha256` sidecar. Copy the bundle off-host immediately (scp/rclone to
# object storage in another region); a backup that stays on the same disk as
# the volumes is NOT an off-host backup. Retention prunes local copies only;
# off-host retention is the operator's replication policy.
#
# Frequency/retention contract (documented, see object-storage.md):
# daily, keep 7 daily + 4 weekly (Sunday) local copies; off-host copies follow
# the same rule in the remote bucket. Every backup must be followed by a
# quarterly restore drill to disposable volumes (see garage-restore.sh).
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/garage}"
GARAGE_SERVICE="${GARAGE_SERVICE:-feastjourney_garage}"

if [ -z "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  echo "error: BACKUP_PASSPHRASE_FILE is not set (0600 passphrase file required)" >&2
  exit 1
fi

if [ ! -f "$BACKUP_PASSPHRASE_FILE" ]; then
  echo "error: passphrase file not found: $BACKUP_PASSPHRASE_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

ARCHIVE="$WORK/garage-$STAMP.tar.gz"
ENCRYPTED="$BACKUP_DIR/garage-$STAMP.tar.gz.enc"

echo "scaling garage to 0 for a quiesced backup (downtime starts)"
docker service scale "$GARAGE_SERVICE=0" >/dev/null
# Wait until no garage task is Running.
deadline=$((SECONDS + 120))
while [ $SECONDS -lt $deadline ]; do
  running="$(docker service ps --filter desired-state=running --format '{{.CurrentState}}' "$GARAGE_SERVICE" 2>/dev/null | grep -c Running || true)"
  if [ "${running:-1}" = "0" ]; then
    break
  fi
  sleep 2
done

# Archive both named volumes in one helper invocation (same instant).
docker run --rm \
  -v feastjourney_garage_meta:/meta:ro \
  -v feastjourney_garage_data:/data:ro \
  -v "$WORK:/out" \
  alpine:3.21 tar -czf "/out/garage-$STAMP.tar.gz" -C / meta data

echo "restarting garage (downtime ends)"
docker service scale "$GARAGE_SERVICE=1" >/dev/null

# Encrypt at rest; the passphrase file never enters the image or git.
openssl enc -aes-256-gcm -pbkdf2 \
  -in "$ARCHIVE" -out "$ENCRYPTED" \
  -pass "file:$BACKUP_PASSPHRASE_FILE"
sha256sum "$ENCRYPTED" >"$ENCRYPTED.sha256"
chmod 0600 "$ENCRYPTED" "$ENCRYPTED.sha256"

echo "backup: $ENCRYPTED"
echo "sha256: $(cut -d' ' -f1 "$ENCRYPTED.sha256")"

# Local retention: keep 7 most recent daily + Sunday weeklies (4). Off-host
# retention mirrors this in the remote copy (operator policy, not this host).
RETENTION_DAILY="${RETENTION_DAILY:-7}"
RETENTION_WEEKLY="${RETENTION_WEEKLY:-4}"
# Prune non-Sunday bundles beyond daily count; keep Sunday bundles up to weekly.
ls -1t "$BACKUP_DIR"/garage-*.tar.gz.enc 2>/dev/null | tail -n +"$((RETENTION_DAILY + 1))" | while read -r f; do
  base="$(basename "$f")"
  # Sunday check via filename date (position 7-14 = YYYYmmdd); portable fallback keeps file.
  day="$(echo "$base" | sed -n 's/^garage-\([0-9]\{8\}\)T.*/\1/p')"
  if [ -n "$day" ]; then
    dow="$(date -d "${day}" +%u 2>/dev/null || echo 8)"
    if [ "$dow" = "7" ]; then
      continue
    fi
  fi
  rm -f "$f" "$f.sha256"
done
# Cap Sunday weeklies.
sundays="$(ls -1t "$BACKUP_DIR"/garage-*.tar.gz.enc 2>/dev/null | wc -l)"
if [ "${sundays:-0}" -gt $((RETENTION_DAILY + RETENTION_WEEKLY)) ]; then
  ls -1t "$BACKUP_DIR"/garage-*.tar.gz.enc 2>/dev/null | tail -n +"$((RETENTION_DAILY + RETENTION_WEEKLY + 1))" | while read -r f; do
    rm -f "$f" "$f.sha256"
  done
fi

echo "COPY OFF-HOST NOW (scp/rclone); verify sha256 at the destination."
echo "Next: quarterly restore drill with garage-restore.sh --test."
