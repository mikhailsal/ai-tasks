# Operations

Run commands from the package directory with Node.js 24.22.0 and npm 11.19.1. See
[README](../README.md) for installation and the [normative contracts](../specs/001-ai-task-manager/contracts/common.md)
for exact payloads. Examples containing `CURRENT_*`, `NEW_UUID`, or `BACKUP_UUID` are shapes:
replace those strings with values from current responses, not literal request values.

## Paths, startup, and shutdown

| Setting               | Default                                                  | Meaning                                                           |
| --------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| `AI_TASKS_DB_PATH`    | `data/ai-tasks.sqlite` relative to the working directory | Local SQLite file                                                 |
| `AI_TASKS_BACKUP_DIR` | `backups` beside the database                            | Managed snapshots, manifests, operational receipts/jobs           |
| `AI_TASKS_PORT`       | `3000`                                                   | Loopback API port                                                 |
| `AI_TASKS_ORIGIN`     | `http://127.0.0.1:PORT`                                  | Exact allowed public browser origin and expected Host             |
| `AI_TASKS_DEV_ORIGIN` | unset                                                    | Additional exact browser origin, only with `NODE_ENV=development` |

Use stable absolute paths in service configuration. Migration and ordinary access verify
the connection's lifetime lock; API/CLI reads do not auto-migrate. On a fresh database run
`npm run db:migrate`, then `npm run build`, then `npm start`. Retain `dist/`, `web/dist/`,
`drizzle/`, package metadata, and the installed native dependencies together when deploying.
The worker entry is `node dist/cli.js worker run --project SLUG --json`, not `worker.js`.

Production binds to `127.0.0.1`; open the exact configured origin. For development, use
`npm run dev` and `http://127.0.0.1:5173`. Its proxy targets API port 3000. The script enables
that exact development origin; an arbitrary Origin or `localhost` alias is not equivalent.
The production service worker is built by `npm run build`, not provided by Vite development.

Use SIGINT/SIGTERM for normal shutdown. A supervised restore drains accepted requests and
workers, closes ordinary connections, and then acquires the exclusive lock in an isolated
helper. The HTTP owner remains database-free during replacement. A standalone `--no-wait`
restore has its own durable owner; exiting the requesting CLI does not cancel accepted work.
A force-killed process may require startup recovery. Keep the external recovery records.

## Security boundary

There is no authentication, user account, or per-user authorization. CLI actors are derived
as `ai-cli:SLUG`; browser writes use `human-web`. Supplying an actor in a request is rejected.
Loopback access, filesystem permissions, and access to the OS account are the trust boundary.
Origin/Host checks are browser request protections, not proof of an authorized human.

The API checks exact Host and rejects disallowed `Sec-Fetch-Site` values. POST/PATCH/PUT
also require the configured Origin, JSON content type, and `X-AI-Tasks-Mutation: 1`, including
pure POST previews/validation. The raw JSON limit is 1 MiB. A valid same-origin HTTP mutation
has this shape (the route supplies the project):

```json
{
  "operation_id": "NEW_UUID",
  "database_epoch": "CURRENT_EPOCH",
  "expected_revision": 3,
  "expected_config_revision": 1,
  "payload": { "description": "Exact **Markdown** source\n" }
}
```

The corresponding CLI file is flat:

```json
{
  "operation_id": "NEW_UUID",
  "database_epoch": "CURRENT_EPOCH",
  "expected_revision": 3,
  "expected_config_revision": 1,
  "description": "Exact **Markdown** source\n"
}
```

```bash
node dist/cli.js task update TASK_UUID --project demo --input update.json --json
```

Do not copy a browser operation ID into a different-actor CLI command: actor/scope/target/body
are part of idempotency identity. An exact retry uses its original tokens even if state has
advanced. After a definitive conflict, compare the current state and create a new proposal/ID.
No automatic actor, project, revision, or confirmation is invented for a mutation.

