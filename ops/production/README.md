# Production backup contracts

This directory contains production operation sources. Production currently runs
`v0.7.7/schema42`; PR #155, branch/main Quality, immutable tag/Release,
exact-tag build, locked-exact backup/restore, switch and rollback-forward all
passed. The v0.7.7 release authorization is consumed. Its ordered post-deploy
refresh gate did not pass: the server Canvas produced four redundant successful
PUTs that changed only three image-card heights. There was no 409, false task
read warning or generation submission during refresh, but the required zero-save
condition failed, so group `group-17ee0cbc-cc81-4b35-9c5e-41040f627033` was not
clicked and no real workflow was executed. The root cause is the image preview
hydration path rewriting persisted style dimensions after load. There is no
authorized next-version candidate; code repair, release and real execution need
new authorization. Current evidence is recorded in
`spec/V0_7_7_PRODUCTION_RECEIPT_2026-09-03.json`; candidate and v0.7.6 receipts
are historical evidence only.

## Current schema42 production contract

`backup-to-oss-retention.mjs` calls the signed, encrypted
`scripts/backup-data.mjs` contract. It requires explicit absolute source,
backup, scratch, key, profile, schema, logical-SHA, freeze, and last-admission
arguments. Schema must be exactly 42. With no `--apply-upload` it creates only
the local encrypted package and prints a dry-run inventory; it performs no OSS
write. `--apply-upload` is a separate production side effect and is not
authorized by this repository state. Retention deletion remains fail-closed
even with upload apply until an exact remote deletion manifest and a separate
reviewed operation exist.

The wrapper must remain at `ops/production/backup-to-oss-retention.mjs` inside
the complete immutable release tree; do not copy it into a standalone system
path. It resolves `scripts/backup-data.mjs` and
`server/secureStorageProfiles.ts` from that immutable module location and sets
the child WorkingDirectory to the same release root. The systemd unit may set
`WorkingDirectory` for readability, but correctness must not depend on it.
Unknown, missing, or duplicated options fail before a backup package or OSS
client can be created.

Before any future installation, freeze an immutable release and record:

- release commit/tree and wrapper SHA-256;
- installed absolute paths and owner/mode;
- exact schema42 database logical SHA and freeze evidence;
- signing trust anchor and recovery-key identities, never private key bytes;
- systemd service/timer unit hashes and the next scheduled time;
- backup, verify, fresh-restore, fake-OSS, and zero-egress receipts.

The consumed v0.7.7 release authorization and failed refresh gate are recorded
in the INC-GEN-026 Checkpoint. Every future release switch, timer installation,
and real OSS upload/delete/restore still requires separate user authorization.

## Historical schema39 artifact

`backup-data-schema39.mjs` is retained only to identify the 2026-08-15 legacy
plaintext format. It now exits immediately with
`HISTORICAL_SCHEMA39_BACKUP_DISABLED` and must not be installed as the current
timer source. Historical hashes and receipts remain historical evidence; they
do not authorize reuse against schema42.

The two protected JSON files named in `AGENTS.md` remain outside every backup
source, test snapshot, release inventory, and Git operation.
