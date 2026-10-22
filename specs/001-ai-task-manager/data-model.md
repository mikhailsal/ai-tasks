# Data model and state rules

Status: design, not an existing schema. Normative product rules are in [spec.md](spec.md);
transport shapes are in [contracts/common.md](contracts/common.md). All database access and
business rules live in plain exported functions under `src/core/`; Drizzle schema definitions
live under `src/schema/`. Tables below are logical names to use in migrations.

## Representation

- Technical IDs, audit IDs, operation IDs and database epochs: UUID text, generated with
  `crypto.randomUUID()`. Status/level IDs are stable ASCII keys local to project/kind.
- Time: integer Unix epoch milliseconds in SQLite; exact UTC ISO milliseconds at the boundary.
  Human local dates use the configured IANA timezone. No `scheduled_for` column or API field.
- Domain numeric priority values: signed exact thousandths as integer storage. Custom bounds
  within ±1,000,000,000 map safely to ±1,000,000,000,000 thousandths. Project priority uses a
  signed32 integer directly. Reject precision loss rather than round user values.
- Booleans: checked integers 0/1. Enums: checked text plus Zod input validation. Configuration
  and immutable before/after snapshots: validated JSON text, never unvalidated opaque input.
- Every mutable entity has a positive integer `revision`; timestamps are injected core clock
  values. Queries include current project `config_revision` and global `database_epoch`.
- All connections verify foreign_keys=ON, journal_mode=WAL for files, synchronous=NORMAL,
  busy_timeout=5000. Assert bundled SQLite >=3.51.3. Local Linux filesystem only.

## Tables

| Table | Fields and relationships | Constraints and purpose |
|---|---|---|
| `application_state` | singleton; `database_epoch`, `timezone`, `revision`, `read_revision`, `schema_version`, `created_at`, `updated_at` | timezone defaults Europe/Moscow. `read_revision` increments on mutations changing list/filter/order-visible data; read cursors bind it. Settings revision guards timezone changes; epoch changes only on database initialization/restore |
| `pagination_secrets` | private singleton `id=1`, random256-bit hex `secret` | Internal cursor authentication metadata, initialized by versioned migration, never read-initialized or exposed in API/CLI resources. Restore preserves the live key while changing epoch; every old valid cursor becomes stale. |
| `projects` | `id`, unique `slug`, `name`, `description`, `emoji`, `emoji_key`, `priority`, `revision`, `config_revision`, `archived_at`, timestamps | immutable slug; priority0 default; explicit meaningful emoji; no hard delete |
| `project_configs` | `(project_slug, revision)` PK; immutable priority/workflow JSON, effective_at, actor, semantic snapshot | `projects.config_revision` selects active version. Historical versions retained. Config writes are migrations, including rename/color/edge-only revisions |
| `tasks` | `id`, `project_slug` FK, `kind`, `title`, `description`, `description_html`, `emoji`, `emoji_key`, `status_id`, model-specific priority JSON/scaled numeric, ordinary `deadline`, `revision`, `archived_at`, timestamps | `kind` ordinary/recurring. Recurring deadline is derived, not stored as a user field. Status/priority membership validated against active project config. Use `(project_slug,id)` unique for composite ownership joins |
| `task_dependencies` | `dependent_task_id`, `prerequisite_task_id`, both project slugs, created_at, created_operation_id | pair PK; both endpoint tasks ordinary; self-link rejected. Composite FKs preserve ownership. Directed cycle checks happen under immediate write transaction. No cascade deleting history |
| `project_emoji_reservations` | `emoji_key` PK, `project_slug`, original display text, first_reserved_at | permanent global project reservation, including former/archived project emoji; union live+backup reservations on restore, without a live-project FK; never ⚪. Reject if the key appears on any stored task |
| `task_emoji_reservations` | `(project_slug,emoji_key)` PK, `task_id` unique | only non-default markers on ordinary nonterminal/unarchived tasks and recurring draft/active/paused parents in unarchived tasks. All reservations checked against global project pool inside same write lock; no accidental release just because a project is archived |
| `schedule_generations` | `id`, task/project IDs, generation number, mode, schedule JSON, first_deadline, timezone-at-version, miss_policy, window_ms, created_at, successor_generation_id | versioned rule; first deadline and policy/window explicit. Changing a rule creates a generation; created occurrences never change. A separate current pointer identifies rules for future creation |
| `recurrence_state` | task/project IDs PK/FK, current_generation_id, cursor_anchor, waiting_predecessor_id, next_candidate_at, revision | mutable checkpoint separate from rule history. All checkpoint and occurrence commits atomic; cursor resumes bounded catch-up, never a user scheduling date |
| `recurrence_intervals` | ID, task/project IDs, start_at, end_at nullable, behavior active/paused/archived, schedule_generation_id | half-open intervals [start,end) define owed calendar anchors; initial state draft has no active interval. Existing created occurrences survive a later pause |
| `occurrences` | `id`, task/project/generation IDs, unique `occurrence_key`, deadline, rule/policy/window snapshot, description_snapshot, description_html_snapshot, state, revision, actual_completed_at, completion_recorded_at, missed_at, cancelled_at/reason, created_at | unique `(generation_id,occurrence_key)`. All immutable snapshots frozen at creation; mutable outcome fields separately validated. Multiple debts/windows may coexist for calendar schedules |
| `audit_records` | UUID PK, operation_id, project_slug snapshot, entity_type/id, actor, origin, timestamp, action, changes JSON before/after, semantic config snapshot, confirmation JSON, database_epoch | immutable through application; no FK requiring entity/project still present after restore. Equal audit UUID with different contents is corruption/conflict, not an update |
| `operation_receipts` | `(database_epoch,operation_id)` PK, canonical request hash, actor/scope/operation, result JSON, audit_ids, committed_at | durable replay. Fingerprint covers actor, scope, full payload and original preconditions. Same key+different content fails; old epoch fails before replay |