## SQLite and lock discipline

Supported storage is Linux local filesystem storage with working `flock`. SQLite must be
at least 3.51.3; `npm run check:runtime` checks the native module and connection settings.
Each ordinary connection uses foreign keys, WAL, `synchronous=NORMAL`, and a busy timeout
of 5000 ms. A bounded exhausted SQLite/lock wait is a retryable `DB_CONFLICT`; it is not a
successful write. NORMAL durability can lose recently committed transactions after power/OS
failure. No zero-loss or hardware-failure guarantee is made.

Ordinary CLI/API/worker connections hold shared lifetime locks. Restore/recovery owns the
exclusive lock before inspecting/replacing the live generation. The stable `.lock` inode
and the separate supervisor ownership mutex must not be deleted or replaced to defeat
contention. Do not use symlink/hardlink aliases for the database or put it on NFS/SMB/cloud
sync storage. Do not manually remove WAL/SHM, publication-phase files, or recovery evidence.
Stop other connections when exclusive maintenance reports contention; use status to determine
whether work is already accepted before submitting anything new.

## Manual backup and validation

Backups use SQLite's online backup facility and managed opaque UUIDs. They are operational
writes to external manifests, while domain state, domain audit, and SQLite operation receipts
remain unchanged. There are no scheduled/cloud backups and no arbitrary input/output file
paths in the public backup commands. A regular copy of an open database file is insufficient.

Create `backup-create.json` using a fresh operation ID, current epoch, current global settings
revision, and the current config revision of the explicit attribution project. There is no
ordinary entity `expected_revision` token for backup create or restore.

```json
{
  "operation_id": "NEW_UUID",
  "database_epoch": "CURRENT_EPOCH",
  "expected_config_revision": 1,
  "expected_settings_revision": 1
}
```

```bash
node dist/cli.js backup create --project demo --input backup-create.json --json
node dist/cli.js backup list --all-projects --json
node dist/cli.js backup validate BACKUP_UUID --all-projects --json
```

Use actual revisions instead of the illustrative `1`s. An archived attribution project is
allowed for these operational actions. Preserve the backup directory and its manifests,
checksums, receipts, and snapshots together; a manifest ID is not a filesystem path. Backup
listing is paginated; follow its opaque cursor without changing scope or filters.

## Restore and outcome recovery

Validation returns the exact union of current and backup project slugs. Review the complete
union, including projects absent from one side. Every current project supplies its current
entity/config revisions; a backup-only project supplies `null` for both. Reservation-only
historical owners do not add an affected-project claim. Revalidate after relevant changes.

A flat CLI `restore.json` is:

```json
{
  "operation_id": "NEW_UUID",
  "database_epoch": "CURRENT_EPOCH",
  "expected_config_revision": 1,
  "expected_settings_revision": 1,
  "backup_id": "BACKUP_UUID",
  "affected_projects": [
    { "project_slug": "demo", "expected_revision": 3, "expected_config_revision": 1 },
    { "project_slug": "backup-only", "expected_revision": null, "expected_config_revision": null }
  ],
  "confirmation": {
    "asserted": true,
    "user_text": "I reviewed every affected project and confirm replacing this database."
  }
}
```

The array and all counters must come from validation/current reads. The top-level config
revision is for the attribution project; `expected_settings_revision` is global. The per-project
`expected_revision` values belong inside `affected_projects`. Confirmation must be actual
nonempty user text and an explicit assertion; a client must not manufacture it.

```bash
node dist/cli.js backup restore --project demo --input restore.json --json
node dist/cli.js backup status JOB_UUID --all-projects --json
node dist/cli.js backup status --operation-id ORIGINAL_OPERATION_UUID --all-projects --json
```

