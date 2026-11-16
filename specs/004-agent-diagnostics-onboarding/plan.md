# Implementation Plan: Agent-ready diagnostics and onboarding

**Feature**: `004-agent-diagnostics-onboarding` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Branch**: `004-agent-diagnostics-onboarding`, to be created from `main` when implementation is
approved; this plan was written on `ci-pr-rule-and-hooks` at `bf8bd62` without code changes.

**Input**: Feature specification `specs/004-agent-diagnostics-onboarding/spec.md` (clarified
2026-11-09 and 2026-11-16); constitution v3.2.0.

## Summary

Refusals start telling a cold agent what to fix, and the README gets it to a first task in at
most five commands. All new machine-readable content goes into the open `error.details`
object (research R1), so codes, exit statuses, HTTP statuses, success responses and stored
data stay unchanged. Core gains a small `diagnostics` module (safe names, hints, bounds);
validation issues carry expectations from the schema; revision guards report every missing
value at once; recurring refusals (cancel, archive, timing-mode change) collect every blocker
with its step; the CLI adapter turns Commander parse errors into named, suggested refusals.
Documentation adds an environment block, the first-task path, an agent guide and a change log,
all executed by the existing quickstart validator.

## Technical Context

**Language/Version**: TypeScript 6.0.3 on Node.js 24.22.0, npm 11.19.1 (pinned, unchanged)

**Primary Dependencies**: commander 15.0.0, Zod 4.6.7 (`zod/mini`), Fastify 5, Drizzle,
better-sqlite3 (all existing); no new dependency

**Storage**: SQLite, unchanged; no migration

**Testing**: Vitest `functional` project (unit, integration on real temporary databases,
compiled-CLI contracts, `fastify.inject()` HTTP contracts); `scripts/validate-quickstart.mjs`
for executed documentation; Playwright browser suites as regression for the web client

**Target Platform**: Linux host; CLI used by AI agents, web UI by the owner

**Project Type**: Local CLI + HTTP API + mobile web UI (single package)

**Performance Goals**: No change to success paths. Refusal paths add at most one grouped
query (blockers) and pure in-memory work; standard CLI p95 goal of 100 ms is unaffected

**Constraints**: FR-019 (no change to codes, statuses, fields, success responses); FR-020 (no
request values, secrets or storage errors); strict envelope schemas; English messages

**Scale/Scope**: about 12 source files changed, 4 new small modules, 4 documents changed,
2 new documents; no web UI change

## Constitution Check

*Gate before research: PASS. Re-checked after design: PASS.*

| Principle / rule | Obligation here | Plan | Verification |
|---|---|---|---|
| I. Thin adapters | Diagnostic rules in core, transport words in adapters | Hints, blockers, missing values, issue enrichment in `src/core/diagnostics/` and existing core modules; CLI maps Commander errors and names CLI flags; HTTP names query keys | Architecture lint (`npm run lint`), review |
| II. Isolation and audit | Refusals leave no state or audit rows; ownership checks stay first | Guard order keeps entity ownership and receipt replay before revision checks (R4); collection code is read-only | Integration tests assert no state or audit change after each new refusal; existing `PROJECT_MISMATCH` tests unchanged |
| III. CLI contract | JSON error on stderr, non-zero exit, stable codes, contract tests for changed behavior | Codes and exits unchanged (contract table); messages and `details` change | Compiled-CLI contract tests per refusal row: stream, exit, code, `details` keys |
| IV. Mobile and offline | No UI change; web keeps working with richer `details` | Web reads `details` only via `safeParse` for specific codes (R1) | Existing Playwright refusal suites; unit test that web error parsing accepts the new `details` |
| V. Functions, types, boundaries | Plain functions, schema-inferred types, `schema <- core <- cli/api` | Detail shapes as Zod schemas in `src/schema/diagnostics.ts`; functions in core; no classes beyond `DomainError` | `npm run typecheck`, `npm run lint` (size and complexity limits) |
| VI. Behavior tests | Proportional tests, real databases, regression first | See verification matrix; every reproduced misleading refusal (FR-012, FR-023) gets a failing test first | `npm run test:functional` |
| VII. Performance | No N+1; bounded work | Blockers from one grouped query per refusal; bounds in `bounds.ts` | Query count assertion in the archive refusal test; `EXPLAIN QUERY PLAN` uses the occurrence task index |
| Compatibility | Public contract changes documented in the same change | `contracts/common.md`, `contracts/cli.md`, `CHANGELOG.md`, agent guide | Quickstart validator; review |
| Privacy | No private data in errors | Safe-name filter; no env values or absolute paths | Unit tests for unsafe names, missing-database message |
| Quality gates (owner rule) | Linters, size limits, CI and pre-push already exist | Existing ESLint limits (400 lines per file, 100 per function, complexity 12, depth 4) apply; no limit raised, no exception added | CI and pre-push hook as configured |