Backups and restore jobs have external, managed manifests, not ordinary project tables.
A backup creates a filesystem artifact without mutating domain tables or fabricating a domain
audit. Its operational receipt lives with the manifest. A restore stages a new full database
and adds scoped restore audit events; it is not implemented as arbitrary table CRUD.

## Workflow and configuration invariants

Ordinary preset: idea/planning/ready are not_started; in_progress is in_progress;
sanity_check is review; done is completed; cancelled is cancelled. Default initial idea.
Edges: five forward chain edges, all five adjacent backward edges (including done →
sanity_check), done → in_progress, every unfinished state → cancelled, cancelled → idea.
Only sanity_check → done requires confirmation by default. Project configuration can change
these edges/flags and the initial not_started status.

Recurring preset: draft initial; draft → active/archive, active → paused/archive,
paused → active/archive, archive → paused. Labels may change; each custom status maps to one
of these four behaviors. A direct archive/restore endpoint still validates the configured
edge and confirmation. Configuration migrations bypass ordinary transition edges and their
confirmations, but never ownership, epoch/revision, dependency, lifecycle or emoji invariants.

Migration operation: load complete expected task revision set; validate full old→new mappings
for removed/invalid/meaning-changed values; compute projected task states; validate dependencies
against that projected state (including all projects referenced) for ordinary tasks whose
status ID or category changes into in_progress/review/completed; reserve/release emoji for
projected categories; atomically write config version, updated tasks, audit and receipt. No
intermediate state can temporarily clear a dependency or reserve a duplicate emoji. Rename
retains status/level ID. Edge/label/color-only change increments config revision, leaves task
status values/revisions unchanged, and updates read_revision as appropriate. Priority-only
remapping also does not introduce a status transition. If a prerequisite is mapped out of
completed, unchanged advanced dependents (also across projects) remain in place and become
blocked for their next guarded transition. Such dependents do not cause an unrelated
migration to fail. A task whose status ID changes within the same advanced category still
revalidates all prerequisites against the final projected categories. Structural graph,
ownership, lifecycle and emoji invariants continue to apply to the complete projected state.

Dependency satisfaction uses the prerequisite's current category; archive does not change
category. A dependent can remain in progress after a prerequisite is reopened, but its next
transition into in_progress/review/completed must revalidate. Adding an unmet dependency to
such an already advanced task is rejected. Removing an edge is permitted, revisioned and
audited; never auto-transition a task.

## Emoji normalization and reservations

Require exactly one RGI emoji grapheme using a pinned Unicode emoji recognizer and
`Intl.Segmenter`; family/flag/skin-tone sequences can be one grapheme. NFC display text is
stored, and presentation variation selectors U+FE0E/U+FE0F are removed from the comparison key.
Do not strip ZWJ, modifiers or regional indicators. This groups presentation-only variants,
not genuinely different skin-tone/family symbols. Reject standalone text/non-emoji sequences.

Project create/change reserves the new key globally and retains old project reservations;
there is no expiration or reuse by another project/task. Task assignment checks global
reservation first, then the project's non-default active-task reservation. ⚪ is exempt from
task uniqueness and prohibited for projects. Finished/cancelled/archived ordinary tasks do
not reserve; recurring parent draft/active/paused does reserve independently of individual
occurrence outcomes. A task archived flag overrides its reservation; project archive alone
does not rewrite all child emoji histories/reservations.

