# Tasks: Advisory warnings

**Input**: Design documents from `specs/010-advisory-warnings/` (plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md); constitution v3.2.0.

**Tests**: Required. Constitution Principle VI asks for behavior tests on real databases, with
the failing regression test written before the fix. Test tasks come first in each story.

**Format**: `- [ ] T### [P?] [US#?] Description with file path`. [P] marks a task that touches
other files than the open tasks it could run beside.

**Gate**: implementation starts only after the owner approves it, on branch `010-advisory-warnings`, delivered
through a pull request (constitution v3.2.0).

## Phase 1: Setup

- [x] T001 Plan the pull request together with 011 or 012 (first provider): shipped with 012 in one pull request

## Phase 2: Foundational

- [x] T002 [P] Advisory schema in `src/schema/advisories.ts`; optional keys in `src/schema/envelopes.ts`
- [x] T003 [P] Catalogue in `src/core/advisories/catalogue.ts` and `docs/advisories.md`; parity unit test in `tests/unit/advisories.test.ts`
- [x] T004 `collectAdvisories` with bound, order, aggregation and failure isolation in `src/core/advisories/collect.ts`

## Phase 3: User Story 1 - An advisory next to a successful result (P1)

- [x] T005 [P] [US1] Integration tests with the first real provider in `tests/integration/readiness-advisories.test.ts`; collector tests with test providers in `tests/unit/advisories.test.ts`
- [x] T006 [US1] Attach advisories after reads and committed mutations (also on replay): one place per adapter, `src/cli/context.ts` (`withCliDatabase`) and `src/api/data-helper.ts`, through `src/core/advisories/attach.ts`

## Phase 4: User Story 4 - Existing clients are not broken (P1)

- [x] T007 [US4] Absent-key tests (exact keys `ok`, `data`, `meta`) for CLI and HTTP in `tests/contracts/readiness-advisories.test.ts`
- [x] T008 [US4] Accept the keys in every schema built from the envelopes, including web schemas
- [x] T009 [US4] `CHANGELOG.md` and `docs/compatibility.md` announcement; `docs/agent-guide.md`

## Phase 5: User Story 2 - Persistent conditions on every read (P1)

- [x] T010 [US2] Test present while the condition holds and gone after, in `tests/integration/advisories.test.ts`

## Phase 6: User Story 3 - People see the same advisories (P2)

- [x] T011 [US3] Human-mode stderr lines in `src/cli/io.ts`
- [x] T012 [US3] `web/src/components/AdvisoryNotice.tsx` (neutral style, max 2 then «ещё N», cached time offline)
- [x] T013 [P] [US3] Playwright test in `tests/e2e/advisories.spec.ts`

## Final Phase: Polish and acceptance

- [x] T014 Update `tests/acceptance-coverage.md` and, if mutations changed, `tests/mutation-coverage.md` with this feature's rows
- [x] T015 Run `npm run lint`, `npm run typecheck`, `npm run test:functional` and the quickstart validator; all green
- [x] T016 Walk through `specs/010-advisory-warnings/quickstart.md` on a scratch database (`AI_TASKS_DB_PATH` in a temporary directory) and record the result in the pull request

## Dependencies

004 (hint shape) → Foundational → US1 → US4 → US2 → US3. Ships with the first provider.

## Implementation strategy

One pull request with 011 or 012.
