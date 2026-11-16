# Tasks: Late-recording label

**Input**: Design documents from `specs/006-late-recording-label/` (plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md); constitution v3.2.0.

**Tests**: Required. Constitution Principle VI asks for behavior tests on real databases, with
the failing regression test written before the fix. Test tasks come first in each story.

**Format**: `- [ ] T### [P?] [US#?] Description with file path`. [P] marks a task that touches
other files than the open tasks it could run beside.

**Gate**: implementation starts only after the owner approves it, on branch `006-late-recording-label`, delivered
through a pull request (constitution v3.2.0).

## Phase 1: Setup

- [x] T001 Baseline: `npm run test:functional` and `npm run test:e2e -- read-views` green

## Phase 2: User Story 1 - A person reads an honest label (P1)

**Independent test**: a completion recorded after its window shows «Записано после окна» in web and CLI.

- [x] T002 [P] [US1] Change the expectation in `tests/e2e/read-views.spec.ts:214` to the new wording (fails first)
- [x] T003 [P] [US1] Write `tests/unit/occurrence-wording.test.ts` for the label table, the CLI summary line and the old-wording search
- [x] T004 [US1] Change `completed_late` label in `web/src/screens/occurrence-model.ts:61`
- [x] T005 [US1] Change the summary line in `src/cli/command-helpers.ts:151`

## Phase 3: User Story 2 - The machine-readable meaning does not move (P1)

- [x] T006 [US2] Add the meaning sentence to `specs/001-ai-task-manager/contracts/common.md`, `docs/agent-guide.md` (if 004 merged) and `CHANGELOG.md`
- [x] T007 [US2] Confirm existing contract suites unchanged (SC-002)

## Final Phase: Polish and acceptance

- [x] T008 Update `tests/acceptance-coverage.md` and, if mutations changed, `tests/mutation-coverage.md` with this feature's rows
- [x] T009 Run `npm run lint`, `npm run typecheck`, `npm run test:functional` and the quickstart validator; all green
- [x] T010 Walk through `specs/006-late-recording-label/quickstart.md` on a scratch database (`AI_TASKS_DB_PATH` in a temporary directory) and record the result in the pull request

## Dependencies

Independent of other features. US1 before US2.

## Implementation strategy

One small pull request.
