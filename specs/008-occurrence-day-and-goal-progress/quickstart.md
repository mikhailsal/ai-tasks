# Quickstart validation: Occurrence day and goal progress

**Feature**: `008-occurrence-day-and-goal-progress` | **Date**: 2026-11-16

Scratch database only (`AI_TASKS_DB_PATH` in a temporary directory, `npm run db:migrate`).

1. **Day rule (US1-1/3)**: `project update demo` with `day_start_hour: 6`; create a daily task at
   01:30 local; its occurrence on 9 November has `occurrence_day` `2026-11-08`; one at 06:00 has
   its own date.
2. **Default (US1-2)**: in a project without a rule the day equals the local deadline date.
3. **Stability (US1-5)**: change the rule to 4; existing occurrences keep their days; new ones
   use 4.
4. **Boundary set (SC-001)**: `npm run test:functional` runs the 10+ boundary cases including
   the 23 and 25 hour days of Europe/Berlin.
5. **Backfill**: upgrade a populated schema-4 database; every occurrence has a day equal to its
   local deadline date.
6. **Values (US2)**: declare `asleep_at: time_of_day`, `slept: duration`; complete with both →
   stored and shown; wrong kind → refused naming the kind; unknown name → refused listing names.
7. **Progress (US3, SC-002)**: prepare the 7-day example; `occurrence progress` returns 6 of 7
   with the breakdown; an empty window returns 0 of 0.
8. **Web (US1-4, US3-4, SC-003)**: day, filter, values and the progress block visible
   (`npm run test:e2e`).
