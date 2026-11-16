# Tasks: Worker liveness

**Input**: Design documents from `specs/011-worker-liveness/` (plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md); constitution v3.2.0.

**Tests**: Required. Constitution Principle VI asks for behavior tests on real databases, with
the failing regression test written before the fix. Test tasks come first in each story.

**Format**: `- [ ] T### [P?] [US#?] Description with file path`. [P] marks a task that touches
other files than the open tasks it could run beside.

**Gate**: implementation starts only after the owner approves it, on branch `011-worker-liveness`, delivered
through a pull request (constitution v3.2.0).

## Phase 1: Setup

- [x] T001 Confirm 010 merged or in the same pull request; 008 merged (migration order): stacked on the 010+012 pull request; 0005 precedes 0006

## Phase 2: Foundational

- [x] T002 Populated upgrade test in `tests/integration/migration-0006.test.ts`
- [x] T003 `drizzle/0006_worker_passes.sql` and `src/schema/worker.ts`
- [x] T004 [P] Status function and tolerance in `src/core/worker/status.ts`; clock-step tests in `tests/integration/worker-status.test.ts`

## Phase 3: User Story 1 - Anyone can tell whether the worker is alive (P1)

- [x] T005 [P] [US1] Process test never → healthy → stale → healthy on a scratch database in `tests/integration/worker-process.test.ts`
- [x] T006 [US1] Throttled pass record in `src/core/worker/record-pass.ts`, called from `src/cli/worker-data.ts`
- [x] T007 [US1] Status in `meta` and project resources (`src/core/queries/meta.ts`, `src/core/queries/projects.ts`); schemas in `src/schema/worker-status.ts`

## Phase 4: User Story 2 - Dependent reads say they may be incomplete (P1)

- [x] T008 [US2] Regression test of the 8 Nov case (fails first) in `tests/integration/worker-status.test.ts`
- [x] T009 [US2] Provider `worker_stale` / `worker_never_ran` with remedy «start the service» in `src/core/advisories/providers/worker.ts`
- [x] T010 [P] [US2] Contract tests in `tests/contracts/worker-status-cli.test.ts` and `tests/contracts/worker-status-http.test.ts`

## Phase 5: User Story 3 - People see the same warning (P2)

- [x] T011 [US3] Badge on the project list (`Projects.tsx`), notice on the project (`ProjectDetail.tsx`), the task (`TaskDetail.tsx`) and occurrences (`Occurrences.tsx`); component `web/src/components/WorkerStatus.tsx`
- [x] T012 [P] [US3] Playwright test in `tests/e2e/worker-notice.spec.ts`
- [x] T013 [US3] `docs/agent-guide.md` (running the service), `docs/advisories.md`, `CHANGELOG.md`

## Final Phase: Polish and acceptance

- [x] T014 Update `tests/acceptance-coverage.md` and, if mutations changed, `tests/mutation-coverage.md` with this feature's rows
- [x] T015 Run `npm run lint`, `npm run typecheck`, `npm run test:functional` and the quickstart validator; all green
- [x] T016 Walk through `specs/011-worker-liveness/quickstart.md` on a scratch database (`AI_TASKS_DB_PATH` in a temporary directory) and record the result in the pull request

## Dependencies

010 → Foundational → US1 → US2 → US3.

## Implementation strategy

MVP is US1 + US2.