No exception is requested; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/004-agent-diagnostics-onboarding/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/diagnostics.md
├── checklists/requirements.md
└── tasks.md              # next step, $speckit-tasks
```

### Source Code (repository root)

```text
src/schema/diagnostics.ts               # NEW: Zod shapes of Hint, MissingValue, IssueDetail, Blocker
src/core/diagnostics/safe-names.ts      # NEW: R2 filter and bounds
src/core/diagnostics/hints.ts           # NEW: hint constructors, closed action list
src/core/diagnostics/issues.ts          # NEW: R3 issue enrichment (moved out of errors.ts)
src/core/diagnostics/bounds.ts          # NEW: R8 constants and list cutting
src/core/errors.ts                      # normalizeError delegates to issues.ts
src/core/database/guards.ts             # requiredRevisions, one refusal for all missing values
src/core/database/mutate.ts             # merge missing operation_id/database_epoch into the same refusal
src/core/tasks/recurrence-write.ts      # assertRecurrenceSettings keeps only the comparison
src/core/tasks/commands.ts, board.ts    # declare settings: 'recurring' guard
src/core/recurrence/cancel.ts           # collect blockers before the pause check
src/core/recurrence/retirement.ts       # grouped blockers instead of limit(1)
src/core/recurrence/generations.ts      # timing-mode refusal with counts
src/core/projects/migration-plan.ts     # named, de-duplicated preview issues
src/cli/parse-errors.ts                 # NEW: Commander error mapping
src/cli/suggest.ts                      # NEW: nearest known names
src/cli/main.ts, options.ts, context.ts # use the above; scope, unsupported option, missing database
src/api/routes/transport.ts             # HTTP scope refusal names query keys
README.md, docs/agent-guide.md (NEW), CHANGELOG.md (NEW), docs/operations.md
specs/001-ai-task-manager/quickstart.md, contracts/cli.md, contracts/common.md
scripts/validate-quickstart.mjs         # execute README path and guide recipes
tests/unit/diagnostics-*.test.ts, tests/unit/cli-parse-errors.test.ts, tests/unit/suggest.test.ts
tests/integration/recurring-refusals.test.ts, tests/integration/missing-revisions.test.ts
tests/contracts/diagnostics-cli.test.ts, tests/contracts/diagnostics-http.test.ts
```

**Structure Decision**: single package, existing layering. Diagnostics are core because both
transports use them; flag and query-key wording stays in adapters.

## Verification matrix

| Spec outcome | Test | Mechanism | Budget |
|---|---|---|---|
| US1, FR-001 to FR-003, SC-001, SC-005 | README environment block and first-task path executed; count commands | `validate-quickstart.mjs` on a scratch database | CI quickstart step |
| US2-1, FR-004 | CLI and HTTP read without scope name both choices | Compiled CLI; `fastify.inject()` | 10 s per case |
| US2-2/3, FR-005 | Fixed set lists values; status names `config get` | Unit on `normalizeError`; CLI contract | default |
| US2-4, FR-006 | Type, union and discriminator expectations | Unit with real schemas (`taskCreateSchema`, `scheduleSchema`) | default |
| US2-5, FR-007, SC-003 | Recurring create missing two revisions: one refusal lists both; ordinary transition missing one; replayed `operation_id` still returns its receipt | Integration on temporary database; compiled CLI | default |
| US2-6, FR-008, FR-020 | Unknown keys repeated in safe form; unsafe and 11th names counted, not repeated; no values | Unit on `safeNames`, CLI contract | default |
| FR-009 | Every new hint present in `message` and `details` | Unit across refusal builders | default |
| FR-010, FR-011 | Unsupported option named with supported list; mistyped command and option suggest nearest names | Unit on `suggest`; compiled CLI | default |
| US3-1, FR-012 | Cancel owed while active: owed reason first, no pause advice; no state or audit change | Integration, regression first | default |
| US3-2, FR-013 | Preview names mapping and stored key, no duplicates, points to required mappings | Integration on populated project | default |
| US3-3, FR-014 | Missing database message, exit 1, no absolute path | Compiled CLI with empty working directory | default |
| US3-4, FR-015 | Timing-mode refusal with pending and owed counts | Integration | default |
| US3-5/6, FR-023, SC-006 | Archive refusal lists all blockers in step order with existing keys kept; multi-cancel lists every row; one grouped query | Integration, regression first, query counter | default |
| US4, FR-016, FR-017 | Guide recipes run; documents agree on past first deadlines, double config revision, unused mappings | Quickstart validator; review | CI quickstart step |
| US5, FR-018 | CHANGELOG lists each agent-visible change | Review checklist in tasks | none |
| FR-019, SC-004 | Existing contract and browser suites green; codes, exits, HTTP statuses, success bodies unchanged | `npm run test:functional`, `npm run test:e2e` | existing budgets |
| FR-021 | Every list cut at its bound with an omitted count | Unit on `bounds` and builders | default |
| FR-022 | One recorded cold-agent walkthrough | Manual, in the acceptance report | not automated |

Mutation coverage: success state and audit changes are N/A because no mutation changes its
successful behavior; the existing suites cover them. Validation failures apply and are the
subject of this feature. Ownership rejection applies to the guard reorder (R4) and keeps its
existing tests plus one asserting it still wins over missing revisions. Rollback applies: every
new refusal asserts no state or audit change. Contention is N/A: no transaction or lock change.
Regression first applies to FR-012 and FR-023 (reproduced on 2026-11-09 and 2026-11-16).

## Migration and recovery

None. No schema, stored data or configuration change. Rolling back is reverting the change;
clients that started reading the new `details` keys must tolerate their absence, which the
agent guide states.

## Order of work

0. Quality gates written down (owner rule, review finding E6): the repository has the gates
   (ESLint `max-lines` 400 and `max-lines-per-function` 100 for source, 150 for web `.tsx`
   functions, 700 and 250 for tests; CI; `.githooks/pre-push`) but no project `CLAUDE.md` that
   states the limits and the commands that check them. Add it first, docs only, with the lint
   command (`npm run lint`) and the hook installer (`npm run hooks:install`). Limits are not changed.
1. Diagnostics module and schemas (R1, R2, R8), with unit tests.
2. Issue enrichment (R3) and missing revisions (R4).
3. CLI parse errors, scope and unsupported option (R5); HTTP scope.
4. Recurring blockers (R6), preview issues and missing database (R7).
5. Documentation, change log and validator (R9); walkthrough (FR-022).

Steps 1 to 4 are one pull request or a stack of small ones; step 5 ships in the same change as
the behavior it describes (constitution, Compatibility).

## Dependencies on other specifications

- 005 (self-describing commands) reuses the hint and missing-value shapes; 004 ships first.
- 007 adds the `close_as_missed` step to the owed blocker (contracts/diagnostics.md).

## Complexity Tracking

No exceptions.
