# Tasks: Self-describing commands

**Input**: Design documents from `specs/005-self-describing-commands/` (plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md); constitution v3.2.0.

**Tests**: Required. Constitution Principle VI asks for behavior tests on real databases, with
the failing regression test written before the fix. Test tasks come first in each story.

**Format**: `- [ ] T### [P?] [US#?] Description with file path`. [P] marks a task that touches
other files than the open tasks it could run beside.

**Gate**: implementation starts only after the owner approves it, on branch `005-self-describing-commands`, delivered
through a pull request (constitution v3.2.0).

## Phase 1: Setup

- [x] T001 Confirm 004 is merged (`requiredRevisions`, hint shape, `src/cli/suggest.ts` present) (stacked on the 004 branch; merged in order with the PR chain)
- [x] T002 Record the human help snapshot of the previous build in `tests/fixtures/help-human-snapshot.txt`

## Phase 2: Foundational

- [x] T003 [P] Define `CommandDescriptor` in `src/cli/registry/types.ts` (data-model.md)
- [x] T004 [P] Write unit tests for schema flattening in `tests/unit/flatten-schema.test.ts`
- [x] T005 Implement `toJSONSchema` flattening with timestamp override in `src/cli/registry/flatten-schema.ts` (R2)
- [x] T006 Export guard requirement constants from core mutations under `src/core/` and use them in their `executeMutation` calls (R3) (one table `src/core/database/mutation-requirements.ts`, read by operation name)
- [x] T007 Implement Commander registration from descriptors in `src/cli/registry/register.ts` (cheaper variant taken, see research.md R1 implementation note: registration stays in `src/cli/commands/*.ts`, options read from descriptors, coverage test guards agreement)

## Phase 3: User Story 1 - An agent asks one command how to use it (P1)

**Independent test**: `help occurrence complete --json` lists fields, four revision values with sources and an example.

- [x] T008 [P] [US1] Write failing contract tests for leaf help in `tests/contracts/help.test.ts`
- [x] T009 [US1] Implement `describe` (fields, revisions, input forms, scope) in `src/cli/registry/describe.ts`
- [x] T010 [US1] Add descriptors per family in `src/cli/registry/<family>.ts` and move registration of `src/cli/commands/*.ts` onto them (descriptors in `src/cli/registry/families/`)
- [x] T011 [US1] Add `help [command...] --json` in `src/cli/main.ts` without database access (FR-009)

## Phase 4: User Story 2 - The help cannot disagree with the real behavior (P1)

- [x] T012 [P] [US2] Build named fixture states in `tests/fixtures/help-fixtures.ts` (R5)
- [x] T013 [US2] Write the example runner with read and generated placeholders in `tests/contracts/help-examples.test.ts`
- [x] T014 [US2] Implement the checker (coverage, revision drop, field drop, unknown field, determinism) and its fault-injection test in `tests/unit/help-checker.test.ts` (R6) (checker in `tests/fixtures/help-checker.ts`, fault injection in `tests/contracts/help-checker.test.ts`)

## Phase 5: User Story 3 - An agent finds the right command (P2)

- [x] T015 [US3] Whole-interface index and family help, unknown names with suggestions, in `src/cli/main.ts`

## Phase 6: User Story 4 - Help and rejections tell the same story (P2)

- [x] T016 [US4] Assert that a mutation's refusal `missing[].source` equals its help `revisions[].source` in `tests/contracts/help.test.ts`
- [x] T017 [US4] Snapshot test: human help byte-identical to `tests/fixtures/help-human-snapshot.txt`
- [x] T018 [US4] Document `help --json` in `specs/001-ai-task-manager/contracts/cli.md`, `README.md`, `docs/agent-guide.md` and `CHANGELOG.md`

## Final Phase: Polish and acceptance

- [x] T019 Update `tests/acceptance-coverage.md` and, if mutations changed, `tests/mutation-coverage.md` with this feature's rows
- [x] T020 Run `npm run lint`, `npm run typecheck`, `npm run test:functional` and the quickstart validator; all green
- [ ] T021 Walk through `specs/005-self-describing-commands/quickstart.md` on a scratch database (`AI_TASKS_DB_PATH` in a temporary directory) and record the result in the pull request

## Dependencies

004 merged → Setup → Foundational → US1 → US2 → US3 → US4 → Polish. Every later feature adds
descriptors and examples for its commands; T014's coverage check enforces it.

## Parallel examples

T003 and T004; T008 and T012.

## Implementation strategy

MVP is US1 + US2 together (help without the checks would drift).
