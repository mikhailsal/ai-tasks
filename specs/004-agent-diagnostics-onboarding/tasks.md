# Tasks: Agent diagnostics and onboarding

**Input**: Design documents from `specs/004-agent-diagnostics-onboarding/` (plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md); constitution v3.2.0.

**Tests**: Required. Constitution Principle VI asks for behavior tests on real databases, with
the failing regression test written before the fix. Test tasks come first in each story.

**Format**: `- [ ] T### [P?] [US#?] Description with file path`. [P] marks a task that touches
other files than the open tasks it could run beside.

**Gate**: implementation starts only after the owner approves it, on branch `004-agent-diagnostics-onboarding`, delivered
through a pull request (constitution v3.2.0).

## Phase 1: Setup

- [ ] T001 Add project `CLAUDE.md` stating the existing limits (source 400 lines per file and 100 per function, web `.tsx` functions 150, tests 700 and 250) and the commands `npm run lint` and `npm run hooks:install`; limits unchanged (review finding E6)
- [ ] T002 Record a baseline: `npm run lint` and `npm run test:functional` green on the branch point

## Phase 2: Foundational (blocks US2 to US5)

- [ ] T003 [P] Add Hint, MissingValue, IssueDetail and Blocker Zod shapes in `src/schema/diagnostics.ts` (data-model.md)
- [ ] T004 [P] Write unit tests for safe-name filtering and list bounds in `tests/unit/diagnostics-safe-names.test.ts`
- [ ] T005 [P] Implement safe-name filter (R2) in `src/core/diagnostics/safe-names.ts`
- [ ] T006 [P] Implement bounds constants and list cutting with omitted counts (R8) in `src/core/diagnostics/bounds.ts`
- [ ] T007 Implement hint constructors with the closed action list (R1) in `src/core/diagnostics/hints.ts`
- [ ] T008 [P] Implement nearest-name suggestions (Damerau-Levenshtein, R5) in `src/cli/suggest.ts` with tests in `tests/unit/suggest.test.ts`

## Phase 3: User Story 2 - A rejected request says exactly what to fix (P1)

**Independent test**: each refusal row of `contracts/diagnostics.md` returns its listed `details` additions.

- [ ] T009 [P] [US2] Write failing contract tests for scope, value, shape, missing revisions, unknown names and unsupported option in `tests/contracts/diagnostics-cli.test.ts`
- [ ] T010 [P] [US2] Write failing HTTP contract tests for the same rows in `tests/contracts/diagnostics-http.test.ts`
- [ ] T011 [P] [US2] Write failing integration tests for all missing revision values at once in `tests/integration/missing-revisions.test.ts`
- [ ] T012 [P] [US2] Write the SC-002 suite: 12 rejected requests covering FR-004 to FR-015, each corrected only from its refusal's `details` and retried until success, in `tests/contracts/diagnostics-correction.test.ts`
- [ ] T013 [US2] Move issue enrichment into `src/core/diagnostics/issues.ts` and delegate from `normalizeError` in `src/core/errors.ts` (R3)
- [ ] T014 [US2] Add `requiredRevisions` and one refusal for every missing value in `src/core/database/guards.ts` (R4)
- [ ] T015 [US2] Merge missing `operation_id` and `database_epoch` into the same refusal in `src/core/database/mutate.ts`
- [ ] T016 [US2] Declare the `settings: 'recurring'` guard in `src/core/tasks/commands.ts` and `src/core/tasks/board.ts`; keep only the comparison in `src/core/tasks/recurrence-write.ts`
- [ ] T017 [US2] Map Commander errors (unknown command, unknown option, unsupported option) in `src/cli/parse-errors.ts` and wire it in `src/cli/main.ts` and `src/cli/options.ts`
- [ ] T018 [US2] Name both scope choices in CLI (`src/cli/options.ts`) and HTTP (`src/api/routes/transport.ts`)

## Phase 4: User Story 1 - A cold agent creates its first task from the README alone (P1)

**Independent test**: `scripts/validate-quickstart.mjs` executes the README path on a fresh temporary database.

- [ ] T019 [US1] Report a missing database with how the location is chosen, the default and the next step in `src/cli/context.ts` (FR-014)
- [ ] T020 [US1] Rewrite the first-task path and the environment block in `README.md` (FR-001 to FR-003)
- [ ] T021 [US1] Extend `scripts/validate-quickstart.mjs` to execute the README path in the CI step

## Phase 5: User Story 3 - Misleading refusals name the real rule (P2)

**Independent test**: the 11 Nov archive sequence and the owed-cancel case return every blocker in one refusal.

- [ ] T022 [P] [US3] Write failing regression tests (11 Nov case first) in `tests/integration/recurring-refusals.test.ts`
- [ ] T023 [US3] Collect cancel blockers before the pause check in `src/core/recurrence/cancel.ts` (R6, FR-012)
- [ ] T024 [US3] Replace `limit(1)` with grouped blockers in `src/core/recurrence/retirement.ts` (FR-023)
- [ ] T025 [US3] Timing-mode refusal with blocking counts in `src/core/recurrence/generations.ts` (FR-015)
- [ ] T026 [US3] Named, de-duplicated preview issues in message text in `src/core/projects/migration-plan.ts` (R7, FR-013)

## Phase 6: User Story 4 - Recipes for the jobs agents actually do (P2)

- [ ] T027 [US4] Write `docs/agent-guide.md` with the revision-source table and recipes, and fix contradictions in `specs/001-ai-task-manager/contracts/cli.md`, `contracts/common.md` and `quickstart.md` (FR-016, FR-017)
- [ ] T028 [US4] Execute the guide recipes in `scripts/validate-quickstart.mjs`

## Phase 7: User Story 5 - Agents can see what changed (P3)

- [ ] T029 [US5] Create `CHANGELOG.md` listing every agent-visible change of this feature (FR-018)

## Final Phase: Polish and acceptance

- [ ] T030 Update `tests/acceptance-coverage.md` and, if mutations changed, `tests/mutation-coverage.md` with this feature's rows
- [ ] T031 Run `npm run lint`, `npm run typecheck`, `npm run test:functional` and the quickstart validator; all green
- [ ] T032 Walk through `specs/004-agent-diagnostics-onboarding/quickstart.md` on a scratch database (`AI_TASKS_DB_PATH` in a temporary directory) and record the result in the pull request
- [ ] T033 Record the cold-agent walkthrough (FR-022) in the pull request

## Dependencies

Setup → Foundational → US2 → US1 → US3 → US4 → US5 → Polish. US3 needs the Blocker shape (T003).
US4 documents behavior from US2 and US3. 005 starts after this feature merges.

## Parallel examples

- T003, T004, T005, T006, T008 together.
- T009, T010, T011, T012 together, then T013 to T018 in order.

## Implementation strategy

MVP is T001 to T018 (precise refusals); the README path (US1) follows in the same pull request
because its validator exercises US2.
