# Shared application contract

Status: planned v1 contract, not an implemented interface. CLI and HTTP are thin adapters
over the same validated core operations. [CLI](cli.md), [HTTP](http.md), and
[Web UI](web-ui.md) specialize this contract. Persistence details belong in
[data-model.md](../data-model.md).

## Values and envelopes

JSON keys use `snake_case`; unknown input keys are rejected. Omission in an update means
unchanged; `null` clears only an explicitly nullable field. Technical resource IDs, `operation_id` and `database_epoch` are UUIDs; configuration-local status/level IDs are stable ASCII keys, not resource UUIDs. Project slugs are immutable ASCII
`[a-z0-9]+(?:-[a-z0-9]+)*`, at most 64 characters. Task kind is `ordinary` or `recurring`;
maintenance work uses `recurring`. Dates are RFC3339 with a required offset and millisecond
precision or coarser; output is always UTC `YYYY-MM-DDTHH:mm:ss.SSSZ`. Date-only, offset-free,
and greater-than-millisecond precision inputs fail validation. Past deadlines are allowed.
User-entered local times must resolve unambiguously in the application timezone; the UI
must request an explicit offset for a repeated time and reject a nonexistent local time.

Titles contain 1–300 characters after surrounding whitespace is trimmed; descriptions
preserve Markdown verbatim and contain at most 100,000 Unicode code points. Names and labels
contain 1–80 characters. Project priorities are signed 32-bit integers, default `0`, never
null. Numeric task priorities and numeric model bounds are within `[-1000000000,1000000000]`,
with at most three decimal places; configured bounds are inclusive. Emoji contain one Unicode
RGI emoji grapheme cluster, including valid ZWJ/tone sequences; normalize presentation
selectors for uniqueness while preserving display text. The shared repeatable task default
is `⚪`. Projects require an emoji
other than `⚪`; project markers remain globally reserved even when archived and cannot
match a stored task marker. Former project markers stay permanently reserved to that project.
Non-default task markers reserve their project namespace while
the task is unfinished and unarchived. Recurring draft/active/paused tasks reserve markers.
Limits are 100 statuses per workflow, 100 named priority levels, 100 prerequisites per task,
and validated request bodies at most 1 MiB (except backup transfer). Oversized changes must
be split into valid independent operations; a single atomic migration is never silently
split or partially committed.

Every response uses one of these envelopes; CLI JSON and HTTP JSON have the same shape:

```json
{"ok":true,"data":{},"meta":{"database_epoch":"UUID","timezone":"Europe/Moscow","now":"2026-10-21T10:00:00.000Z"}}
```

```json
{"ok":false,"error":{"code":"REVISION_CONFLICT","message":"Task changed since it was read","details":{"entity_id":"UUID","expected_revision":3,"current_revision":4},"retryable":false}}
```

Successful writes add `operation_id` and `audit_ids` to `meta`. A list's `data` is
`{items:[...],next_cursor:string|null}`; an empty result has `items:[]`, never an error.
Messages are for people; automation branches on stable codes. Error details are structured
but additions to them are compatible. No stack traces, SQL, or filesystem secrets appear in
transport errors.

## Mutations, revisions, and retry

Every mutation requires `operation_id` and the current `database_epoch`. A mutation of an
existing entity additionally requires `expected_revision`; project-owned writes require
`expected_config_revision`. Creating a project is exempt from existing-entity/configuration
revision checks because neither exists. Creating a task requires the current project config
revision but no task revision. Schedule-dependent operations (recurring create/configure/control/complete/tick and timezone-affecting configuration migrations) also require expected_settings_revision from current Settings; a mismatch returns CONFIG_CONFLICT with scope=settings. Project edits use project revision; config writes use config
revision; task edits, transitions, dependency changes, recurrence changes, and occurrence
batches use parent task revision. Occurrence batches also provide every selected occurrence's
revision. Each accepted change increments the affected entity's revision. Config migrations
include the revisions of every affected task. Global settings writes use
`expected_settings_revision` instead of a separate `expected_revision`, plus the attribution
project's `expected_config_revision`, and name that project explicitly; restore has the
special preconditions below.

