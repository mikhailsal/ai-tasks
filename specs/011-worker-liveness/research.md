# Research: Worker liveness

**Feature**: `011-worker-liveness` | **Date**: 2026-11-16

Checked against commit `bf8bd62`. The worker is `worker run --project SLUG`
(`src/cli/commands/worker.ts`), one process per project, looping in
`src/runtime/recurrence-worker.ts`: after a batch without more work it waits 30 s. A pass with no
due work writes nothing today (`src/cli/worker-data.ts`, `processBatch` returns early).

## R1. Recording the last pass (FR-001)

- **Decision**: new table `worker_passes (project_slug PRIMARY KEY, last_pass_at INTEGER NOT
  NULL)`, upserted by `processBatch` after each completed pass (with or without due work, and
  after a successful tick), at most once every 60 s per process. Not audited and not part of
  receipts: it is operational state, like the worker's stderr progress lines, not a domain
  change. Excluded from `read_revision` so it does not invalidate client caches.
- **Rationale**: a pass that finds nothing is exactly the healthy case that must be visible.
  60 s throttling keeps writes to one small row per minute.
- **Alternatives**: a file next to the database (not included in backups and restores, so the
  restored-backup edge case would be wrong); a process check (`pgrep`; fragile, host-specific,
  and the database is the shared truth).

## R2. Status and tolerance (FR-002, FR-003, SC-001, SC-004)

- **Decision**: tolerance 5 minutes, documented, one constant in core. Status is computed on
  read: `never` when no row; `stale` when `now - last_pass_at > 5 min`; otherwise `healthy`.
  A `last_pass_at` in the future (clock moved back) counts as healthy. Because status is computed
  at read time, a stopped worker reads as stale immediately after the tolerance: bounded delay 0
  beyond the tolerance itself, plus up to 60 s of throttling, so at most 6 minutes after the last
  real pass.
- **Rationale**: the passing interval is 30 s and the shortest confirmation window allowed is
  longer than the tolerance in normal use; 10 missed intervals cannot be a hiccup. A clock step of
  up to 4 minutes cannot produce a false stale while the worker writes every 60 s (SC-004 test
  steps the injected clock by plus and minus 2 minutes and by minus 1 hour).
- **Restore**: the table is in the database, so a restored backup carries its last pass time and
  is stale until the worker runs (edge case).

## R3. Where the status appears (FR-002)

- **Decision**: `meta --json` (the first read in the agent guide) gains `data.workers`:
  `[{project_slug, status, last_pass_at?, tolerance_seconds}]` for active projects; `project get`
  and `project list` items gain `worker: {status, last_pass_at?}`. HTTP mirrors them. Both are
  additions announced with 010's policy.

## R4. Advisory (FR-004, FR-006)

- **Decision**: a 010 provider with codes `worker_stale` and `worker_never_ran`, attached to
  `occurrence list`, `occurrence get`, `recurrence get`, `agenda`, `task list` and `task get` when
  the project has at least one active recurring task and the status is not healthy. One
  aggregated advisory per response (subject: project). Remedy: hint to `worker run --project
  SLUG` as a manual alternative and, first, to starting the service: `serve` forks one worker per
  active project (`src/api/project-worker-client.ts:46`), so a stale worker usually means the
  service is down. Remedy text: start the service, see the agent guide section on running it. The catalogue message is fixed text;
  the last pass time is in the remedy text formatted from the stored value (not from the
  request, FR-008 of 010).

## R5. Web (FR-005)

- **Decision**: project screen and occurrence screens render 010's `AdvisoryNotice`; the project
  list shows a small status badge from `worker.status`. A paused project's notice adds that pause
  does not stop the worker.

## R6. No side effects (FR-007)

- **Decision**: status reads are plain selects; nothing starts or signals processes.
