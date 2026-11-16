# Research: Recurring readiness warnings

**Feature**: `012-recurring-readiness-warnings` | **Date**: 2026-11-16

Checked against commit `bf8bd62`. Recurring statuses have a category `draft`, `active`, `paused`
or `archived` (`recurring_workflow.statuses[].category`); only `active` seeds occurrences
(`src/core/recurrence/control.ts:100-125`). The time zone of a schedule is the settings time zone
at publication (`recurrenceSettings(transaction).timezone`).

## R1. Not-generating advisory (FR-001 to FR-004)

- **Decision**: a 010 provider for task resources of kind recurring. Code
  `recurring_not_generating` when the task's status category is `draft`. The status category is
  the project's workflow rule, so a project whose own status is draft-category gets the advisory
  with that status named. A second condition "active but nothing ahead" was considered and
  dropped: schedules have no end, and an active `after_completion` task waits on its predecessor
  (`src/core/recurrence/calendar-enumeration.ts:183`, `resume.ts:263`), so the condition would
  only produce false advisories (review finding E4). Not raised for `paused`, `archived` or
  terminal tasks (FR-002). Remedy: for `draft`, a hint to `task transition` to a status whose
  category is `active`, listing those status ids from the project workflow. Attached to `task create`, `task get`, `task list`, `task board`,
  `recurrence get`, `recurrence configure` and `task transition` responses.
- **Rationale**: the condition is a function of stored state, so it is computed on every read
  (010 FR-005) and disappears once the task generates (FR-003). The web shows it through 010's
  `AdvisoryNotice` (FR-004).

## R2. Time given once (FR-005)

- **Decision**: `local_time` becomes optional in the three calendar schedule variants of
  `recurrenceInputSchema` (`src/schema/recurrence-input.ts:15-38`). When omitted, core derives it
  from `first_deadline` converted to the schedule's time zone with `Temporal`
  (`toZonedDateTimeISO(timezone).toPlainTime()`, formatted `HH:MM:SS.mmm`) before publishing
  the generation, so the stored schedule always contains `local_time`. The response's recurrence
  configuration shows the derived value, and an informational advisory
  `schedule_time_derived` states that it was derived. `after_completion` schedules have no local
  time and are unchanged.
- **Rationale**: deriving from an instant is always defined: every instant has exactly one local
  time, so derivation itself can never be ambiguous. FR-007 keeps today's rejections where they
  arise (the next deadlines computed from a stored `local_time` that falls into a gap or fold are
  handled by `nextCalendarDeadline` as today).
- **Compatibility**: making a required field optional accepts more requests and rejects none
  (FR-008, SC-003).

## R3. Mismatch advisory (FR-006)

- **Decision**: when both are given and the local time of `first_deadline` differs from
  `local_time`, the request is accepted as today and the response carries
  `schedule_time_mismatch`, whose remedy text names both times and states that later occurrences
  use `local_time`. The advisory stays on reads of the task until the first occurrence is
  decided, then it is no longer relevant and disappears.
- **Interpretation to confirm at engineering review**: 010 FR-008 forbids values taken from the
  request in advisory text. The times shown here are read back from the stored schedule and the
  stored first deadline after acceptance, formatted by the server, which is how 011 shows the
  stored last pass time. If the reviewer reads FR-008 more strictly, the times move into a
  structured `subject` extension instead; the spec outcome is the same.

## R4. Configure path (edge case)

- **Decision**: `recurrence configure` uses the same schema and derivation, so changing the
  schedule of an existing task follows the same rules.
