# Quickstart validation: Recurring readiness warnings

**Feature**: `012-recurring-readiness-warnings` | **Date**: 2026-11-16

Scratch database only.

1. **Draft (US1-1/2)**: create a recurring task in a draft-category status → advisory in the
   create response; `task get`, `task list`, `recurrence get` carry it.
2. **Fixed (US1-3)**: transition to an active-category status → advisory gone; occurrences seeded.
3. **Paused (US1-4)**: pause → no advisory.
4. **Web (US1-5, SC-004)**: notice on the task (`npm run test:e2e`).
5. **Time once (US2-1, SC-002)**: create with `first_deadline` 2026-11-17T20:30 local and no
   `local_time` → schedule shows `20:30:00.000`, `schedule_time_derived` advisory.
6. **Equal and different (US2-2/3)**: equal → as today; different → accepted with
   `schedule_time_mismatch` naming both.
7. **Nothing newly rejected (SC-003)**: existing recurrence contract suites green.