Interactive restore can request a replacement when its key is occupied; noninteractive return
without replacement uses ⚪ unless the caller explicitly requires rejection. Both outcomes
are atomic with status/restore and audited. Emoji filters may return many historic/default
matches, so lookup never silently selects one task for mutation.

## Time and recurrence algorithm

Use server-only `@js-temporal/polyfill` for calendar arithmetic; use native Intl in the UI.
Generated calendar timestamps use compatible disambiguation: earlier instant for a repeated
local time; shift forward by the gap for a nonexistent one. User-entered ambiguous/gap times
must be resolved explicitly before submission, not silently repaired. Preserve the original
specified month day so Jan31 → Feb28/29 → Mar31 does not drift to the 28th. Calendar N weeks
means N×7 local calendar days; completion-relative days mean 24 elapsed hours.

First activation creates the explicit first occurrence, even if its deadline is past. Calendar
processing enumerates owed anchors through now and one next future anchor. Every anchor due
during an active interval is owed; paused/draft/archived interval anchors are skipped. A
future occurrence already materialized before a pause remains an obligation, as explicitly
required. Stop after a bounded batch, commit its cursor, and continue in later ticks without
skipping active periods. Occurrence keys are `calendar:<anchor_instant>` scoped by generation;
the explicit seed uses the same scheme, avoiding duplicate first anchors.

After-completion generation creates only its first occurrence until that occurrence has an
actual completion. Each subsequent key is `after:<predecessor_occurrence_id>`; a unique
constraint prevents two next occurrences after duplicate completion. Deadline = actual
completion + elapsed interval. If backdated completion yields an already-past next deadline,
materialize that single occurrence and classify it by the clock; do not invent another actual
completion to manufacture a chain. A recorded miss awaits late actual completion.

Completing while paused closes existing work, but does not create paused-period occurrences.
Preserve the potential successor anchor as checkpoint information, not an invented occurrence.
On resume with no open occurrence: if the computed candidate is still future, use it; if it
elapsed during the pause, require an explicit `first_deadline` and new generation. This is an
explicit schedule restart, distinct from ordinary completion-based advancement. Calendar
resume uses its next future anchor. Only completion in the current completion-relative generation creates a successor; late completion of a historical generation updates history only. Generation entry distinguishes initialization, explicit restart, and timezone continuation. Initial activation from draft may seed the explicit first deadline even when past. An explicit restart while active requires a future first_deadline and seeds it immediately. A generation configured while paused never recreates a paused-period anchor: calendar resume chooses its next future anchor; a completion-relative deferred seed that elapsed requires a replacement future first_deadline. Timezone-only versions continue from their cursor after the prior materialized anchor/effective change time and never reseed a historical first deadline. Reconcile all old owed anchors before switching generations. A timing-mode switch also requires no pending/debt and an explicit new first deadline. Changing an existing schedule retains all created conditions;
new anchors after the change use a new generation and must not duplicate an existing parent
occurrence at the same deadline; reject such an explicit anchor collision for correction.

Timezone changes preserve stored occurrence and ordinary deadline instants. Version future
calendar rules to the new application zone while preserving local schedule fields. The next
uncreated anchor is calculated strictly after the prior materialized anchor and effective
change time; prior active-period arrears use their historical generation's timezone/rules.
This preserves overdue obligations while preventing retroactive deadline shifts.

### Outcomes and exact boundaries

| From | Trigger | To / consequences |
|---|---|---|
| pending | completion recorded <= deadline+window | completed; set actual (supplied <= now or now), recorded timestamp; compute successor if active |
| pending | clock > deadline+window without completion | debt or missed using captured policy; append miss audit once |
| pending after window, debt, missed | late completion | completed_late; ensure the original miss audit exists, preserve missed_at, record actual/recorded times; compute completion-relative successor once |
| pending with deadline>now, parent paused | explicit cancel with reason | cancelled; no actual completion or derived next deadline |
| completed/completed_late/cancelled | new completion attempt | reject; exact prior request replay returns saved result |

For completion racing expiry, acquire one immediate transaction, read server clock and state,
then apply the boundary rule. If the worker has not yet persisted a miss but the window has
passed, the completion transaction appends both the logical miss and late completion events.
The logical missed_at is the captured expires_at boundary, persisted only once now is strictly greater; the miss audit timestamp remains the actual recording clock. A user-supplied earlier actual time cannot change recording timeliness. Actual times must not
be future; within an after-completion generation they are nondecreasing. Calendar debts may
be explicitly completed out of order. Batch completion validates every ID/revision before
any writes and updates only selected rows. No debt cancellation or automatic debt selection.

