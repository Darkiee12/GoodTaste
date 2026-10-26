# Configuration and secrets

## Local Docker Compose config (`infra/.env`)
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_IMAGE`. Example defaults are **development only** and must be replaced.

## Proposed application variables (to validate after scaffold)
- `DATABASE_URL` (server-only)
- `S3_ENDPOINT_INTERNAL` (server-only internal API endpoint)
- `S3_ENDPOINT_PUBLIC` (browser-resolvable host used for signed URLs)
- `S3_REGION`, `S3_BUCKET_PRIVATE`
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `AI_PROVIDER`, `AI_API_KEY`, `PLACES_API_KEY`
- `APP_BASE_URL`, optional `LOG_LEVEL`

## Process rules
- Validate runtime config during server startup and fail early on absent critical settings.
- Client-exposed vars must be explicitly allowlisted, never inferred from `process.env` broadly.
- Use different credentials for storage root/admin vs application bucket-access account in production; create least-privilege app credentials during infra provisioning.
- Secrets go into secure deployment secret storage. Do not print env values in logs/CI output or commit generated configs.
- `.env.example` contains examples only; `.env` and `*.local` are ignored.
