# Object storage — Garage single-node, S3 interface everywhere

## Decision status
Garage v2.5.0 is the first-party S3-compatible store for local development
**and** Swarm staging/production. See [ADR 0003](../decisions/0003-garage-local-s3.md)
(local) and [ADR 0004](../decisions/0004-garage-swarm.md) (Swarm single-node
topology). The single-node layout has no redundancy by design; durability
comes from the backup/restore procedure below, not from replication.

The Food Discovery dish-photo pipeline is the first live consumer:
`src/modules/food-discovery/server/operations/dish-media-service.ts`
(Sharp validation + WebP derivatives + `DishMediaStorage` S3 adapter) with
Postgres `dish_media` metadata and same-origin delivery at
`GET /api/v1/dish-images/{mediaId}/{version}/{width}`. There is no generic
`Asset` table and no browser-direct S3 upload: all bytes flow server-side.

## Architecture

```text
App (Effect DishMediaStorage, S3Client path-style)
  │  S3_ENDPOINT_INTERNAL=http://garage:3900 (infra overlay only)
  ▼
Garage v2.5.0 single-node (replication_factor=1)
  ├─ meta volume  garage_meta  -> /var/lib/garage/meta  (sqlite)
  └─ data volume  garage_data  -> /var/lib/garage/data  (blocks)
Postgres dish_media owns metadata/permissions; Garage owns bytes only.
```

- Local: upstream `dxflrs/garage:v2.5.0` via `infra/compose.yaml` with a
  bind-mounted `infra/garage.toml`. Command
  `["/garage", "server", "--single-node", "--default-bucket"]`.
- Swarm: immutable `feastjourney-garage:<sha>` built from
  `infra/Dockerfile.garage` (bakes `infra/garage.swarm.toml`, no secrets).
  Dokploy `raw` stacks have no repo checkout, so a bind mount would fail
  closed on the host — the baked image is the delivery mechanism.
  Pinned by CI (`release.yml` matrix) and referenced in
  `docker-compose.swarm.yml` as
  `${GHCR_IMAGE_PREFIX}/feastjourney-garage:${VERSION}` (never `latest`).
- Network: `infra` overlay only (`internal:true`). No `ports`, only
  `expose: ["3900"]`. RPC (`127.0.0.1:3901`), website, and admin HTTP
  listeners stay disabled/loopback. The app reaches Garage at
  `http://garage:3900`; browsers never do.
- Placement: Swarm pins Garage to the single labeled durable-storage node
  (`node.labels.feastjourney-storage == true`, replicas: 1). Both volumes are
  node-local `local` driver. Rescheduling elsewhere with empty volumes would
  start an empty store, so the constraint fails closed instead. Label the node
  once per Swarm: `docker node update --label-add feastjourney-storage=true <node>`.
  Losing that node without a tested backup loses objects (see below).

## Local setup

Copy `infra/.env.example` to `infra/.env` only if you do not already have that file. Keep existing PostgreSQL settings. Replace the Garage placeholders with independently generated local secrets:

- `GARAGE_RPC_SECRET`: generate 32 bytes as 64 hex characters (`openssl rand -hex 32`).
- `S3_ACCESS_KEY_ID`: `GK` followed by a new 32-character hex value (`openssl rand -hex 16`).
- `S3_SECRET_ACCESS_KEY`: another independent 64-character hex value (`openssl rand -hex 32`).

Save values only in the ignored `infra/.env`; do not paste them into logs or commit them. On an existing MinIO setup, add these variables and remove unused `MINIO_*` settings. Do not rerun credential generation as a rotation procedure: persisted keys need explicit Garage administration.

```bash
docker compose --env-file infra/.env -f infra/compose.yaml config --quiet
docker compose --env-file infra/.env -f infra/compose.yaml up -d --wait garage
docker compose --env-file infra/.env -f infra/compose.yaml exec -T garage /garage status
docker compose --env-file infra/.env -f infra/compose.yaml exec -T garage /garage bucket info feastjourney-private
```

Garage initializes its single-node layout and the private `feastjourney-private` bucket at startup. Only the configured local S3 key receives access. Metadata and blobs persist separately in `garage_meta` and `garage_data`. Keep both volumes. RPC is container-loopback only; website and HTTP administration listeners are disabled. No host ports are published.