Archive and retirement-producing migrations require the catch-up cursor to cover every owed active-period anchor through the effective retirement time, then require no pending/debt rows, including precreated future rows. Pause must not suppress processing of pre-pause owed anchors; only paused-period anchors are skipped. Operational path:
pause, explicitly cancel genuinely future pending occurrences with a reason, close debts,
then archive. Past pending rows must complete or expire; cancellation cannot erase an already
owed obligation. Missed outcomes do not block retirement. Project archive validates every
recurring child first and then hides/read-locks the project without overwriting child states.
Project restore places formerly active recurring children in their configured paused status; it preserves draft, paused and individually archived children and ordinary states. This explicit administrative effect bypasses per-task edges/confirmations and audits each changed child. The restore command includes every affected child revision; a stale child aborts the entire operation. If multiple statuses map to paused, use the workflow's explicit restore-status key;
configuration validation requires that key. No recurrence runs until an explicit resume.

## Atomic writes, revisions and idempotency

1. Validate transport schema; normalize payload, Unicode, dates and request fingerprint.
2. Acquire shared maintenance lock before opening SQLite. Validate epoch.
3. Begin immediate Drizzle transaction. If matching receipt exists, return original result;
   conflicting fingerprint fails. Do not reject an exact retry solely for old revision tokens.
4. Check explicit project ownership, archive state, expected entity/config/settings revisions,
   then domain invariants against current transaction state. Schedule-dependent commands also compare expected_settings_revision so a timezone change cannot silently reinterpret submitted calendar rules. Check related dependency rows at
   commit-time state; never trust a stale client-computed satisfaction flag.
5. Apply state, reservation/checkpoint/revision changes. Increment read_revision if queried
   visible data changes. Append audit with captured semantic meaning, plus operation receipt.
6. Commit; publish success only after commit. Convert SQLite busy exhaustion to DB_CONFLICT;
   no automatic retry of stale edits. Preserve the original submitted proposal externally.

A receipt returns the exact stored original result and timestamp, not a reconstructed current
entity. Receipt retention is unbounded in release one; backup includes them. New restore epoch
invalidates old receipts without deleting their historical rows. Reads never expire tasks,
advance recurrence, or append domain audit. Worker searches for due work, then submits explicit
per-project tick commands; it does not bypass core rules.

## Indexes and read plan

| Index | Access path / verification |
|---|---|
| projects(priority DESC, slug ASC) | global grouping, stable project pagination |
| tasks(project_slug, kind, archived_at, status_id, deadline, created_at, id) | common project lists, terminal filtering, deadline agenda |
| tasks(project_slug, emoji_key) | emoji search plus assignment check over historical task markers |
| tasks(emoji_key) | project marker assignment cannot collide with a task in another project |
| dependencies(prerequisite_task_id, dependent_task_id) | reverse dependents and cycle traversal |
| occurrences(task_id, state, deadline, id) | earliest open/debt display and completion listing |
| occurrences(state, deadline, id), expiry endpoint expression/materialized column index | worker expiry candidates; include captured window in indexed expires_at |
| schedule/current checkpoint indexes on candidate due time | bounded recurrence generation queue |
| audit(project_slug, timestamp DESC, id), audit(operation_id) | history browse and operation context |
| receipt PK(epoch,operation_id), unique occurrence key and reservation PKs | idempotency and race protection |

Calculate per-model task priority ordering in one project-aware query (fixed CASE expressions,
custom-level rank join, exact numeric direction), with stable deadline/creation/ID tie breaks.
Do not fetch prerequisites/configurations/occurrences in an N+1 loop. Page parent tasks first,
then batch related details. Query plan fixtures must show actual indexes used; remove redundant
indexes if measured plans show they are unnecessary. Substring search uses bounded filtered
scans at release-one scale; no speculative FTS/tokenization semantics.

Opaque cursor binds query fingerprint, scope, sort version, epoch, read_revision and a
server-selected as_of captured from the injected clock on the first page. Every subsequent
page classifies dates and overdue state against this same instant; midnight/deadline passage
alone cannot move rows between page buckets. Expose meta.as_of separately from request-time
meta.now; callers cannot override the clock. Refreshing without a cursor captures a new as_of.
A changed read_revision returns CURSOR_STALE and the client reloads the first page, avoiding
silent gaps or duplicate pagination under concurrent mutations. Agenda buckets are within
each project; the project grouping rule remains primary. Statistics capture one as_of per
request and use half-open [from,to) ranges on each metric's specified timestamp: omitted bounds
are unbounded, equal bounds return empty counts, reversed bounds fail VALIDATION_ERROR; null
timestamps are excluded only when at least one bound is supplied.

