# Research: Occurrence day and goal progress

**Feature**: `008-occurrence-day-and-goal-progress` | **Date**: 2026-11-16

Checked against commit `bf8bd62`.

## R1. Where the day rule lives (FR-001)

- **Decision**: new column `projects.day_start_hour INTEGER NOT NULL DEFAULT 0`
  (CHECK 0..23), changed by `project update` with the project revision, returned in the project
  resource only when non-zero. Hour granularity as the spec says.
- **Rationale**: the rule belongs to the project (spec assumption). Project configuration
  (`project_configs`) holds the priority model and workflows with its own preview/migrate flow
  for task remapping; the day rule remaps nothing (FR-003), so the lighter project update is
  enough.
- **Alternatives**: a field of project configuration (forces the preview/migrate flow for a
  value that never touches tasks); per recurring task (spec assumption excludes it).

## R2. Day of an occurrence, stored once (FR-002, FR-003)

- **Decision**: new column `occurrences.occurrence_day TEXT` (`YYYY-MM-DD`), written when the
  occurrence is materialized (`materializeOccurrence`, `src/core/recurrence/snapshots.ts`), from
  the deadline in the generation's own time zone (`schedule_generations.timezone`) shifted back
  by the project's `day_start_hour`: the day is the local date of `deadline - day_start_hour`
  computed with `Temporal.ZonedDateTime` (`@js-temporal/polyfill`, already a dependency), so a
  23 or 25 hour day is handled by the zone rules. A deadline exactly at the start hour belongs to
  the day starting there (US1-3).
- **Backfill**: SQLite cannot evaluate IANA zones, so `migrateDatabase`
  (`src/core/database/migrate.ts:18-31`) gains an idempotent step after the SQL migrations that
  fills rows where `occurrence_day IS NULL` with the default rule (hour 0), in one immediate
  transaction, in batches of 1,000. `migrateDatabase` also runs on restore staging
  (`src/core/recovery/prepare.ts:127`), so a restored old backup is filled too.
- **Already materialized future rows**: occurrences are materialized ahead of their deadline, so
  a rule change leaves already created future occurrences on the old rule. This follows FR-003
  ("only occurrences created later") and is stated in the agent guide (review finding E5). Existing rows predate any rule, so hour 0 is their correct
  and permanent day.
- **Rationale**: a stored day makes filtering and progress plain indexed SQL, and a later rule
  change cannot rewrite history because nothing recomputes stored days.

## R3. Filters (FR-002)

- **Decision**: `occurrence list` input gains optional `day` or `from_day`/`to_day` (inclusive;
  at most 366 days). Index `occurrences_task_day_idx (task_id, occurrence_day)`.

## R4. Declared and recorded values (FR-004 to FR-006)

- **Decision**: declarations live on the recurring task as `recurrence_state.value_declarations`
  JSON (list of `{name, kind}` with kind `number`, `time_of_day` `HH:MM`, `duration` in whole
  minutes; names `^[a-z][a-z0-9_]{0,31}$`; at most 8), set by `recurrence configure` (optional
  field `values`). Recorded values: `occurrences.recorded_values` JSON object, only in completed
  states, written by `occurrence complete` items (`values`). Validation is against the
  declarations current at completion time; refusals list declared names and kinds (FR-006, using
  004's `allowed` detail).
- **Rationale**: changing declarations must not create a schedule generation, so they do not go
  into the generation snapshot. Recorded values keep their own meaning after declarations
  change, because each value carries its kind in storage `{name: {kind, value}}`.

## R5. Progress (FR-007, FR-008)

- **Decision**: new read `occurrence progress <task-id>` with `from_day`, `to_day` (inclusive,
  at most 366 days). One grouped SQL query on `(task_id, occurrence_day)` returns counts by state.
  Mapping: done = `completed` + `completed_late`; missed = `missed`; owed = `debt`; open =
  `pending`; cancelled excluded; decided = done + missed + owed. Output
  `{task_id, from_day, to_day, done, decided, breakdown:{completed, completed_late, missed, debt},
  open}`.
- **Rationale**: matches spec edge cases (owed counts as decided and not done; late recording is
  done and shown in the breakdown). HTTP `GET .../occurrences/progress` with the same query for
  the web (FR-008).

## R6. Web (US1-4, US3-4, SC-003)

- **Decision**: occurrence rows show the day; the occurrences screen gets a day filter and a
  progress block for a chosen window (default: the last 7 days ending today in the project's
  rule); recorded values appear in the row details. Read-only.
- **Design details (design review 2026-11-16)**: the day filter is a native
  `<input type="date">` pair (reuse ladder, no picker library), 44 px touch targets at 430 px.
  The progress block reads «6 из 7» as its main figure, with the breakdown on one line below
  («вовремя 5 · записано после окна 1 · пропуск 1»), using 006's wording. States: loading
  (skeleton of the same height), empty window («нет повторений за эти дни»), offline (cached
  value with its as-of time), error (the 004 message). Values in the row as «Уснул 23:40 ·
  Спал 7 ч 30 мин», with the declared names as labels.

## R7. Compatibility (FR-009)

- **Decision**: new resource fields are optional and emitted only when meaningful
  (`occurrence_day` always present for occurrences is an addition to a strict schema): announced in
  the change log under the policy chosen for 010 (B). No input becomes required.
