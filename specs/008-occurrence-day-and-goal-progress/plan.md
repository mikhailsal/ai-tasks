# Implementation Plan: Occurrence day and goal progress

**Feature**: `008-occurrence-day-and-goal-progress` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Branch**: `008-occurrence-day-and-goal-progress`, created when implementation is approved,
after 007 (migration order). Planned on `ci-pr-rule-and-hooks` at `bf8bd62` without code
changes.

**Input**: `specs/008-occurrence-day-and-goal-progress/spec.md`; constitution v3.2.0.

## Summary

Add a project day-start hour, a stored `occurrence_day` written once at materialization (and
backfilled for old rows by an idempotent code step), declared value kinds on recurring tasks
with recorded values on completion, and an `occurrence progress` read that counts outcomes over
a window of days by one grouped query. Web shows day, filter, values and progress, read-only.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Node.js 24.22.0 (unchanged)

**Primary Dependencies**: Drizzle, better-sqlite3, Zod 4.6.7, `@js-temporal/polyfill`
(existing), Fastify 5, commander 15, React; none added

**Storage**: SQLite migration `0005_occurrence_day.sql` + backfill step in `migrateDatabase`

**Testing**: Vitest unit (day function boundary table), integration on real databases
(materialization, backfill, values, progress), compiled-CLI and HTTP contracts, Playwright

**Target Platform**: Linux host; CLI for agents; mobile web for the owner

**Project Type**: Local CLI + HTTP API + web UI

**Performance Goals**: progress p95 within the standard read goal on the existing benchmark
dataset (index on `(task_id, occurrence_day)`); backfill of 100,000 occurrences under 10 s
(goal)

**Constraints**: stored days never rewritten; no new required input; additions announced

**Scale/Scope**: 1 migration, 1 backfill step, 1 new read, 4 changed inputs, web additions

## Constitution Check

*Gate before research: PASS. Re-checked after design: PASS.*

| Principle / rule | Obligation here | Plan | Verification |
|---|---|---|---|
| I. Thin adapters | Day rule and progress in core | `src/core/recurrence/day.ts`, `src/core/queries/progress.ts` | Lint import rules |
| II. Isolation and audit | Project-scoped reads and writes; audited changes | Progress uses project-scoped task lookup; project update and configure audited as today | Integration: other project's task → `PROJECT_MISMATCH`; audit rows |
| III. CLI contract | New read with contract tests | `occurrence progress` | Compiled-CLI tests |
| IV. Mobile and offline | Read-only additions; cached reads offline as today | Progress block and filter at 430 px | Playwright Chromium + WebKit, offline cached view |
| V. Types | Zod for inputs, Drizzle for rows | Value kinds as a discriminated schema | Typecheck |
| VI. Behavior tests | Regression first N/A (new capability); boundary table | Matrix below | `npm run test:functional` |
| VII. Performance | Bounded queries; no N+1 | One grouped query; window max 366 days; backfill in batches | Benchmark entry for progress; backfill timing test (goal) |
| Compatibility | Versioned migration, populated upgrade, docs | `0005` + backfill test from populated schema 4; contracts, guide, CHANGELOG | Upgrade test |
| Privacy | No new private data in errors | Value refusals name fields and kinds, not values | Unit |
| Quality gates (owner rule) | Existing gates | No limit changes | CI, pre-push |

## Project Structure

```text
specs/008-occurrence-day-and-goal-progress/ plan.md research.md data-model.md quickstart.md
  contracts/day-values-progress.md
drizzle/0005_occurrence_day.sql                      # NEW
src/core/database/migrate.ts                         # backfill step
src/core/recurrence/day.ts                           # NEW: occurrenceDay(deadline, zone, hour)
src/core/recurrence/snapshots.ts                     # write occurrence_day; resource fields
src/core/recurrence/values.ts                        # NEW: declarations and value validation
src/core/recurrence/complete.ts, control.ts          # values on completion; declarations on configure
src/core/projects/<update>                           # day_start_hour
src/core/queries/progress.ts                         # NEW
src/core/queries/recurrence.ts                       # day filters
src/schema/{entities,recurrence,recurrence-input,recurrence-query,projects}.ts
src/cli/commands/occurrences.ts                      # occurrence progress; filters
src/api/routes/<occurrence routes>                   # progress route; filters
web/src/screens/{Occurrences.tsx,occurrence-row.tsx}, web/src/screens/occurrence-progress.tsx (NEW)
tests/unit/occurrence-day.test.ts, tests/integration/{occurrence-day,occurrence-values,occurrence-progress,migration-0005}.test.ts
tests/contracts/occurrence-progress-{cli,http}.test.ts, tests/e2e/occurrence-progress.spec.ts
```

## Verification matrix

| Spec outcome | Test | Mechanism |
|---|---|---|
| US1-1/2/3, SC-001 | Boundary table of 12 cases incl. 23 and 25 hour days | Unit on `occurrenceDay` |
| US1-5, FR-003 | Rule change leaves stored days unchanged | Integration |
| FR-002 | Day filters return exactly the matching rows | Integration + contracts |
| Backfill | Populated upgrade fills all days; rerun changes nothing | Integration |
| US2-1/3, FR-004/5 | Values stored, optional, shown in CLI human mode and web | Integration, CLI test, Playwright |
| US2-2/4, FR-006 | Wrong kind and undeclared name refused with declared list | Integration + contract |
| US3-1/2/3, FR-007, SC-002 | Prepared windows match manual counts; open separate; empty 0 of 0 | Integration |
| US3-4, FR-008 | Web progress equals CLI result for the same window | Playwright against the same data |
| FR-009, SC-004 | Existing contract suites green; snapshots differ only by announced additions | Contract snapshot comparison |

Mutation coverage: success and audit (project update, configure, complete with values); validation
failures; ownership (`PROJECT_MISMATCH`); rollback (batch completion with one invalid value writes
nothing). Contention: existing occurrence race suite; no new shared-row path.

## Migration and recovery

Forward: `0005` adds columns and index; backfill fills days. Rollback: previous binary refuses a
newer schema; restore the pre-upgrade backup (`docs/compatibility.md`).

## Dependencies

- 007 first (migration `0004`).
- 009 names occurrences by day; it uses `occurrence_day` once this ships.
- 005: new and changed commands get descriptors and examples.

## Complexity Tracking

No exceptions.
