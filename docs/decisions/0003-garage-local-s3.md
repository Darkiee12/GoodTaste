# ADR 0003 — Garage for local S3 storage

- **Status:** Accepted for local development, at the user's request
- **Date:** 2026-10-27
- **Scope:** Local Compose object store; production topology remains undecided

## Decision

Replace the MinIO service with Garage, using `dxflrs/garage:v2.5.0` and a checked-in, secret-free TOML configuration. A single-node layout and private bucket are bootstrapped with environment credentials. Keep metadata and blobs on separate persistent volumes. Publish no host ports; disable website/HTTP administration endpoints. Preserve the provider-neutral S3 boundary and PostgreSQL metadata ownership.

## Alternatives and consequences

Keeping MinIO would preserve its tooling but retain the legacy sample dependency. Managed S3 is a production option with separate service/cost decisions. Garage is the requested Rust-based self-hosted option. Its per-key bucket grants differ from AWS policies/ACLs, and it has no S3 object versioning. Future clients must verify the subset they use; use Signature V4 and path-style requests locally.

## Migration and rollback

This is an infrastructure scaffold change, not a data conversion. Garage cannot reuse MinIO's disk format. Preserve old volumes and copy through S3 if existing objects need migration. Verify content and access before cutover; reconcile new writes before rollback. The single-node local setup has no redundancy and is not approved as a production deployment.

See [object storage setup and migration](../infra/object-storage.md).