## Backup/restore generation model

Backup manifests contain ID, checksum, actual completed snapshot metadata, schema/source epoch,
settings, project slugs and file size. Online SQLite backup writes a temporary managed file;
verify it and atomically publish it. Never copy live .db without WAL reconciliation. Snapshot
start time is not claimed to equal the point-in-time contents under concurrent writers.

The HTTP supervisor itself owns no SQLite connection or shared lifetime lock. A separate long-lived API data helper owns its SQLite connection under a flock wrapper; route adapters dispatch validated commands to that helper, which invokes core functions. This retains thin transport adapters and one core. The supervisor responds to maintenance status while the API data helper and recurrence workers drain and exit. Every app-owned database connection holds a shared external lock on
a stable never-deleted lockfile; restore acquires exclusive lock. Linux `flock` wrapper/helper
owns it for the entire connection/process lifetime. A crash releases OS locks; no PID-only
lockfile/timeout guessing. Restore helpers must close inherited shared-lock descriptors.

Require affected_projects to equal union of live and backup scopes, with current revisions
or null for projects absent from live state. Validate normal current DB/audit, checkpoint and
close; produce verified recovery copy. Stage backup, migrate supported prior schema, append
missing immutable audit UUID rows and scoped restore events; fail if equal UUID differs in
content. Union live and backup project_emoji_reservations by key and original project_slug
owner; keep the live row for an equal key/owner and append backup-only rows. Preserve historical
owners absent from the restored project table without a live-project FK. Fail EMOJI_CONFLICT
before publication for divergent owners or collision with any staged task marker/project
marker owned by another slug; do not rewrite markers or history. Backup validation reports
these conflicts and the exclusive helper rechecks them. Historical reservation-only owners
do not change the live+backup project-table scope union.
Audit snapshots may refer to entities not in the restored state, so they have no
live-entity FK. Assign a new database_epoch and keep a durable restore receipt keyed by old
epoch/operation in the external job manifest for recovery/status; old-epoch ordinary writes
are still rejected before replay. No idempotency loophole bypasses restored scope validation.

Sync stage, recovery copy and phase manifest. With no open DB connections, publish by one
same-filesystem atomic replacement, sync directory, reopen and check integrity/pragmas/epoch.
An unfinished manifest blocks ordinary startup until exclusive recovery completes or rolls
back using recorded old/new epochs. Pre-restore audit records are retained byte-for-byte in
new state; backup-only records are appended. Current corruption preventing complete audit
read fails normal restore and leaves original bytes untouched; destructive emergency salvage
is not a hidden product path. Restore invalidates every browser query cache and active edit
revision token, retaining unsaved drafts for explicit reconciliation.

Implementation refinement for occurrence schedule snapshots: generations retain the bare
Schedule in their schedule column; occurrences freeze
`{generation_id,generation_number,schedule,first_deadline,timezone,miss_policy,confirmation_window_ms}`.
The first_deadline is a canonical UTC timestamp. The frozen zone and generation anchor
remain readable after later schedule/timezone changes; the separately captured occurrence
policy/window columns determine expiry and completion classification.

**Completion-relative equal-actual refinement (T066):** nondecreasing actual timestamps permit equality. Distinct elapsed successors identified by after:<predecessor_occurrence_id> may therefore share a deadline with already completed history. Calendar anchors and explicit generation restart seeds retain parent-wide deadline collision rejection. This follows the common contract's calendar-anchor collision rule and preserves the explicit equal-actual completion requirement; no actual completion is synthesized.


## US4 implementation refinement — ordinary completion recording

Statistics need a nullable internal `tasks.completion_recorded_at` fact. It is set from the
transaction clock only when ordinary work enters the completed category, preserved across
completed-to-completed moves, content edits, archive/restore and label-only configuration,
and cleared when leaving completed. Recurring parents retain null; occurrences already
have their separate recording timestamps. This is internal storage, not a new writable
Task payload or public Task DTO field.

Reconstructing this fact with a maximum audit timestamp or revision is ambiguous after
restore merges audit from live and backup branches: both can contain the same task UUID
and revision with different completion histories. The restored task row must carry its
chosen branch's recording fact. A versioned migration may backfill only provable old
history; absent or ambiguous recording time remains null rather than borrowing updated_at.
Unrestricted completed counters include completed tasks with unknown recording time;
supplied date bounds exclude null recording times under the common metric rules.
