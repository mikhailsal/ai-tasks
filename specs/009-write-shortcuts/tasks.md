# Tasks: Write shortcuts

**Input**: Design documents from `specs/009-write-shortcuts/` (plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md); constitution v3.2.0.

**Tests**: Required. Constitution Principle VI asks for behavior tests on real databases, with
the failing regression test written before the fix. Test tasks come first in each story.

**Format**: `- [ ] T### [P?] [US#?] Description with file path`. [P] marks a task that touches
other files than the open tasks it could run beside.

**Gate**: implementation starts only after the owner approves it, on branch `009-write-shortcuts`, delivered
through a pull request (constitution v3.2.0).

## Phase 1: Setup

- [x] T001 Confirm 004 merged; note whether 007 (`--note`) and 008 (`occurrence_day`) are merged

## Phase 2: Foundational

- [x] T002 Write a test that the strict path of `executeMutation` is unchanged (hash, order) in `tests/integration/shortcuts-parity.test.ts`
- [x] T003 Add the resolve step and hash after resolve: `executeShortcut` in `src/core/database/shortcut.ts` reuses `commitMutation`/`hashCommand` from `src/core/database/mutate.ts` (R1, finding E2)
- [x] T004 [P] Task naming by UUID or reserved icon in `src/core/shortcuts/name-task.ts` with tests

## Phase 3: User Story 1 - Mark an occurrence done by task and day (P1)

- [x] T005 [P] [US1] Failing tests (match, none, several, owed, missed) in `tests/integration/shortcuts-complete.test.ts`
- [x] T006 [US1] Resolver in `src/core/shortcuts/complete-by-day.ts`
- [x] T007 [US1] `occurrence done` in `src/cli/commands/occurrences.ts`

## Phase 4: User Story 2 - Move a task in one step (P1)

- [x] T008 [P] [US2] Failing tests in `tests/integration/shortcuts-move.test.ts`
- [x] T009 [US2] Resolver in `src/core/shortcuts/move.ts`; `task move` in `src/cli/commands/tasks.ts`

## Phase 5: User Story 3 - As safe and visible as the strict form (P1)

- [x] T010 [US3] Repeat, different-data and audit-parity tests in `tests/integration/shortcuts-parity.test.ts`
- [x] T011 [P] [US3] Two-process race (lives in `tests/contracts/shortcuts-cli.test.ts`: it spawns the compiled CLI)
- [x] T012 [US3] CLI contract tests per case table in `tests/contracts/shortcuts-cli.test.ts`
- [x] T013 [US3] 005 descriptors and examples; `README.md`, `docs/agent-guide.md` (epoch caveat), `contracts/cli.md`, `CHANGELOG.md`

## Final Phase: Polish and acceptance

- [x] T014 Update `tests/acceptance-coverage.md` and, if mutations changed, `tests/mutation-coverage.md` with this feature's rows
- [x] T015 Run `npm run lint`, `npm run typecheck`, `npm run test:functional` and the quickstart validator; all green
- [x] T016 Walk through `specs/009-write-shortcuts/quickstart.md` on a scratch database (`AI_TASKS_DB_PATH` in a temporary directory) and record the result in the pull request

## Dependencies

Foundational → US1 and US2 (parallel) → US3.

## Implementation strategy

MVP is US1 with US3's repeat safety; US2 next.
