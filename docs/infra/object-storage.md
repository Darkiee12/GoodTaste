# Object storage contract — MinIO local, S3 interface everywhere

## Decision status
MinIO is selected for the **local development experience**, not automatically for production. The original community repo was archived April 25, 2026 and community binaries/Docker publication was discontinued. The optional legacy image in `infra/.env.example` exists to support local experiments **only**. Do not publicly expose it or assume security updates. Production provider requires review (see ADR 0003).

## Bucket design
- `goodtaste-private`: private menu uploads, user review drafts, extracted/debug assets if justified.
- Public images: **not in scope** until consent/moderation/rights and delivery strategy are implemented.
- Key strategy: `menu/{session-id}/{opaque-uuid}` and `review/{session-id}/{opaque-uuid}`; opaque IDs prevent filenames/PII in keys.
- Postgres `Asset` row stores owner, purpose, key, bucket, MIME, size, checksum, retention timestamps; do not store direct permanent object URLs.

## Upload lifecycle
1. Server validates session/intent, file category, MIME extension allowlist, size/quota and throttling.
2. Server allocates opaque object key and short-lived signed PUT (or server-streamed upload if runtime/provider constraints require).
3. Browser uploads over correctly configured **publicly reachable** S3 hostname; internal Docker `minio:9000` cannot be used by the browser.
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

## MinIO risk and portability
- Never use the legacy local image for production without a documented risk acceptance and security assessment.
- Keep SDK interactions within `AssetStore` interface (PUT/presign/HEAD/GET/DELETE as needed) and run a compatibility smoke suite before switching provider.
- Consider a maintained managed S3 service, Garage, or RustFS after explicit compatibility/security review; compatibility is not guaranteed.
