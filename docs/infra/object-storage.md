# Private menu object storage

Garage is the local S3-compatible store, using `dxflrs/garage:v2.5.0`
([ADR 0003](../decisions/0003-garage-local-s3.md)). The local single-node topology
has no redundancy and is not a production deployment. PostgreSQL owns metadata,
ownership, state, checksums and retention; Garage holds private image bytes.

## Local setup

Keep existing `infra/.env` values. If the file does not exist, copy
`infra/.env.example`. Generate distinct local-only credentials and store them
only in the ignored environment file:

- `GARAGE_RPC_SECRET`: 32 random bytes encoded as 64 hex characters.
- `S3_ACCESS_KEY_ID`: `GK` followed by a fresh 32-character hex value.
- `S3_SECRET_ACCESS_KEY`: another independent 64-character hex value.

Do not regenerate credentials as an ad hoc rotation: persisted Garage keys need
explicit administration. Never print secrets or expanded Compose configuration.

```sh
docker compose --env-file infra/.env -f infra/compose.yaml config --quiet
docker compose --env-file infra/.env -f infra/compose.yaml up -d --wait garage
docker compose --env-file infra/.env -f infra/compose.yaml exec -T garage /garage status
docker compose --env-file infra/.env -f infra/compose.yaml exec -T garage /garage bucket info feastjourney-private
```

Startup initializes the single-node layout, private `feastjourney-private`
bucket and configured local key. Preserve both `garage_meta` and `garage_data`
volumes. The base Compose file publishes no ports; RPC is loopback-only and
website/HTTP administration listeners are disabled.

An app inside Compose uses `S3_ENDPOINT_INTERNAL=http://garage:3900`,
`S3_REGION=garage` and `S3_BUCKET_PRIVATE=feastjourney-private`, with Signature V4
and path-style addressing. Host-run apps/tests can use the explicit local
`infra/compose.ports.yaml` overlay, which maps S3 to `127.0.0.1:3900`. Set their
internal endpoint accordingly. Do not expose storage or administration publicly.

The local bootstrap key is bucket-owner scoped. Production must use a separate
least-privilege application key for the private bucket and a maintained,
backed-up storage topology. Garage uses per-key bucket grants, not AWS object
ACLs or bucket policies; no public ACL or website endpoint is enabled.

## Implemented upload and read path

`src/server/integrations/private-menu-storage.ts` is server-only. Its Effect Layer
owns a lazily initialized S3 client and releases connections at shutdown.
Unrelated discovery does not depend on configured storage. Credentials and opaque
object keys never become browser application data.

1. The browser posts a photograph through the same-origin `/api/menu-scans`
   endpoint. The server checks the request origin, rate budget, verified member
   or guest capability and scan ownership.
2. Request bytes are bounded before form allocation. JPEG, PNG and WebP signatures
   must match the declared type; Sharp decodes with a 20-megapixel limit and
   rejects images over 12,000 pixels per dimension or animated/multipage files.
   At most six pages, 8 MiB each and 24 MiB total are accepted.
3. Orientation is applied and the image is re-encoded as JPEG without EXIF or
   trailing payloads. The server reserves `menu/{scan-id}/{opaque-uuid}` metadata
   before writing the object.
4. A bounded read-back verifies byte count and SHA-256 before the asset becomes
   ready. Failure/interruption attempts removal; the committed reservation tracks
   any cleanup still required.
5. Owners and authorized reviewers read photos through authenticated same-origin
   GET requests using scan/contribution and asset IDs. Responses are private,
   no-store and never expose the object key. Muse receives authorized server-read
   inline bytes; no public photo URL or provider file upload is needed.

This path uses no presigned URL and requires no browser-visible S3 hostname or
S3 CORS. `S3_ENDPOINT_PUBLIC` is not consumed. Do not sign an internal hostname
then rewrite it; direct signed browser upload would require a separate reviewed
contract. Browsers never need Docker DNS names.

Promotion reuses registered scan assets rather than making untracked
`evidence/` copies. Approval does not publish photographs. Relational source and
menu provenance records identify the supporting pages, while their private bytes
retain the customer's consented lifecycle.

## Retention and deletion

Personal scans expire after 24 hours. Optional `menu-facts-v1` contribution
consent allows up to 30 days for private photographs and draft JSON, including
approved submissions. Reviewed relational facts and minimal attribution/audit
metadata may remain after private data erasure; a prior revision number is not
a permanent copy of its JSON. The provider's independent retention is described
in the [scanner contract](../architecture/restaurant-discovery.md).

Expired/deleted sessions immediately lose customer/reviewer access. Physical
erasure is eventual: operators must schedule `bun run maintenance:menu-scans`,
normally every 15 minutes, outside web request traffic. The CLI needs the
application database and private storage settings, not OAuth/email credentials.
It does not install its own timer.

Each run handles at most 100 expired sessions and 100 eligible assets, with
four concurrent removals. A two-minute upload grace prevents deletion racing an
active upload; unconfirmed abandoned uploads become eligible after five minutes.
Storage failures increment tracked attempts and defer retry for 15 minutes,
without an infinite same-run retry loop. Only after all registered assets are
deleted does a session clear its current revision and erase private draft JSON.
Contribution metadata keeps the submitted revision number with a NULL draft
reference. A failed removal keeps metadata for retry. Monitor reports and a
nonzero exit status; do not promise immediate complete deletion during an outage.

## Verification

Use synthetic images and a proven disposable bucket/namespace. Tests should
cover upload confirmation, decoded limits, forged MIME, missing objects,
cross-session denial, cancellation, post-upload database failure, bounded
deletion failure/retry and expired draft erasure. PostgreSQL/Garage integration
is distinct from mocked provider tests and from browser evidence; consult
[database testing](../development/database-testing.md) for commands and report
the current run's outcomes rather than historical scaffold results.

Historical 2026-10-27 smoke tests covered Signature V4 PUT/HEAD/GET, signed GET,
anonymous denial and restart persistence. Those results do not verify the
current application adapter, browser journeys or a production deployment.

## Existing data and rollback

Garage cannot reuse MinIO's on-disk format. Never delete or repurpose existing
volumes to recover an error. A migration from another store requires a reviewed
copy through S3 endpoints, verified content/access and reconciliation of writes
before rollback. Garage does not offer S3 versioning or AWS bucket-policy APIs.

Rollback the application only while its schema remains compatible. Do not use
Flyway clean/repair or object deletion as a rollback shortcut. Future direct
signed access would need its own endpoint, expiry and authorization validation.

[Garage quick start](https://garagehq.deuxfleurs.fr/documentation/quick-start/),
[configuration](https://garagehq.deuxfleurs.fr/documentation/reference-manual/configuration/)
and [S3 compatibility](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/)
describe the supported provider behavior.