All project-owned mutations name `project_slug`. HTTP binds it from the route; CLI requires
`--project`. Ownership of existing task/occurrence targets is checked before any change,
including all members of a batch. Scope does not authorize editing a dependency's target.
Audit, state, revision increments, and the idempotency result commit atomically.

The idempotency key is `(database_epoch, operation_id)`. Canonical input includes the core
operation, explicit project scope, actor, preconditions, and payload, independent of JSON
key order. Retrying exactly the same operation returns its original success envelope,
including the original entity revisions and audit IDs, without new writes. Reusing the key
with different content returns `IDEMPOTENCY_CONFLICT`. Replay lookup occurs before stale
revision checks, but after validating current epoch. All rejected writes roll back and add
no success audit; to retry a changed proposal, read current state and use a new operation ID.
The CLI cannot retain a caller's input file for them; it never overwrites or deletes it. The
UI preserves the draft and its base revision until a successful explicit save.

Confirmation-required transitions accept
`confirmation:{asserted:true,user_text:"the user's confirmation"}`. Text must be nonempty;
the assertion applies only to that command, task, source/target status, and operation ID.
TaskRestore accepts the same optional confirmation object; a direct recurring restore requires
it whenever the configured archived-to-paused edge requires confirmation. Missing or incomplete
confirmation returns CONFIRMATION_REQUIRED with no changes. An ordinary restore has no workflow
edge, so supplying confirmation for it is a VALIDATION_ERROR; project restoration retains its
explicit administrative exception for changed child states.
Both fields and transition context appear in audit. They are workflow evidence, not
authentication. HTTP actors are `human-web`; CLI actors are `ai-cli:<project_slug>`.
Worker operations use `ai-cli:<project_slug>` with `origin:"recurrence-worker"` metadata.

## Resource shapes

The following are field-level schemas; `?` means optional input, `| null` means nullable,
and `...` means the resource embeds the previously defined field set, not an accepted JSON
key. Read-only derived fields cannot be supplied as edits.

| Shape | Fields |
|---|---|
| Project | `slug`, `name`, `description`, `emoji`, `priority`, `archived_at:Timestamp|null`, `revision`, `config_revision`, `created_at`, `updated_at` |
| ProjectCreate | `slug`, `name`, `emoji`, `description?:string`, `priority?:integer`, `config?:ProjectConfigInput` |
| ProjectPatch | one or more of `name`, `description`, `emoji`, `priority` |
| Task | `id`, `project_slug`, `kind`, `title`, `description`, `rendered_html` (detail only), `emoji`, `status_id`, `category`, `priority:Priority|null`, `deadline:Timestamp|null` (ordinary), `display_deadline:Timestamp|null` (derived), `archived_at:Timestamp|null`, `revision`, `config_revision`, `created_at`, `updated_at` |
| TaskCreate | `kind`, `title`, `description?:string`, `emoji?:string`, `status_id?:string`, `priority?:Priority|null`, `deadline?:Timestamp|null` (ordinary only), `recurrence?:RecurrenceInput` (recurring only) |
| TaskPatch | one or more of `title`, `description`, `emoji`, `priority`, `deadline` (ordinary only); whole-description replacement, no patch language |
| TaskTransition | `to_status_id`, `confirmation?`, `replacement_emoji?`, `emoji_collision?:"reject"|"use_default"` |
| TaskArchive | empty payload for ordinary; `confirmation?` for a configured recurring archive edge |
| TaskRestore | `confirmation?`, `replacement_emoji?`, `emoji_collision?:"reject"|"use_default"` |
| Dependency | `task_id`, `prerequisite_task_id`, `prerequisite_project_slug`, `satisfied:boolean`; mutation body: `prerequisite_task_id`, `prerequisite_project_slug` |
| Occurrence | `id`, `task_id`, `project_slug`, `deadline`, `state`, `revision`, `description_snapshot`, `rendered_html_snapshot`, `schedule_snapshot`, `miss_policy`, `confirmation_window_ms`, `actual_completed_at:Timestamp|null`, `completion_recorded_at:Timestamp|null`, `missed_at:Timestamp|null`, `cancel_reason:string|null`, `created_at` |
| Audit | `id`, `operation_id`, `project_slug`, `actor`, `origin`, `timestamp`, `entity_type`, `entity_id`, `action`, `changes:[{field,before,after}]`, `confirmation:null|{asserted,user_text}`, `config_revision`, `database_epoch` |
| Settings | `timezone` (IANA zone), `revision`, `database_epoch` |
| Backup | `id`, `created_at`, `source_database_epoch`, `schema_version`, `project_slugs`, `size_bytes`, `checksum` |

