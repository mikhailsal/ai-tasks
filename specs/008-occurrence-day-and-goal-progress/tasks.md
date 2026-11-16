# Tasks: Occurrence day and goal progress

**Input**: Design documents from `specs/008-occurrence-day-and-goal-progress/` (plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md); constitution v3.2.0.

**Tests**: Required. Constitution Principle VI asks for behavior tests on real databases, with
the failing regression test written before the fix. Test tasks come first in each story.

**Format**: `- [ ] T### [P?] [US#?] Description with file path`. [P] marks a task that touches
other files than the open tasks it could run beside.

**Gate**: implementation starts only after the owner approves it, on branch `008-occurrence-day-and-goal-progress`, delivered
through a pull request (constitution v3.2.0).

## Phase 1: Setup

- [x] T001 Confirm 007 is merged (migration 0004); baseline green (stacked on 007)

## Phase 2: Foundational

- [x] T002 [P] Write the boundary table (12 cases incl. 23 and 25 hour days) in `tests/unit/occurrence-day.test.ts`
- [x] T003 [P] Implement `occurrenceDay(deadline, zone, hour)` with Temporal in `src/core/recurrence/day.ts`
- [x] T004 Write the populated upgrade and backfill test in `tests/integration/migration-0005.test.ts`
- [x] T005 Add `drizzle/0005_occurrence_day.sql` and columns in `src/schema/entities.ts` and `src/schema/recurrence.ts`
- [x] T006 Add the idempotent backfill step to `src/core/database/migrate.ts` (also runs on restore staging)

## Phase 3: User Story 1 - Every occurrence belongs to a day (P1)

- [x] T007 [P] [US1] Failing integration tests for materialization, rule change and filters in `tests/integration/occurrence-day.test.ts`
- [x] T008 [US1] `day_start_hour` on project update in `src/core/projects/` and `src/schema/projects.ts`
- [x] T009 [US1] Write `occurrence_day` at materialization in `src/core/recurrence/snapshots.ts`; add it to the resource
- [x] T010 [US1] Day filters in `src/core/queries/recurrence.ts`, `src/schema/recurrence-query.ts`, CLI and HTTP
- [x] T011 [US1] Show the day and a native date filter in `web/src/screens/Occurrences.tsx` and `web/src/screens/occurrence-row.tsx`

## Phase 4: User Story 2 - Record measured values (P2)

- [x] T012 [P] [US2] Failing tests in `tests/integration/occurrence-values.test.ts`
- [x] T013 [US2] Declarations and validation in `src/core/recurrence/values.ts`; `values` in `src/core/recurrence/control.ts` and `src/core/recurrence/complete.ts` (declarations ride on recurrence input via `publishGeneration`, so create and configure share one path)
- [x] T014 [US2] Show values in the CLI human list and `web/src/screens/occurrence-row.tsx`

## Phase 5: User Story 3 - See goal progress (P2)

- [x] T015 [P] [US3] Failing tests with prepared windows in `tests/integration/occurrence-progress.test.ts`
- [x] T016 [US3] Grouped progress query in `src/core/queries/progress.ts`; `occurrence progress` in `src/cli/commands/occurrences.ts`; HTTP route in `src/api/routes/occurrences.ts`
- [x] T017 [P] [US3] Contract tests in `tests/contracts/occurrence-progress-cli.test.ts` and `tests/contracts/occurrence-progress-http.test.ts` (one file: `tests/contracts/occurrence-progress.test.ts`)
- [x] T018 [US3] Progress block with loading, empty, offline and error states in `web/src/screens/occurrence-progress.tsx`
- [x] T019 [P] [US3] Playwright parity test in `tests/e2e/occurrence-progress.spec.ts`
- [x] T020 [US3] Benchmark entry for progress; docs in contracts, agent guide and `CHANGELOG.md`

## Final Phase: Polish and acceptance

- [x] T021 Update `tests/acceptance-coverage.md` and, if mutations changed, `tests/mutation-coverage.md` with this feature's rows
- [x] T022 Run `npm run lint`, `npm run typecheck`, `npm run test:functional` and the quickstart validator; all green
- [x] T023 Walk through `specs/008-occurrence-day-and-goal-progress/quickstart.md` on a scratch database (`AI_TASKS_DB_PATH` in a temporary directory) and record the result in the pull request

## Dependencies

007 merged → Foundational → US1 → (US2, US3 in either order). 009 uses `occurrence_day`.

## Parallel examples

T002 with T003; T012 with T015 once US1 is done.

## Implementation strategy

MVP is US1; US3 is the reported need and follows next.
