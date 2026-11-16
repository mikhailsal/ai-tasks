# Tasks: Reasons and notes on occurrence outcomes

**Input**: Design documents from `specs/007-occurrence-reasons-and-notes/` (plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md); constitution v3.2.0.

**Tests**: Required. Constitution Principle VI asks for behavior tests on real databases, with
the failing regression test written before the fix. Test tasks come first in each story.

**Format**: `- [ ] T### [P?] [US#?] Description with file path`. [P] marks a task that touches
other files than the open tasks it could run beside.

**Gate**: implementation starts only after the owner approves it, on branch `007-occurrence-reasons-and-notes`, delivered
through a pull request (constitution v3.2.0).

## Phase 1: Setup

- [x] T001 Baseline green; note whether 004 (blocker shape) and 006 (wording) are merged (stacked on both)

## Phase 2: Foundational

- [x] T002 Write the populated upgrade test from schema 3 in `tests/integration/migration-0004.test.ts` (fails first)
- [x] T003 Add `drizzle/0004_occurrence_reasons.sql` and the columns and CHECKs in `src/schema/recurrence.ts` (data-model.md)
- [x] T004 [P] Add text rules and `missOccurrencesSchema`, `note` on completion items in `src/schema/recurrence-input.ts` with tests in `tests/unit/occurrence-text.test.ts`
- [x] T005 [P] Add optional resource fields in `src/schema/recurrence-query.ts`; make the event diff null-safe in `src/core/recurrence/snapshots.ts`

## Phase 3: User Story 1 - Record a miss with a reason (P1)

**Independent test**: miss with open window → `missed`; later ticks change nothing.

- [x] T006 [P] [US1] Write failing integration tests incl. pending past its window with a stopped worker in `tests/integration/occurrence-miss.test.ts`
- [x] T007 [US1] Implement `missOccurrences` with expiry first (R2, finding E1) in `src/core/recurrence/miss.ts`
- [x] T008 [US1] Add `occurrence miss` in `src/cli/commands/occurrences.ts` and the HTTP route in `src/api/routes/occurrences.ts`
- [x] T009 [P] [US1] Contract tests in `tests/contracts/occurrence-miss-cli.test.ts` and `tests/contracts/occurrence-miss-http.test.ts` (one file: `tests/contracts/occurrence-miss.test.ts`)

## Phase 4: User Story 2 - Add a note to a completion (P1)

- [x] T010 [US2] Store `note` in `src/core/recurrence/complete.ts`; tests in `tests/integration/occurrence-miss.test.ts`
- [x] T011 [US2] Snapshot test: completion without note byte-identical (SC-003) in `tests/contracts/occurrence-miss-cli.test.ts`

## Phase 5: User Story 3 - Close an owed occurrence without calling it done (P2)

- [x] T012 [US3] Regression tests (fail first) of the 11 Nov archive sequence and of the three reported cases of SC-001: declined day with reason, completion at an estimated time with note, owed day closed with reason, in `tests/integration/occurrence-miss.test.ts`
- [x] T013 [US3] Require the reason for debt and carry-forward; keep `missed_at` (R2)
- [x] T014 [US3] Add the `close_as_missed` hint to the owed blocker in `src/core/recurrence/cancel.ts` (FR-009)
- [x] T015 [P] [US3] Two-process race: miss and complete on one occurrence, exactly one wins, in `tests/contention/`

## Phase 6: User Story 4 - People see the same reasons and notes (P2)

- [x] T016 [US4] Show reason and note in `web/src/screens/occurrence-row.tsx` and the CLI human list
- [x] T017 [P] [US4] Playwright test in `tests/e2e/occurrence-reasons.spec.ts` at 430 px, Chromium and WebKit
- [x] T018 [US4] Update `specs/001-ai-task-manager/contracts/{cli,http,common}.md`, `docs/agent-guide.md`, `CHANGELOG.md`

## Final Phase: Polish and acceptance

- [x] T019 Update `tests/acceptance-coverage.md` and, if mutations changed, `tests/mutation-coverage.md` with this feature's rows
- [x] T020 Run `npm run lint`, `npm run typecheck`, `npm run test:functional` and the quickstart validator; all green
- [x] T021 Walk through `specs/007-occurrence-reasons-and-notes/quickstart.md` on a scratch database (`AI_TASKS_DB_PATH` in a temporary directory) and record the result in the pull request

## Dependencies

Foundational → US1 → US2 → US3 → US4. Migration 0004 precedes 008's 0005.

## Implementation strategy

MVP is US1 + US3 (the reported cases); US2 and US4 in the same pull request if small.