Priority is exactly one of `{model:"classic",level:"critical"|"high"|"normal"|"low"}`,
`{model:"eisenhower",important:boolean,urgent:boolean}`,
`{model:"named",level_id:string}`, `{model:"numeric",value:number}`, or `null`.

`ProjectConfigInput` is `{priority_model,ordinary_workflow,recurring_workflow}`. A priority
model is `{type:"classic"}`, `{type:"eisenhower"}`,
`{type:"named",levels:[{id,label,color?}]}` in highest-first order, or
`{type:"numeric",min,max,direction:"higher"|"lower"}`. Optional colors use fixed accessible
palette tokens `slate`, `red`, `orange`, `amber`, `green`, `teal`, `blue`, `indigo`, `violet`,
or `rose`, never carrying meaning alone.
A workflow is `{initial_status_id,statuses:[{id,label,category,color?}],transitions:[{from,to,requires_confirmation:boolean}]}`.
Status and named-level IDs are stable keys, independent of labels; IDs are unique within
their own configuration. Ordinary categories are `not_started`, `in_progress`, `review`,
`completed`, `cancelled`. Recurring categories are `draft`, `active`, `paused`, `archived`.
Initial statuses must have category `not_started` / `draft` respectively. Reads of config
return `{revision,priority_model,ordinary_workflow,recurring_workflow}`. Recurring workflow
also requires `restore_status_id`, default `paused`, naming one status in category `paused`
so restoration is deterministic even with multiple custom paused statuses.

`ConfigMigration` is `{config:ProjectConfigInput,status_mappings:[{kind,from_status_id,to_status_id}],priority_mappings:[{from:Priority,to:Priority|null}],affected_tasks:[{task_id,expected_revision}]}`.
Mappings are mandatory for removed or semantically changed in-use values, including category
changes; label/color-only and transition-only changes create a revision without remapping
task values. Migration covers archived tasks too as an explicit configuration-maintenance exception to ordinary task read-only archival; the owning project itself must not be archived. It validates all resulting dependencies,
emoji reservations, recurrence retirement rules, and values atomically; only ordinary
workflow edges and their confirmation requirements are bypassed. History retains old values
and their config meaning. Unknown, duplicate, missing, or invalid mappings reject the whole
operation. Dependency satisfaction is checked against the complete projected state for each
ordinary task whose status ID or category changes and whose resulting category is in_progress,
review, or completed. A label/color/edge-only change or priority-only remapping does not count as
a status transition. Unchanged dependents, including those in other projects, may remain in an
advanced category if a prerequisite is mapped out of completed, just as with ordinary reopening;
they become blocked for their next guarded transition and are never automatically moved.
Do not reject an unrelated migration merely because such an unchanged dependent is blocked.
Graph integrity, ownership, emoji and lifecycle checks still cover the complete projected state.
A migration preview is a side-effect-free query returning affected task IDs,
current revisions, required mappings, and validation issues; it is not a reservation.