Network-local S3 clients use `http://garage:3900`, region `garage`, bucket `feastjourney-private`, Signature V4, and path-style addressing. The local bootstrap key is bucket-owner scoped; a production app needs a separate least-privilege key. Garage uses its own per-key bucket grants, not AWS bucket policies or object ACLs.

The host-run landing page does not need an S3 connection. Host clients and browser uploads need a separately reviewed loopback mapping or reverse proxy; do not use Docker DNS names in browser URLs.

## Swarm configuration

`docker-compose.swarm.yml` (template; CI renders immutable SHAs):

- `garage` service: baked image, `--single-node --default-bucket`, env
  `GARAGE_RPC_SECRET`, `GARAGE_BOOTSTRAP_ACCESS_KEY`,
  `GARAGE_BOOTSTRAP_SECRET_KEY` (all `:?` fail-fast), `GARAGE_DEFAULT_BUCKET`
  (`${S3_BUCKET_PRIVATE:-feastjourney-private}`), volumes
  `garage_meta` + `garage_data`, `status` healthcheck, `stop-first`
  updates, `infra` network only, placement constraint above.
- `app` service additions (all server-side, never `VITE_*`):
  `S3_ENDPOINT_INTERNAL=http://garage:3900` (fixed internal DNS),
  `S3_REGION`, `S3_BUCKET_PRIVATE`, `S3_BUCKET_MEDIA` (both default
  `feastjourney-private`; keep identical unless a real isolation requirement
  lands), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (`:?` fail-fast).
- Missing storage prerequisites fail the deploy fast (unsubstituted `:?`
  variables, absent label, or missing volumes block rollout) instead of
  starting a partially initialized store.

Production values live only in Dokploy stack secrets (see
`infra/.env.production.example`): `GARAGE_*` bootstrap/admin for the Garage
service, `S3_*` least-privilege app key for the app service. Real values are
never in git, logs, or chat.

## Bucket design
- `feastjourney-private`: the single private bucket for dish media today.
  Do not create a bucket per feature without an actual isolation requirement.
- Object layout (immutable per version, set by `dishMediaKeyBase`):
  `dish-media/dishes/{dishId}/{mediaId}/{version}/{width}.webp`
  (400/800/1600 WebP ~q80; originals never stored). Postgres `dish_media`
  holds only metadata (dims, format, checksum, license, attribution,
  review/publish timestamps); never store direct permanent object URLs.
- Public images are served ONLY through the same-origin app route below.
  The bucket stays private; there are no public ACLs, public buckets, or
  wildcard write CORS. Signed browser upload URLs are not used.

## Credentials and permissions

Two separated identities (never share):

1. **Bootstrap/admin** (`GARAGE_BOOTSTRAP_ACCESS_KEY` /
   `GARAGE_BOOTSTRAP_SECRET_KEY` + `GARAGE_RPC_SECRET`): creates the bucket
   and the first key via `--default-bucket` at first start. Lives only in the
   Garage service env + an offline sealed copy. Changing it after bootstrap
   does NOT rotate the cluster; follow the rotation runbook.
2. **App least-privilege** (`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`):
   a `feastjourney-app` key granted ONLY `--read --write` (never `--owner`)
   on `feastjourney-private` via `infra/scripts/garage-provision.sh`. Lives
   only in the app service env (Dokploy secrets). The app never sees the RPC
   secret or bootstrap keys; nothing S3 enters browser bundles, public API
   responses, or logs.

Provisioning is explicit and idempotent (safe to re-run; existing buckets,
keys, and objects are kept; missing pieces are created; failures name the
bad credential):

```bash
# After first Garage deploy, from a shell able to docker exec the task:
APP_KEY_NAME=feastjourney-app S3_BUCKET_PRIVATE=feastjourney-private \
  ./infra/scripts/garage-provision.sh
# Store the printed-once app ID/secret in Dokploy S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY.
```

Rotation (never silent replacement on redeploy):

```bash
APP_KEY_NAME=feastjourney-app ./infra/scripts/garage-provision.sh --rotate
# Update Dokploy secrets, redeploy app, verify delivery, then deny/delete old key.
```

