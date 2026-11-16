# Research: Write shortcuts

**Feature**: `009-write-shortcuts` | **Date**: 2026-11-16

Checked against commit `bf8bd62`.

## R1. Resolve and write under one lock (FR-004, FR-009)

- **Decision**: `executeMutation` (`src/core/database/mutate.ts:55`) gains an optional
  `resolve(transaction)` step that runs inside its immediate transaction before the epoch and
  revision guards. A shortcut supplies a resolver that reads the current database epoch, the
  task, configuration and settings revisions and, for completion, the target occurrence, and
  returns the same strict envelope an agent would build. The guards and the handler then run
  unchanged. The operation identifier is a fresh random UUID created by the adapter.
- **Rationale**: reading revisions in a separate transaction would let another writer slip in
  between and turn every race into a stale-revision refusal the agent cannot fix without reads.
  Under the same immediate lock the shortcut sees exactly the state it changes. Because the
  handler is the strict one, validation, refusals and audit events are identical (FR-009,
  SC-003); only the receipt's `operation_id` differs, as between any two strict writes.
- **Request hash**: today `parseCommand` and `fingerprintRequest` run before the transaction
  (`src/core/database/mutate.ts:57-65`). With a resolver the envelope exists only inside the
  transaction, so on that path parsing and hashing move after `resolve`, still before
  `findReceipt`. The path without a resolver keeps today's order byte for byte (FR-010).
- **Epoch**: the resolver takes the current epoch, so a shortcut cannot detect that the database
  was restored since the agent last looked. This is acceptable because the shortcut carries no
  revisions from an earlier read; the agent guide states it (review finding E2).
- **Alternatives**: a deterministic operation identifier from the intent (the strict request
  hash includes revisions, which change after the first success, so a repeat would fail with
  `IDEMPOTENCY_CONFLICT` instead of returning the record).

## R2. Repeat safety by state (FR-008, US3-1/2)

- **Decision**: before writing, the resolver checks the target state:
  - completion: if the occurrence is already `completed` or `completed_late` and the supplied
    actual time (if any) and note (if any) equal the stored ones, the response returns the stored
    occurrence with `data.existing: true` and nothing is written; if they differ, the shortcut is
    refused with `VALIDATION_ERROR`, the stored record in `details.existing` and no change;
  - move: if the task is already in the target status, the response returns the task with
    `data.existing: true` and nothing is written.
- **Rationale**: the effect, not the request, is what must not repeat; a state check is exact
  and needs no new storage.

## R3. Naming (FR-003, FR-005)

- **Decision**: `<task>` is a UUID or an icon. Icons resolve within `--project` through
  `task_emoji_reservations` (`src/schema/entities.ts:222-236`, primary key
  `(project_slug, emoji_key)`), which makes non-default icons unique per project. The default
  icon `⚪` is never accepted as a name (it is shared). Unknown icon → refusal listing the
  project's reserved icons (at most 20, 004 bounds); default icon → refusal saying to use the
  identifier.
- **Day**: `--day YYYY-MM-DD` matches `occurrence_day` (specification 008); until 008 ships,
  the local calendar date of the deadline in the generation's time zone. No match → refusal with
  the nearest earlier and later days that have occurrences; several matches → refusal listing
  candidates `{id, state, deadline}` (at most 10). The shortcut then accepts `--occurrence ID`
  instead of `--day` (same task check).

## R4. Move (FR-002, FR-006, FR-007)

- **Decision**: `task move <task> --to STATUS [--from STATUS] [--confirmation JSON]`. `--to`
  maps to `to_status_id` of `task transition`; `--from` is checked inside the lock against the
  current status; a mismatch is refused with `VALIDATION_ERROR` and
  `details.actual_status`, without change. Disallowed target → the existing
  transition refusal plus `details.allowed` (statuses allowed from the current one, read from the
  workflow).
- **Rationale**: the transition rules and confirmation requirement stay in core; the shortcut
  only fills revisions.

## R5. Response (FR-011)

- **Decision**: the success envelope is the strict envelope (same `data`, `meta`, operation and
  audit identifiers) plus `data.existing` only on the no-op path. `data` already contains the
  entity with its revision; `meta.database_epoch` gives the epoch, so a strict follow-up needs no
  read.

## R6. HTTP and web

- **Decision**: CLI only. The web client already holds revisions and uses the strict routes
  (spec assumption).