The ordinary preset contains `idea/planning/ready → not_started`,
`in_progress → in_progress`, `sanity_check → review`, `done → completed`, and
`cancelled → cancelled`. It includes the five forward chain edges, backward adjacent
edges including `done → sanity_check`, `done → in_progress`, every unfinished state
`→ cancelled`, and `cancelled → idea`. `sanity_check → done` requires confirmation.
Configuration reads expose all preset edges explicitly; clients must never infer allowed
transitions from status ordering. The recurring preset starts at `draft`; edges are
`draft → active`, `draft → archived`, `active → paused`, `active → archived`,
`paused → active`, `paused → archived`, and `archived → paused`. Activation, pause/resume,
archive, and restore use configured edges and lifecycle guards. The sole configured initial
status is used on creation; a supplied `status_id` must equal it.

## Recurrence and lifecycle

`RecurrenceInput` is
`{first_deadline:Timestamp,schedule:Schedule,miss_policy:"carry_forward"|"record_miss",confirmation_window_ms:integer}`.
The window and policy are required, with no implicit defaults; the window is inclusive in
`[0,2592000000]` milliseconds (30 days). `Schedule` is one of:

- `{mode:"calendar",pattern:"days"|"weeks",every:positive_integer,local_time:"HH:mm:ss.SSS"}`;
- `{mode:"calendar",pattern:"weekdays",weekdays:[1..7],local_time:"HH:mm:ss.SSS"}` (ISO Monday = 1, distinct nonempty selection);
- `{mode:"calendar",pattern:"months",every:positive_integer,day_of_month:1..31,local_time:"HH:mm:ss.SSS"}`;
- `{mode:"after_completion",unit:"hours"|"days",every:positive_integer}`.

Every interval `every` is an integer in `[1,3650]`. The explicit first deadline, which may be
past, anchors the calendar date. Calendar weeks mean 7 calendar days;
months clamp the specified day to month end. Completion-relative days mean 24 elapsed hours.
Generated calendar times use the shared zone: earlier offset in a fold, forward by the gap
for nonexistent wall times. Changing the zone leaves existing instants unchanged and changes
only future calendar generation. Changing recurrence supplies a new `first_deadline` anchor
for future occurrences and preserves every existing occurrence's conditions and snapshot.
Changing timing mode requires no pending/debt occurrence. Activation creates the initial
occurrence; calendar ticks materialize all due active-period anchors and one next future
anchor in resumable duplicate-safe batches. The worker runs at startup and every 30 seconds.
Reject a new calendar anchor that collides with an existing occurrence deadline on the same
parent; changing generations does not create duplicate obligations at an existing instant.

Occurrences begin `pending`; a mark recorded at or before `deadline + window` becomes
`completed`. After that instant it becomes `debt` or `missed` according to its captured
policy, even if expiry processing has not yet run. Completing `debt` or `missed` becomes
`completed_late`, preserving the miss record and audit. Actual completion defaults to server
now; a supplied instant cannot be in the future. Completion-relative actual times must not
precede the previous actual completion in the same schedule generation. Explicit batch completion accepts
`{occurrences:[{id,expected_revision,actual_completed_at?}]}` and changes only those IDs.
All selected rows must belong to the named parent/project and be completable; any conflict
rolls back the entire batch. Double completion with a new operation ID fails validation;
an exact idempotent retry returns the original result.

Cancellation accepts `{occurrences:[{id,expected_revision}],reason:string}` only for future
pending occurrences (`deadline > now`) of a paused parent; reason is required. Pause first
when retiring a schedule. Debts cannot be cancelled.
Archive and retirement-producing migrations are blocked while pending/debt occurrences remain or an old active-period catch-up cursor still has owed anchors. Run scoped ticks until old owed anchors are materialized before checking retirement. Pausing never suppresses processing anchors owed before pause. Pause first, explicitly cancel
future pending occurrences, and complete debts before retirement. Missed records remain as
history and do not block retirement. Pause skips newly arising periods with no catch-up,
while existing windows/debts continue. Service downtime while active catches up every missed
period, using duplicate-safe occurrence keys. Reads do not run ticks. The worker and
explicit tick use mutations; calendar periods never become standalone tasks.

