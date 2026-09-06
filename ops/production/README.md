# Production backup contracts

Current snapshot: 2026-09-06, `v0.7.14/schema43`. See [current authority](../../spec/UNBOUNDRY_CURRENT_STATE.md) and [release receipt](../../spec/V0_7_14_PRODUCTION_RECEIPT_2026-09-06.json). This directory contains operation sources; their presence in a release does not mean the systemd timer uses them.

## Observed production state

- Application: active/running, PID839221, NRestarts0; current points to `/opt/unboundry/releases/v0.7.14-media-aspect-20260906`.
- Daily timer: active, next scheduled 2026-09-07 03:30 CST at the observation time. Service: failed, exit1; last start 2026-09-06 03:30:01 CST.
- Installed ExecStart still invokes `/opt/unboundry/scripts/backup-to-oss.mjs`, which invokes the old standalone `backup-data.mjs`. Its validation requires schema41; production is schema43. Journal reports `Backup database validation failed`.
- This release's separate manual encrypted backup succeeded: local verify and fresh restore plus remote PUT/GET hash verification, 1004 files, 1,939,771,911 bytes. This does not repair or validate the daily job.

The daily job needs a separately implemented and verified current-schema freeze/backup/restore/upload pipeline and an exact installed-unit receipt. Merely replacing a path or schema constant does not supply dynamic freeze and logical-SHA evidence. No installation, restart, cleanup or new backup was performed by the documentation update.

## Current wrapper contract

`backup-to-oss-retention.mjs` resolves `scripts/backup-data.mjs` and `server/secureStorageProfiles.ts` from its own immutable release root. Keep it in `ops/production/` within the complete release; do not copy it to a standalone `/opt/unboundry/scripts` path.

Required arguments explicitly identify source, backup root, scratch root, signing-private-key and recovery-public-key paths, storage profile, schema, database logical SHA, generation freeze and last Provider admission. Schema43 is current/final; schema42 is historical recovery. Unknown/missing/duplicate arguments fail closed. Media warnings and OSS mirrors are explicit repeatable arguments.

Without `--apply-upload`, it creates a local encrypted package and reports an upload inventory; this is not a zero-write dry-run of the local filesystem. It reads the selected source's encrypted storage profile, never an inherited unrelated data directory. With upload authorization, `--apply-upload` writes private no-overwrite objects and a manifest. The wrapper does not itself run separate verify/fresh-restore or GET content verification; the operation must supply these gates. Retention deletion is blocked pending an exact reviewed remote deletion manifest; this is not an active automatic deletion policy.

## Installation and recovery evidence

Before installing or changing a job, record immutable release commit/tree, wrapper and unit hashes, owner/mode, current-schema freeze/SHA evidence, key identities without key bytes, verify/fresh-restore result, upload/GET verification and timer next-run. Use isolated synthetic/fake tests first. Do not replace CURRENT with a backup or rewrite historical task/attempt records to satisfy quiet gates.

The v0.7.14 package is `/var/lib/unboundry-v0714-media-aspect-20260906/backup43/1779934b-9d23-4a9d-849d-531f21d678b7.ubbackup`. Verification retained 98 historical nonblocking media warnings; do not claim every historic asset is intact. The detailed completed cloud receipt remains `/var/lib/unboundry-v0714-media-aspect-20260906/evidence/oss-backup-upload.json`.

## Historical tools and authorization

`backup-data-schema39.mjs` is retained only as historical format evidence and exits with `HISTORICAL_SCHEMA39_BACKUP_DISABLED`. Repository `scripts/backup-to-oss.mjs` and `mirror-oss-to-local.mjs` are also frozen stubs; they are not the installed old server bytes.

Future production changes, real OSS upload/delete/restore and paid generation follow the user's actual authorization. This README and consumed old release permissions do not authorize them. Both permanently protected JSON paths in AGENTS remain excluded from all snapshots, inventories and Git operations.