Garage has no S3 object versioning or AWS bucket-policy APIs; grants are
per-key (`bucket allow/deny`) and must be configured separately.

## Dish-photo upload lifecycle (implemented)

1. Authorized admin stages a photo (`food:import`): server validates session,
   JPEG/PNG/WebP signature + decoded dims (short side ≥ 600px, ≤ 24 MP,
   ≤ 8 MiB), license/attribution/alt-text shape, and the 5-per-dish cap.
2. Sharp renders 400/800/1600 WebP server-side (no upscale, EXIF-oriented).
3. `DishMediaStorage.putVariant` persists each derivative to the private
   bucket; Postgres inserts a `processing` row, then finalizes to `ready`
   with `object_key=dish-media/dishes/{dishId}/{mediaId}/1`. Storage failure
   marks the row `failed` and cleans partial objects (never silent).
4. `submitForReview` moves `draft → review`; `publishPhoto`
   (`food:publish`) requires ready bytes, real license, attribution, alt
   text, review state, and all three derivatives present, then sets
   `published`. `returnToDraft`/`removePhoto` revoke delivery (withdrawal
   first: the DB row goes first so nothing public resolves; object deletion
   is best-effort and never fails the withdrawal).
5. Delivery is same-origin streaming (no public bucket): see below.

## Image delivery

`GET /api/v1/dish-images/{mediaId}/{version}/{width}` serves published +
ready derivatives only (`image/webp`, `Cache-Control: public,
max-age=31536000, immutable`, ETag + 304). Drafts, review items, failed
processing, stale versions, and bad widths all resolve to 404 without
distinguishing, so private state cannot be probed. `?preview=1` serves ready
rows to a signed-in `food:read` member (`private, no-store`); it is never
linked from public responses. Eligibility (DB status/version) always runs
BEFORE the If-None-Match short-circuit, so a withdrawn image 404s at origin
even with a stale ETag. No per-request re-encode and one indexed row lookup
per cache miss. Place Cloudflare in front with edge caching when a production
origin exists; edge purge on withdrawal is an ops concern (origin is
authoritative).

## Persistent-volume ownership

Both `garage_meta` and `garage_data` must survive restarts/reschedules on the
same labeled node. Never use container-local ephemeral storage for objects.
Never `docker volume rm`, `clean`, or delete volumes as recovery. Either
volume lost alone is a full-store loss (meta without data and data without
meta are both unrestorable); always back up and restore the pair from the
same quiesced instant.

## Backups and disaster recovery (single-node, mandatory)

Assumption: one durable-storage node, no replication, RPO = last daily
backup, RTO = restore + verification time. Durability is the backup, not the
volume.

- **What**: both volumes together (`garage_backup.sh` scales Garage to 0,
  tars `meta`+`data` in one helper, encrypts AES-256-GCM with a 0600
  passphrase file, writes `$BACKUP_DIR/garage-<UTC>.tar.gz.enc` + `.sha256`).
- **Frequency/retention**: daily; keep 7 daily + 4 weekly (Sunday) locally;
  mirror the same rule off-host. A backup that stays on the same disk is NOT
  off-host: `scp`/`rclone` every bundle to another region immediately and
  verify sha256 at the destination.
- **Encryption**: OpenSSL `enc -aes-256-gcm -pbkdf2`; the passphrase file is
  separate from Garage/S3 secrets and stored sealed offline. Never log it.
- **Restore verification**: every bundle is proven by
  `garage-restore.sh --test <bundle>` (decrypt to temp, populate disposable
  volumes, run `garage-s3-check.mjs` PUT/HEAD/GET/DELETE + anon-denied
  against a disposable instance). Production restore
  (`garage-restore.sh <bundle>`, explicit `YES`) scales to 0, replaces BOTH
  volumes from one bundle, restarts, then verifies `status` + `bucket info` +
  dish-image delivery before closing the window. Quarterly drill minimum.
- **Disk exhaustion**: alert on volume usage; Garage needs free space for
  compaction/GC. Adding disk is a planned migration with backup first, never
  a live volume delete.
- **Container restarts**: safe (volumes persist; `--default-bucket` is
  idempotent and additive — new keys accumulate, existing data kept).
