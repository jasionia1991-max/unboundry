# Production backup contracts

This directory contains source candidates. Production currently runs
`v0.7.3/schema42`; that release authorization has been consumed. The current
authorized candidate is ordinary patch `v0.7.4`, covering exact dynamic-role
workflow admission, admission database reuse, transient server-node activity
projection, no-resubmit reconciliation after an uncertain create response,
and definitive settlement for missing/unreadable trusted-media metadata. Both
CI and the exact production release must prove `ffprobe` is executable before
workflow generation is admitted.
Backup, install, switch and rollback-forward may run only after the frozen
candidate Review, PR/head and main Quality, immutable tag, Release, and exact-tag
fresh build are complete. After v0.7.4 is live and technically healthy, the
authorized post-deploy check is exactly one execution of Canvas
`adcb89a5-c1f4-47e4-bbbb-28fff8d81583`, group
`group-17ee0cbc-cc81-4b35-9c5e-41040f627033`; an unknown outcome permits only
read-only reconciliation, never a second POST. Candidate evidence is recorded
in `spec/V0_7_4_RELEASE_CANDIDATE_RECEIPT_2026-09-03.json`.

## Current schema42 candidate

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

The current one-time release switching authorization is recorded in the
INC-GEN-026 Checkpoint. Timer installation and real OSS upload/delete/restore
still require separate user authorization.

## Historical schema39 artifact

`backup-data-schema39.mjs` is retained only to identify the 2026-08-15 legacy
plaintext format. It now exits immediately with
`HISTORICAL_SCHEMA39_BACKUP_DISABLED` and must not be installed as the current
timer source. Historical hashes and receipts remain historical evidence; they
do not authorize reuse against schema42.

The two protected JSON files named in `AGENTS.md` remain outside every backup
source, test snapshot, release inventory, and Git operation.