Calendar resume selects the next future anchor and retains precreated occurrences. In
completion-relative mode, resume retains existing pending/debt occurrences; if none exist
and its derived candidate elapsed during the pause, an explicit new `first_deadline` starts
a new generation. This must never invent an actual completion or create paused-period debt.

An ordinary archive preserves status. Project archive preserves member statuses and data,
makes the project read-only, hides it by default, and suspends recurrence; it cannot bypass
outstanding recurrence retirement guards. Project restore moves formerly active recurring children to the configured restore_status_id (paused), preserving draft, already-paused and individually archived children and ordinary task states. This explicit administrative effect bypasses child edge confirmations and audits every changed child. The request supplies affected_tasks:[{task_id,expected_revision}] for all affected children; stale/incomplete revisions reject the whole request. Resumption remains explicit. No delete, task move, or slug rename exists. Restoring/reopening with
an occupied emoji defaults to `emoji_collision:"use_default"` in noninteractive flows;
the UI explicitly submits `reject` and offers a replacement picker. CLI callers may also
explicitly request `reject`. Any fallback is audited. Project emoji never fall back.

Dependencies are ordinary-task-only, cannot point to self, and cannot introduce a cycle.
Adding an unmet dependency to an already in-progress/review/completed dependent is rejected.
Removing links does not change status. Archived prerequisites retain their category for
satisfaction; archival does not erase links. A prerequisite leaving completed does not
retroactively move dependent tasks; their next guarded transition rechecks all links.

## Queries and ordering

Every read of project-owned data chooses `project_slug` or explicit `all_projects:true`.
All-project mode is read-only. Item lookup still checks supplied project scope. Defaults:
`limit:50`, maximum `200`, opaque `cursor` bound to filters/scope/order/database epoch and
`read_revision` and a server-selected `as_of` instant. On the first page, capture the injected
clock as as_of and encode it in the cursor; subsequent pages use that same instant for all
time-dependent classification and local-calendar boundaries. Paginated domain reads return
`meta.as_of` in the usual UTC millisecond format; `meta.now` remains the actual request time.
The client cannot supply an as_of/now override. Passage of time alone does not invalidate this
pagination session; refreshing without a cursor starts a new as_of. Responses expose
`read_revision`; an intervening domain write changing
query-visible data invalidates the prior pagination context. A malformed cursor returns `VALIDATION_ERROR`; changed
revision/filter/sort context returns `CURSOR_STALE` and requires refresh from the first page.
The same state/clock/query yields the same order and page boundaries.

Filters are `q` (literal case-insensitive substring over title/description), `status_id`,
`category`, `priority` (the complete model-specific value), `kind`, `emoji`, and
`archive:"exclude"|"include"|"only"` (default `exclude`). List/priority/agenda defaults
exclude ordinary completed/cancelled tasks; `include_terminal:true` includes them.
Project lists order by priority descending, slug ascending. Tasks first group in that project
order, then use assigned task priority before null, configured priority rank, earliest
effective deadline (missing last), creation ascending, UUID ascending. Eisenhower order is
important/urgent, important/nonurgent, nonimportant/urgent, neither. No cross-model score.

