# Data Model: Occurrence day and goal progress

**Feature**: `008-occurrence-day-and-goal-progress` | **Date**: 2026-11-16

Migration `0005_occurrence_day.sql` (after 007's `0004`) plus a code backfill step.

| Table | New column | Rule |
|---|---|---|
| `projects` | `day_start_hour INTEGER NOT NULL DEFAULT 0` | CHECK 0..23 |
| `occurrences` | `occurrence_day TEXT` | `YYYY-MM-DD`; written at materialization; never updated; backfilled for old rows |
| `occurrences` | `recorded_values TEXT` (JSON) | object `{name: {kind, value}}`; only in `completed`, `completed_late`; NULL otherwise |
| `recurrence_state` | `value_declarations TEXT` (JSON) | list of `{name, kind}`, at most 8; NULL means none |

Index: `occurrences_task_day_idx (task_id, occurrence_day)`.

## Value kinds

| Kind | Stored value | Example |
|---|---|---|
| `number` | finite JSON number | `7.5` |
| `time_of_day` | `HH:MM` 24-hour | `"23:40"` |
| `duration` | whole minutes, 0..10080 | `450` |

## Progress (computed, not stored)

`done = completed + completed_late`, `decided = done + missed + debt`, `open = pending`,
`cancelled` excluded, over occurrences with `from_day <= occurrence_day <= to_day`.