- **Host failure / volume loss**: total loss without backup. Recover by
  provisioning a replacement labeled node from the latest verified off-host
  bundle (RPO = backup age; writes since backup are lost; reconcile from
  Postgres `dish_media` + re-upload originals where available).
- **Credential recovery**: RPC secret + bootstrap keys from Dokploy + sealed
  copy. Losing the RPC secret without a copy requires a new cluster + restore
  (the secret cannot be derived from data). Losing an app key rotates via
  provision `--rotate` (objects survive).
- **Upgrade**: pin `dxflrs/garage` per release (today v2.5.0); test-restore
  the backup on the new image to disposable volumes first; roll forward on
  mismatch. Destructive `repair`/`clean`/reset is never an operational
  recovery method.

If a quarterly restore drill has not passed, report durability as
UNVERIFIED and do not claim production safety.

## Upload verification (operator, disposable objects only)

```bash
sh infra/scripts/garage-verify.sh
```

Proves: immutable image reference, no public S3 port, internal endpoint,
TOML validity with no embedded secrets, isolated PUT/HEAD/GET/DELETE with
the app's S3Client shape, anonymous + bogus denial, restart persistence, and
missing-credential failure. `tests/integration/garage-s3.test.ts` proves the
real `DishMediaStorage` adapter against disposable Garage; `tests/dish-media.test.ts`
proves pipeline rules with an in-memory store. Never run these against
production buckets or real photographs.

## Production readiness and limitations

- Single node: no HA, no failover, no replication. Planned Garage
  multi-node or a managed S3 service is the HA path (see ADR 0004).
- Garage subset: Signature V4 + path-style only; no versioning, no bucket
  policies, no object ACLs. The app already conforms (no presigned browser
  URLs, no ACL calls).
- Rollback (safe): redeploy the prior immutable `:sha-<SHA>` stack tag in
  Dokploy (app + migrator + garage tags move together); stored objects are
  untouched because rollback never deletes volumes. Forward-fix DDL per the
  migration runbook; `repair`/`clean`/volume deletion are never rollback
  steps.
- Destructive reset is never recovery. If durability cannot be demonstrated
  with a passing restore drill, the PR/deploy stays draft with the residual
  risk stated explicitly.

## Existing MinIO data and rollback

The configuration change does not migrate objects. Never point Garage at a MinIO data directory: their on-disk formats differ. No MinIO volumes are deleted or repurposed. If another environment has existing uploads, preserve its old configuration, credentials, and data, pause writers, and copy through the two S3 endpoints with a reviewed tool such as `rclone copy`. Verify object counts, content, metadata, and access isolation before changing application endpoints. Avoid `sync --delete` or removing the source.

Garage does not support S3 object versioning or AWS bucket-policy APIs. Do not assume versions or policies can be copied; Garage bucket grants must be configured separately. Reissue presigned URLs against the new hostname/region rather than rewriting old signatures. Rollback restores the old service/endpoint while retaining both sets of data; writes made after cutover require reconciliation.

Keep SDK interactions behind the server-only storage boundary. Before enabling uploads, manually verify PUT, HEAD, GET, presigned access, anonymous denial, CORS, and deletion of disposable objects.

## Verification

On 2026-10-27, `docker compose --env-file infra/.env.example -f infra/compose.yaml config --quiet` and `bun run check` passed. An isolated Garage v2.5.0 instance using temporary credentials and `/tmp` bind storage passed manual Signature V4 PUT, HEAD, GET, and presigned GET checks; unsigned GET returned 403. Restarting the instance preserved the object and access behavior. No host ports were published, existing services/volumes were untouched, and no MinIO data was copied. Browser CORS and the future application adapter remain unverified.

Swarm verification is owned by `infra/scripts/garage-verify.sh` + the
`garage` CI job (rendered-stack validation, isolated round-trip, restart
persistence, anon/bogus denial, missing-credential failure, and the
dish-photo adapter + pipeline tests). Record each run's output in the PR;
never claim a pass that was skipped.

## Upstream references

- [Garage quick start and bootstrap flags](https://garagehq.deuxfleurs.fr/documentation/quick-start/)
- [Configuration and secret environment variables](https://garagehq.deuxfleurs.fr/documentation/reference-manual/configuration/)
- [S3 compatibility and permission differences](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/)