Agenda uses project groups, then `overdue`, `today`, `next_7_days`, `later`, `no_deadline`.
Overdue means strictly before the query as_of and unfinished; today ends at the next local midnight,
and next seven days spans the seven following local calendar dates. Recurring parents appear
once with the earliest unclosed pending/debt deadline, not once per occurrence. When no
unclosed occurrence exists the derived deadline is null. Priority view uses the normal
priority ordering. Statistics expose separate `tasks:{by_kind,by_category,total}` and
`occurrences:{pending,debt,missed,completed,completed_late,cancelled,total}` counts, so an
occurrence never inflates task workload. Ordinary task counters additionally expose
`unfinished`, `overdue`, and `completed`. Optional `from`/`to` timestamp bounds filter workload
by deadline and completed counts by recorded completion time; archived/cancelled are excluded
unless requested. Ranges are half-open `[from,to)`: include equality at from and exclude
equality at to. Either omitted bound is unbounded; from=to is an empty range and from>to is
VALIDATION_ERROR. A metric whose filtering timestamp is null is excluded when either bound
is present. With no bounds, undated tasks remain in the applicable workload counters.
Unpaginated statistics capture one server-selected as_of per request for overdue/calendar
calculations and return it in meta; they accept no caller clock override.
Occurrence lists order deadline ascending then UUID;
audit lists order timestamp descending then UUID descending; backups order creation descending
then UUID. Every aggregate item retains project and configuration context.

## Recovery

Backup creation takes an explicit attribution project and produces a consistent SQLite
snapshot through the database backup facility, with manifest/checksum, not a raw live-file
copy. It is an operational action, read-only against the domain database: no domain audit or
database receipt write. Its epoch/settings preconditions and idempotent operation receipt
live in the managed snapshot manifest. The backup list returns opaque IDs; HTTP never accepts an arbitrary filesystem path.
Validation is read-only and reports compatibility, integrity, project slugs, and affected
projects. Restore requires the current epoch, a unique operation ID, backup ID, settings
revision, and `affected_projects:[{project_slug,expected_revision,expected_config_revision}]`
covering the exact union of current and backup project slugs (both current revisions are
`null` only for backup-only projects).
It also requires `confirmation:{asserted:true,user_text}`. This allowlist prevents an
operator from accidentally treating database-wide recovery as one-project restoration.

Restore runs in maintenance mode, validates before replacement, preserves the union of
current and backup immutable audit records by globally unique audit ID, rejects conflicting
duplicates, and appends restore audit records for every affected project. Also union the live
and backup permanent project_emoji_reservations by emoji_key, keeping their project_slug owner.
For the same key and owner, retain the live reservation row; append backup-only rows unchanged.
Retain reservations whose owner has no project in the restored state; they require no live
project FK and remain unavailable to tasks or other project slugs. Different owners for the
same key, a staged project marker reserved to another owner, or any staged task marker matching
a project reservation returns EMOJI_CONFLICT before publication. Never drop a reservation or
rewrite a task marker/history to make restore succeed. Reservation-only historical owners do
not expand affected_projects: that set remains the union of live and backup project tables.
Read-only backup validation returns EMOJI_CONFLICT when reservations conflict; the exclusive
restore helper rechecks and returns the same structured error before publication. Both use
`error.details:{conflicts:[ReservationConflict,...]}`. ReservationConflict has exactly
`{reason,emoji_key,reservation_project_slug,conflicting_project_slug,entity_id}`. Reason is
`reservation_owner_mismatch`, `project_marker_collision`, or `task_marker_collision`.
For owner mismatch, reservation_project_slug is the live owner, conflicting_project_slug is
the backup owner, and entity_id is null. Otherwise reservation_project_slug is the merged
reservation owner and the conflicting scope/UUID identifies the staged project or task.
For a key with an owner mismatch, report that mismatch only, not derived marker collisions.
Return distinct conflicts in ascending tuple order (emoji_key, reason,
reservation_project_slug, conflicting_project_slug, entity_id), comparing strings by Unicode
scalar values and null before text. Clients display these typed details; an error does not
produce a successful validation result or permit restore.

A successful restore establishes a new database epoch, invalidates caches/cursors and stale
clients, and returns that new epoch.
The external restore manifest retains a receipt addressable by job ID or original operation
ID, so a lost response is recovered through a read-only status lookup. Every old-epoch
mutation, including an exact restore retry, fails; the status lookup does not restore again.
An automatic pre-restore recovery snapshot and atomic recovery protocol protect failure.
Restore does not generate or alter source code. Browser reconnect after restore requires
fresh metadata and state before a write; existing drafts are preserved for manual revision.

