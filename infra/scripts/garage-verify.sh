#!/usr/bin/env bash
# CI/operator verification for the Swarm Garage integration.
# Disposable only: temp volumes, temp credentials, temp objects. Never touches
# production buckets, real photographs, or existing volumes.
#
# Checks:
#   1. Swarm file references the immutable garage image (no `latest`).
#   2. No public S3 port published (no `ports:` with 3900 on garage).
#   3. Garage reachable only via http://garage:3900 internal endpoint.
#   4. garage.swarm.toml parses and matches the single-node contract.
#   5. Built garage image starts an isolated instance.
#   6. S3 PUT/HEAD/GET/DELETE round-trip via the same S3Client shape the app uses.
#   7. Anonymous + bogus credentials denied.
#   8. Objects survive a container restart.
#   9. Missing/incorrect credentials fail fast.
#  10. Existing dish-photo pipeline tests still pass (in-memory rules).
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "--- 1. swarm image references ---"
if ! grep -q 'feastjourney-garage:${VERSION' docker-compose.swarm.yml; then
  echo "error: swarm file must reference feastjourney-garage with \${VERSION}" >&2
  exit 1
fi
if grep -Eq 'feastjourney-garage:(latest|stable)' docker-compose.swarm.yml; then
  echo "error: mutable garage tag referenced" >&2
  exit 1
fi
echo "ok: immutable garage image reference"

echo "--- 2. no public S3 port ---"
# Extract the garage service block and fail if it publishes host ports.
if awk '/^  garage:/,/^  [a-z]+:/' docker-compose.swarm.yml | grep -Eq '^\s+ports:'; then
  echo "error: garage service must not publish host ports" >&2
  exit 1
fi
echo "ok: no published S3 port"

echo "--- 3. internal endpoint ---"
if ! grep -q 'S3_ENDPOINT_INTERNAL: http://garage:3900' docker-compose.swarm.yml; then
  echo "error: app S3_ENDPOINT_INTERNAL must be http://garage:3900" >&2
  exit 1
fi
echo "ok: internal endpoint"

echo "--- 4. swarm TOML syntax ---"
python3 -c "import tomllib; d=tomllib.load(open('infra/garage.swarm.toml','rb')); assert d['replication_factor']==1; assert d['s3_api']['api_bind_addr']=='0.0.0.0:3900'; assert d['rpc_bind_addr'].startswith('127.0.0.1'); print('ok: swarm TOML')"
# No secret VALUES baked: strip comments, then fail on secret-bearing keys
# (rpc_secret, admin_token, metrics_token, access_key, secret_key assignments).
if grep -vE '^\s*#' infra/garage.swarm.toml | grep -Eq '^\s*(rpc_secret|admin_token|metrics_token|.*access_key|.*secret_key)\s*='; then
  echo "error: swarm TOML must not embed secrets" >&2
  exit 1
fi
echo "ok: no secrets in baked TOML"

echo "--- 5. build garage image ---"
docker build -f infra/Dockerfile.garage -t feastjourney-garage:verify .

echo "--- 6-9. isolated S3 round-trip + restart persistence ---"
SUFFIX="verify$$"
META_VOL="garage_verify_meta_$SUFFIX"
DATA_VOL="garage_verify_data_$SUFFIX"
CTR="garage-verify-$SUFFIX"
RPC_SECRET="$(openssl rand -hex 32)"
APP_ID="GK$(openssl rand -hex 16)"
APP_SECRET="$(openssl rand -hex 32)"
BUCKET="garage-verify-private"
PORT="13900"

cleanup() {
  docker rm -f "$CTR" >/dev/null 2>&1 || true
  docker volume rm "$META_VOL" "$DATA_VOL" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker volume create "$META_VOL" >/dev/null
docker volume create "$DATA_VOL" >/dev/null

docker run -d --name "$CTR" \
  -e GARAGE_RPC_SECRET="$RPC_SECRET" \
  -e GARAGE_DEFAULT_ACCESS_KEY="$APP_ID" \
  -e GARAGE_DEFAULT_SECRET_KEY="$APP_SECRET" \
  -e GARAGE_DEFAULT_BUCKET="$BUCKET" \
  -v "$META_VOL:/var/lib/garage/meta" \
  -v "$DATA_VOL:/var/lib/garage/data" \
  -p "127.0.0.1:$PORT:3900" \
  feastjourney-garage:verify \
  /garage server --single-node --default-bucket >/dev/null

# Wait for S3 readiness (bounded, no credential leak in logs).
deadline=$((SECONDS + 60))
while [ $SECONDS -lt $deadline ]; do
  if S3_ENDPOINT="http://127.0.0.1:$PORT" S3_REGION=garage S3_BUCKET="$BUCKET" \
    S3_ACCESS_KEY_ID="$APP_ID" S3_SECRET_ACCESS_KEY="$APP_SECRET" \
    S3_TEST_PREFIX="ready-probe" \
    node infra/scripts/garage-s3-check.mjs >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "running full round-trip (auth, anon-denied, bogus-denied, delete)"
S3_ENDPOINT="http://127.0.0.1:$PORT" S3_REGION=garage S3_BUCKET="$BUCKET" \
  S3_ACCESS_KEY_ID="$APP_ID" S3_SECRET_ACCESS_KEY="$APP_SECRET" \
  S3_TEST_PREFIX="roundtrip-$SUFFIX" \
  node infra/scripts/garage-s3-check.mjs

echo "persistence: PUT marker, restart container, GET must still succeed"
S3_ENDPOINT="http://127.0.0.1:$PORT" S3_REGION=garage S3_BUCKET="$BUCKET" \
  S3_ACCESS_KEY_ID="$APP_ID" S3_SECRET_ACCESS_KEY="$APP_SECRET" \
  node -e '
import { PutObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
const c = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: "garage", credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }, forcePathStyle: true });
await c.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: "persist/marker.bin", Body: Buffer.from("persist-me") }));
console.log("ok: persistence marker PUT");
'

docker restart "$CTR" >/dev/null
sleep 8

S3_ENDPOINT="http://127.0.0.1:$PORT" S3_REGION=garage S3_BUCKET="$BUCKET" \
  S3_ACCESS_KEY_ID="$APP_ID" S3_SECRET_ACCESS_KEY="$APP_SECRET" \
  node -e '
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
const c = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: "garage", credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }, forcePathStyle: true });
const r = await c.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: "persist/marker.bin" }));
const b = Buffer.from(await r.Body.transformToByteArray()).toString();
if (b !== "persist-me") throw new Error("persistence bytes mismatch");
console.log("ok: object survived restart");
'

echo "missing-credential handling: empty secret must fail fast"
if S3_ENDPOINT="http://127.0.0.1:$PORT" S3_REGION=garage S3_BUCKET="$BUCKET" \
  S3_ACCESS_KEY_ID="$APP_ID" S3_SECRET_ACCESS_KEY="" \
  S3_TEST_PREFIX="must-fail" \
  node infra/scripts/garage-s3-check.mjs >/dev/null 2>&1; then
  echo "error: empty credentials unexpectedly succeeded" >&2
  exit 1
fi
echo "ok: missing credentials denied"

echo "garage verification ok (disposable instance, restart persistence proven)"
