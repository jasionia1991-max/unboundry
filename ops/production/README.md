# Production backup hotfixes

These are the exact, secret-free scripts deployed on 2026-08-15 after the
production database reached schema 39.

- `backup-data-schema39.mjs` is installed as
  `/opt/unboundry/scripts/backup-data.mjs` and must have SHA-256
  `e50ac515051b63e85dd9fb11f18632fcd28bf137dcc73f3c37a0d247366970c5`.
- `backup-to-oss-retention.mjs` is installed as
  `/opt/unboundry/scripts/backup-to-oss.mjs` and must have SHA-256
  `05721427c867424f846f1c1b4f2f6aa10825bc3225ec2493997a8f9f27b7b95f`.

The first script uses SQLite's online backup API and validates schema 39,
integrity, foreign keys, media, and secrets without invoking the migration
entrypoint. The second uploads the resulting inventory to OSS and enforces the
30-day retention policy from locally signed backup manifests. It does not need
`ListObjects`; the production RAM identity permits `PutObject`, `GetObject`,
and `DeleteObject` but rejects bucket listing.

Before installation, verify both hashes, preserve the active scripts in a
root-only history directory, install these files as `ubuntu:ubuntu` mode 0400,
and run one complete `unboundry-backup.service` job. Never copy credentials into
this directory or the repository.
