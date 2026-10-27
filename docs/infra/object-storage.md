# Object storage — Garage local, S3 interface everywhere

## Decision status
Garage replaces MinIO for **local development**, using the upstream `dxflrs/garage:v2.5.0` image. See [ADR 0003](../decisions/0003-garage-local-s3.md). Its single-node configuration has no redundancy and is not a production topology. There is no application storage implementation yet.

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
docker compose --env-file infra/.env -f infra/compose.yaml exec -T garage /garage bucket info goodtaste-private
```

Garage initializes its single-node layout and the private `goodtaste-private` bucket at startup. Only the configured local S3 key receives access. Metadata and blobs persist separately in `garage_meta` and `garage_data`. Keep both volumes. RPC is container-loopback only; website and HTTP administration listeners are disabled. No host ports are published.

Future network-local S3 clients use `http://garage:3900`, region `garage`, bucket `goodtaste-private`, Signature V4, and path-style addressing. The local bootstrap key is bucket-owner scoped; a production app needs a separate least-privilege key. Garage uses its own per-key bucket grants, not AWS bucket policies or object ACLs.

The host-run landing page does not need an S3 connection. Host clients and browser uploads need a separately reviewed loopback mapping or reverse proxy; do not use Docker DNS names in browser URLs.

## Bucket design
- `goodtaste-private`: private menu uploads, user review drafts, extracted/debug assets if justified.
- Public images: **not in scope** until consent/moderation/rights and delivery strategy are implemented.
- Key strategy: `menu/{session-id}/{opaque-uuid}` and `review/{session-id}/{opaque-uuid}`; opaque IDs prevent filenames/PII in keys.
- Postgres `Asset` row stores owner, purpose, key, bucket, MIME, size, checksum, retention timestamps; do not store direct permanent object URLs.

## Upload lifecycle
1. Server validates session/intent, file category, MIME extension allowlist, size/quota and throttling.
2. Server allocates opaque object key and short-lived signed PUT (or server-streamed upload if runtime/provider constraints require).
3. Browser uploads over a correctly configured **browser-reachable** S3 hostname; internal Docker `garage:3900` cannot be used by the browser.
4. Backend verifies object exists, declared MIME/size/checksum when possible; marks `uploaded` → `ready` or `rejected`.
5. AI analysis references an authorized asset; read/download via short-lived signed GET or server stream.
6. Expiration/deletion removes metadata access then binary, with tracked retry for failures/orphans.

## Content handling
- Initially permit JPEG, PNG and WebP; verify actual file signature and decoded dimensions, not only `Content-Type`.
- Apply strict byte/pixel count limits; sanitize metadata/EXIF as needed; reject SVG/HTML/executable formats.
- Retain original images only as long as needed; choose a concrete short default at implementation and expose it in privacy notice.
- No public ACLs, public buckets or wildcard write CORS. CORS exact origin/method/header for upload; signed URLs expire quickly.

## Runtime configuration contracts
- App service endpoint: `S3_ENDPOINT_INTERNAL`, credentials, region, bucket, path-style compatibility.
- Signed browser URL endpoint: `S3_ENDPOINT_PUBLIC` (its hostname and scheme must be resolvable from a browser). Avoid signing for an internal hostname then string-rewriting URL signatures.
- Configure same bucket/region and endpoint addressing consistently across upload and access operations.

## Deletions and tests
- Unit: key ownership checks, type/size validation, expiry logic.
- Integration: upload → confirm → signed read → delete → no access, with distinct sessions.
- Failure injection: object uploaded but DB write fails; DB row exists but object missing; expired signed URL; invalid image.

## Existing MinIO data and rollback

The configuration change does not migrate objects. Never point Garage at a MinIO data directory: their on-disk formats differ. No MinIO volumes are deleted or repurposed. If another environment has existing uploads, preserve its old configuration, credentials, and data, pause writers, and copy through the two S3 endpoints with a reviewed tool such as `rclone copy`. Verify object counts, content, metadata, and access isolation before changing application endpoints. Avoid `sync --delete` or removing the source.

Garage does not support S3 object versioning or AWS bucket-policy APIs. Do not assume versions or policies can be copied; Garage bucket grants must be configured separately. Reissue presigned URLs against the new hostname/region rather than rewriting old signatures. Rollback restores the old service/endpoint while retaining both sets of data; writes made after cutover require reconciliation.

Keep future SDK interactions behind the server-only storage boundary. Before enabling uploads, manually verify PUT, HEAD, GET, presigned access, anonymous denial, CORS, and deletion of disposable objects. No tests or application features are added by this scaffold change.

## Verification

On 2026-10-27, `docker compose --env-file infra/.env.example -f infra/compose.yaml config --quiet` and `bun run check` passed. An isolated Garage v2.5.0 instance using temporary credentials and `/tmp` bind storage passed manual Signature V4 PUT, HEAD, GET, and presigned GET checks; unsigned GET returned 403. Restarting the instance preserved the object and access behavior. No host ports were published, existing services/volumes were untouched, and no MinIO data was copied. Browser CORS and the future application adapter remain unverified.

## Upstream references

- [Garage quick start and bootstrap flags](https://garagehq.deuxfleurs.fr/documentation/quick-start/)
- [Configuration and secret environment variables](https://garagehq.deuxfleurs.fr/documentation/reference-manual/configuration/)
- [S3 compatibility and permission differences](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/)
