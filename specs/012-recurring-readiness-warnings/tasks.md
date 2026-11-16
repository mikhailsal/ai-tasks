# Tasks: Recurring readiness warnings

**Input**: Design documents from `specs/012-recurring-readiness-warnings/` (plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md); constitution v3.2.0.

**Tests**: Required. Constitution Principle VI asks for behavior tests on real databases, with
the failing regression test written before the fix. Test tasks come first in each story.

**Format**: `- [ ] T### [P?] [US#?] Description with file path`. [P] marks a task that touches
other files than the open tasks it could run beside.

**Gate**: implementation starts only after the owner approves it, on branch `012-recurring-readiness-warnings`, delivered
through a pull request (constitution v3.2.0).

## Phase 1: Setup

- [x] T001 Confirm 010 merged or in the same pull request

## Phase 2: User Story 1 - A recurring task that will not generate says so (P1)

- [x] T002 [P] [US1] Regression test of the 3 Nov draft case (fails first) plus paused, archived and after_completion-waiting cases in `tests/integration/readiness-advisories.test.ts`
- [x] T003 [US1] Provider `recurring_not_generating` (draft category only) in `src/core/advisories/providers/readiness.ts`
- [x] T004 [P] [US1] Contract tests (CLI and HTTP) in `tests/contracts/readiness-advisories.test.ts`
- [x] T005 [US1] Notice on the task via `AdvisoryNotice`; Playwright test in `tests/e2e/advisories.spec.ts`

## Phase 3: User Story 2 - The time is entered once (P2)

- [x] T006 [P] [US2] Derivation tests incl. DST days in `tests/unit/derive-local-time.test.ts`
- [x] T007 [US2] Optional `local_time` in input only, in `src/schema/recurrence-input.ts`
- [x] T008 [US2] Derivation in `src/core/recurrence/derive-local-time.ts`, applied in `publishGeneration` (`src/core/recurrence/generations.ts`), which create and configure both use
- [x] T009 [US2] `schedule_time_derived` and `schedule_time_mismatch` advisories; tests in `tests/integration/readiness-advisories.test.ts`
- [x] T010 [US2] `docs/advisories.md`, `docs/agent-guide.md`, `contracts/common.md`, `CHANGELOG.md`; 005 descriptor note for optional `local_time`

## Final Phase: Polish and acceptance

- [x] T011 Update `tests/acceptance-coverage.md` and, if mutations changed, `tests/mutation-coverage.md` with this feature's rows
- [x] T012 Run `npm run lint`, `npm run typecheck`, `npm run test:functional` and the quickstart validator; all green
- [x] T013 Walk through `specs/012-recurring-readiness-warnings/quickstart.md` on a scratch database (`AI_TASKS_DB_PATH` in a temporary directory) and record the result in the pull request

## Dependencies

010 → US1 → US2.

## Implementation strategy

MVP is US1.
