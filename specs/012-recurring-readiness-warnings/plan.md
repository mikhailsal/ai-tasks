# Implementation Plan: Recurring readiness warnings

**Feature**: `012-recurring-readiness-warnings` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Branch**: `012-recurring-readiness-warnings`, created when implementation is approved; with or
after 010. Planned on `ci-pr-rule-and-hooks` at `bf8bd62` without code changes.

**Input**: `specs/012-recurring-readiness-warnings/spec.md`; constitution v3.2.0; 010 decision of
2026-11-16.

## Summary

A 010 advisory provider flags recurring tasks that generate nothing (draft status category), on create and on every read, excluding deliberate states. Calendar schedules
accept an omitted `local_time`, derived in core from the first deadline in the schedule's time
zone; a differing pair is accepted as today with a mismatch advisory.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Node.js 24.22.0 (unchanged)

**Primary Dependencies**: Zod 4.6.7, `@js-temporal/polyfill`, Drizzle; none added

**Storage**: unchanged

**Testing**: Vitest unit (derivation incl. DST days), integration on real databases (provider
conditions, configure path), contracts, Playwright

**Target Platform**: CLI, HTTP, mobile web

**Project Type**: Local CLI + HTTP API + web UI

**Performance Goals**: provider uses data already loaded for task resources plus at most one
bounded query per response (goal)

**Constraints**: nothing accepted today becomes rejected; stored schedule shape unchanged

**Scale/Scope**: 1 schema relaxation, 1 derivation function, 1 provider with 3 codes, catalogue
entries, web notice reuse

## Constitution Check

*Gate before research: PASS. Re-checked after design: PASS.*

| Principle / rule | Obligation here | Plan | Verification |
|---|---|---|---|
| I. Thin adapters | Derivation and conditions in core | `src/core/recurrence/derive-local-time.ts`, `src/core/advisories/providers/readiness.ts` | Lint import rules |
| II. Isolation and audit | Same audit as today for create and configure | Stored schedule contains the derived value, so the audit shows it | Integration on audit changes |
| III. CLI contract | Contract tests for new optionality and advisories | Contracts | Compiled-CLI and HTTP tests |
| IV. Mobile and offline | Notice on the task | 010 component | Playwright 430 px |
| V. Types | Input type with optional `local_time`; stored type keeps it required | Separate input and stored schedule types | Typecheck |
| VI. Behavior tests | Regression first: the 3 Nov draft case written first | Matrix below | `npm run test:functional` |
| VII. Performance | Bounded provider | Uses loaded task and recurrence state | Benchmark comparison (goal) |
| Compatibility | Relaxation only; announced advisories | CHANGELOG, contracts, guide | Existing suites green |
| Privacy | No raw request text in advisories | Times read back from stored values (R3, flagged for review) | Unit |
| Quality gates (owner rule) | Existing gates | None changed | CI, pre-push |

## Project Structure

```text
specs/012-recurring-readiness-warnings/ plan.md research.md data-model.md quickstart.md contracts/readiness.md
src/schema/recurrence-input.ts                     # optional local_time in input
src/core/recurrence/derive-local-time.ts           # NEW
src/core/recurrence/control.ts, src/core/tasks/<create>   # call derivation before publishGeneration
src/core/advisories/providers/readiness.ts         # NEW
docs/advisories.md, docs/agent-guide.md, specs/001-ai-task-manager/contracts/common.md, CHANGELOG.md
tests/unit/derive-local-time.test.ts, tests/integration/readiness-advisories.test.ts
tests/contracts/readiness-{cli,http}.test.ts, tests/e2e/readiness-notice.spec.ts
```

## Verification matrix

| Spec outcome | Test | Mechanism |
|---|---|---|
| US1-1/2, FR-001, SC-001 | Draft create and reads carry the advisory | Integration + contracts |
| US1-3, FR-003 | Gone after activation | Integration |
| US1-4, FR-002 | Paused, archived, terminal: none | Integration |
| Edge: active `after_completion` waiting on its predecessor | No advisory | Integration |
| US1-5, FR-004, SC-004 | Web notice | Playwright |
| US2-1, FR-005, SC-002 | Derived value stored and shown | Unit (incl. DST days) + integration |
| US2-2/3, FR-006 | Equal as today; different accepted with mismatch advisory | Integration |
| US2-4, FR-007 | Today's rejections unchanged | Existing suites |
| FR-008, SC-003 | Existing suites green | Contracts |

Mutation coverage: create and configure keep their existing coverage; added cases for derivation
success and audit content. Contention N/A (no new shared row).

## Migration and recovery

None.

## Dependencies

- 010 (mechanism, catalogue, web notice).
- 005: help shows `local_time` as optional with the derivation note.

## Complexity Tracking

No exceptions.