Restore waits for terminal completion by default. `--no-wait` returns the durable accepted
job receipt; an isolated continuing owner finishes the operation after that CLI exits. The
owner coordinates with a running supervisor when present. In either mode, loss of the response
means an unknown outcome, not permission to allocate a new ID. Read status by job ID, or by
the original operation ID if the job response was lost. Supply exactly one lookup ID. These
status reads use external records without opening SQLite and remain usable during maintenance.
HTTP equivalents are `GET /api/v1/backups/jobs/JOB_UUID?all_projects=true` and
`GET /api/v1/backups/jobs?all_projects=true&operation_id=ORIGINAL_OPERATION_UUID`.

A successful restore creates a new epoch. The old-epoch command, even an exact restore retry,
is rejected; use status instead. The protocol validates compatibility/integrity and current
readable audit history, creates a pre-restore recovery snapshot, stages/validates the result,
and publishes through its recorded atomic replacement phases. It preserves the union of
immutable audit IDs and permanent project emoji reservations. Conflicting audit duplicates,
unreadable current history, or incompatible reservation ownership prevent replacement.
`EMOJI_CONFLICT` details name the owners/entities; no marker is silently rewritten to make
restore succeed. Historical owners may retain reservations even when absent from live projects.

On startup the supervisor inspects external unfinished jobs/phases before opening an ordinary
generation and invokes exclusive recovery when necessary. It does not announce healthy readiness
until the normal generation is verified. If recovery cannot safely resolve the state, ordinary
access remains refused. A direct `node dist/api.js` process can keep the shell/status listener
available; the `serve` CLI wrapper has a startup deadline and may exit without readiness.
There is no public `recover` CLI command. Preserve files and diagnose the structured error;
do not force startup by deleting the phase, WAL, lock, or unreadable audit records. Restarting
the maintained supervisor retries recovery. To return to older data later, validate and restore
its managed snapshot through this same guarded procedure, not by copying over an active DB.

## Recurrence, settings, and offline use

Calendar recurrence follows the global IANA timezone; elapsed recurrence derives the next
instant from actual completion. Timing mode and miss policy are independent. Every new rule
supplies `first_deadline`, `schedule`, `miss_policy`, and `confirmation_window_ms` explicitly.
The confirmation window is inclusive: at deadline+window completion is timely; only a strictly
later instant expires it. Pausing stops creation for paused periods, while old windows/debts
remain real. Explicitly select occurrences and their revisions for completion/cancellation.
Only future pending occurrences on pause can be cancelled, with a nonempty reason; debt is not
forgiven. Reads never generate or expire recurrence.

Schedule-dependent writes include current settings revision. `settings update --project demo`
requires the current settings revision as `expected_settings_revision`, the attribution
project’s `expected_config_revision`, the current `database_epoch`, and a new `operation_id`. Timezone changes version all calendar generations, including paused,
draft, task-archived, and project-archived parents; captured absolute instants/snapshots and
elapsed generations stay unchanged. An archived attribution project is allowed for global
settings. Configuration migrations compare config revision as both `expected_revision` and
`expected_config_revision`; ordinary project edits compare project entity revision.

Pending/debt work and old owed active anchors can block recurrence retirement, archive, or
configuration/timezone changes. Tick bounded arrears and resolve outstanding outcomes before
retrying a new guarded proposal. Project restore leaves formerly active recurring children
at the configured paused restore status, not running; an explicit resume is separate. Direct
recurring task restore obeys its configured edge and consent requirements.

The built browser shell caches successful reads and exact Markdown source/safe rendered HTML.
It does not promise uncached content, persistence after browser eviction/clearing, or storage
when quota is exhausted. There is no application expiry. Saved timestamps remain the original
fetch times. Read snapshots, draft records, and immutable pending proposals are separate.
No mutation queue is resumed on reconnect. Offline/maintenance/reconciliation disable all writes,
including configuration, settings, manual ticks, backups, and restore. A lost-response retry
reuses its original proposal. Fresh metadata/config/state are reconciled after reconnect;
new epochs retain dirty text and its old base until explicit review. Browser storage is not
an alternative to a managed database backup.
