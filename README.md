# GoodTaste

AI-assisted local-food discovery for travellers. This archive provides an **agent-first foundation** and **local infrastructure blueprint**, not a finished application.

Start with `AGENTS.md`, then `docs/README.md`. The application source tree will be generated after the architecture/infra baseline is approved.

**Initial choices:** TanStack Start + Effect modular monolith, PostgreSQL, S3-compatible object storage (MinIO local-only), Bun candidate runtime.

**Important:** MinIO community source was archived in April 2026. The example local MinIO image is legacy/unmaintained; it is not a production recommendation. Review `docs/infra/object-storage.md` and ADR 0003 before deployment.

**Local infrastructure:** copy `infra/.env.example` to `infra/.env`, customize secrets, then run `docker compose --env-file infra/.env -f infra/compose.yaml config` before starting services. See `docs/infra/operations.md`.

Source references are collected in `docs/references.md`.