Every ordinary CLI/API/worker DB connection holds a shared lock on a stable external lock
file for its full lifetime. A separate restore maintenance helper drains API/worker
connections, waits for CLI shared holders, then obtains exclusive Linux `flock`, stages and
validates the restored DB plus audit union, and atomically publishes it. The HTTP supervisor
remains alive in maintenance mode and serves job status from external manifests with no DB
connection. No PID-file lock, lockfile deletion, live-file copy, or WAL deletion substitutes
for this protocol. Unreadable current audit refuses normal restore and retains damaged
bytes; emergency salvage is outside the first-release standard flow.

## Stable errors

| Code | HTTP | CLI exit | Meaning |
|---|---:|---:|---|
| `VALIDATION_ERROR` | 400 | 2 | Invalid args, input, state/edge, mapping, schedule, cursor, or read-only lifecycle |
| `TASK_NOT_FOUND` | 404 | 3 | Missing task or occurrence target (details identify resource) |
| `PROJECT_NOT_FOUND` | 404 | 3 | Missing named project |
| `PROJECT_MISMATCH` | 409 | 4 | Existing target belongs to another project |
| `DB_CONFLICT` | 409 | 4 | SQLite lock wait exhausted; retryable |
| `REVISION_CONFLICT` | 409 | 4 | Entity changed since read |
| `CONFIG_CONFLICT` | 409 | 4 | Project configuration changed since read |
| `CURSOR_STALE` | 409 | 4 | Read revision/filter/sort context changed; restart pagination |
| `DEPENDENCY_BLOCKED` | 409 | 4 | Unsatisfied prerequisite or invalid dependency addition |
| `EMOJI_CONFLICT` | 409 | 4 | Marker reservation conflict |
| `CONFIRMATION_REQUIRED` | 409 | 4 | Missing assertion or user confirmation text |
| `IDEMPOTENCY_CONFLICT` | 409 | 4 | Operation ID already used with different content |
| `DATABASE_EPOCH_CONFLICT` | 409 | 4 | Client belongs to an earlier database epoch |
| `MAINTENANCE` | 503 | 5 | Restore or maintenance temporarily blocks access; retryable |
| `ORIGIN_REJECTED` | 403 | N/A | Browser request fails Host/Origin/header policy |
| `ROUTE_NOT_FOUND` | 404 | N/A | Unknown HTTP API or static-resource route; resource lookup errors retain their domain codes |
| `INTERNAL_ERROR` | 500 | 1 | Unexpected persistence/runtime failure; no success implied |

Contract tests cover stdout/stderr/exit status, validation and ownership, atomic audit,
confirmation evidence, stale revisions/config, idempotent replay, all lifecycle guards,
same-origin policy, and route/CLI equivalence against real migrated SQLite fixtures.

## Generation and supervisor consistency rules

Only completion in the current completion-relative generation may create its successor.
Completing a historical-generation miss/debt affects that occurrence and audit only.
Reconcile the old generation through its effective change instant before replacing it.
Initial draft activation may seed a past explicit first deadline. An explicit restart while active requires a future first_deadline and seeds it immediately. A generation configured while paused must not seed an elapsed paused-period deadline: calendar resume selects the next future anchor, and a completion-relative deferred seed requires a replacement future first_deadline if it elapsed. Timezone-only versions continue after the prior materialized anchor/effective change time without reseeding their historical first deadline. Existing occurrence conditions remain unchanged.

The HTTP supervisor owns no SQLite connection/shared lifetime lock. It sends validated
commands to a long-lived API data helper that invokes core functions under its lifetime
shared flock. Restore drains/exits this helper and the recurrence workers before exclusive
acquisition, so maintenance status remains served without deadlocking on the supervisor.

Audit browsing may filter a historical project slug even if the restored current project table
no longer contains it; history scope is resolved against immutable audit snapshots, not only
live project rows. This read permission does not permit mutations of absent projects.
