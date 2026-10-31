# ADR 0004 — Garage single-node topology for Swarm staging/production

- **Status:** Proposed (this PR implements it; production use stays gated on
  labeled-node provisioning, secrets, backup drill, and review)
- **Date:** 2026-10-31
- **Scope:** Dokploy Swarm object storage for FeastJourney; local Compose unchanged

## Context

Food Discovery dish photography is implemented and live against local Garage
(`DishMediaStorage` S3 adapter + Postgres `dish_media` + same-origin delivery).
The Swarm stack (`docker-compose.swarm.yml`, rendered immutable by CI) has no
object store: the app would start without S3 and every upload/serve would fail
with `DishMediaStorageMisconfigured`. Restaurant Discovery will reuse the same
store later, so the store must land independently and first.

Dokploy `raw` stacks deploy without a repo checkout, so a `./infra/garage.toml`
bind mount cannot exist on the host. Production secrets must never enter the
image, restarts must preserve objects, the S3 API must stay internal-only,
and the app must hold only a least-privilege key.

## Decision

1. **Single-node Garage v2.5.0 on Swarm** (same pin as local,
   `dxflrs/garage:v2.5.0`), replication_factor 1, no HA. This is a deliberate
   durability tradeoff: one labeled durable-storage node holds both volumes;
   safety comes from daily encrypted off-host backups + quarterly tested
   restores, not from replication.
2. **Immutable config-baked image** (`infra/Dockerfile.garage`:
   `FROM dxflrs/garage:v2.5.0` + `COPY infra/garage.swarm.toml
   /etc/garage.toml`). No secrets in the image. Built/pushed by the existing
   `release.yml` matrix as `feastjourney-garage:sha-<SHA>` (rollback: any prior
   immutable tag, never `latest`). The rendered stack pins app + migrator +
   garage to one release SHA.
3. **Swarm service** (`garage` in `docker-compose.swarm.yml`):
   `--single-node --default-bucket`, `infra` overlay only,
   `expose: ["3900"]` with no `ports`, loopback RPC, no website/admin HTTP,
   `garage_meta` + `garage_data` persistent volumes, `status` healthcheck,
   `replicas: 1` pinned to `node.labels.feastjourney-storage == true`
   (fails closed when the label/volume is missing), `stop-first` updates.
   Internal endpoint fixed at `http://garage:3900`.
4. **Credential separation**: Garage service holds `GARAGE_RPC_SECRET` +
   `GARAGE_BOOTSTRAP_*` (bucket creation/admin only); the app holds only
   `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (least-privilege
   `feastjourney-app` key, `--read --write`, never `--owner`) provisioned by
   `infra/scripts/garage-provision.sh` (idempotent; rotation via `--rotate`).
   Existing keys/buckets/objects are never silently replaced on redeploy.
5. **One private bucket** (`feastjourney-private`, `S3_BUCKET_PRIVATE` /
   `S3_BUCKET_MEDIA` both default to it) with the existing
   `dish-media/dishes/{dishId}/{mediaId}/{version}/{width}.webp` layout.
   Public delivery stays the same-origin `/api/v1/dish-images` route; the
   bucket never becomes publicly readable.
6. **Backup/restore as code** (`garage-backup.sh` quiesced both-volume
   encrypted bundles, daily + 7/4 retention, off-host copy required;
   `garage-restore.sh --test` disposable drill + explicit-`YES` destructive
   restore). A restore that has not been drilled to disposable storage is not
   claimed to work.

## Alternatives considered

- **Managed S3 (R2/B2/S3)**: less ops, real durability/HA, but a separate
  service/cost/egress decision with its own review. Rejected for now to keep
  a first-party store with no new vendor; revisit when single-node limits
  bind (size, availability, or multi-node need).
- **Garage multi-node on Swarm**: real replication, but needs ≥3 durable
  nodes, layout orchestration, and operator capacity that does not exist yet.
  Rejected as premature; the placement constraint + backups are the bridge.
- **MinIO on Swarm**: familiar S3, but the repo already replaced MinIO with
  Garage locally (ADR 0003) and MinIO's licensing/ops story is no better for
  a single node. Rejected to avoid a second store.
- **Bind-mounted TOML on Swarm**: would reuse `infra/garage.toml` directly,
  but Dokploy raw stacks have no host checkout — the deploy would fail or,
  worse, start with a default config. Rejected; baking is the robust delivery.
- **Public bucket + CDN for images**: simpler delivery, but dish photos carry
  license/attribution/review gates and withdrawal must revoke delivery.
  Rejected; same-origin gating stays authoritative.

## Consequences

- Staging auto-deploys from `main` now include Garage; the deploy stays RED
  until the operator provisions the labeled node, volumes, and Dokploy
  secrets (fail-closed by `:?` + placement constraint). No silent partial init.
- Durability = backups. Until a quarterly `--test` restore passes on the
  target environment, production readiness is UNVERIFIED by definition.
- Upgrades pin Garage per release; test-restore on the new image first.
- Rollback = prior immutable stack tag; volumes/objects untouched.

## Migration and rollback

No data migration (new store; local data stays local). Rollback redeploys the
prior `:sha-<SHA>` stack; never deletes volumes, never `repair`/`clean`.
Forward-fix DDL per the migration runbook.

## Unresolved questions

- Multi-node Garage or managed S3 once single-node size/availability binds.
- Off-host backup destination + RPO/RTO numbers after the first staging drill.
- Cloudflare edge caching + purge policy for dish images behind a production origin.
