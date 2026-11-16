# Implementation Plan: Worker liveness

**Feature**: `011-worker-liveness` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Branch**: `011-worker-liveness`, created when implementation is approved; ships with or after
010. Planned on `ci-pr-rule-and-hooks` at `bf8bd62` without code changes.

**Input**: `specs/011-worker-liveness/spec.md`; constitution v3.2.0.

## Summary

The worker records its last completed pass per project in a one-row-per-project table, at most
once a minute, also when there was nothing to do. Status (`healthy`, `stale` after 5 minutes,
`never`) is computed on read and shown in `meta`, project resources, as a 010 advisory on reads
that depend on the worker, and as a web notice.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Node.js 24.22.0 (unchanged)

**Primary Dependencies**: Drizzle, better-sqlite3, Fastify 5, commander 15, React; none added

**Storage**: SQLite migration `0006_worker_passes.sql`

**Testing**: Vitest integration with injected clock; process test starting and stopping a
worker on a scratch database; contracts; Playwright

**Target Platform**: Linux host; CLI, HTTP, mobile web

**Project Type**: Local CLI + HTTP API + web UI

**Performance Goals**: one primary-key upsert per minute per worker; status read is one indexed
select per response

**Constraints**: no side effects on read; not audited; excluded from `read_revision`

**Scale/Scope**: 1 table, worker callback change, status function, 1 advisory provider, meta and
project resource additions, web badge and notice

## Constitution Check

*Gate before research: PASS. Re-checked after design: PASS.*

| Principle / rule | Obligation here | Plan | Verification |
|---|---|---|---|
| I. Thin adapters | Status rule in core | `src/core/worker/status.ts`; runtime only calls `recordPass` | Lint import rules |
| II. Isolation and audit | Project-scoped; audit for domain changes | Row keyed by project; operational state explicitly not audited (R1) | Integration: other project's status unaffected; review of the audit exception |
| III. CLI contract | Additions with contract tests | `meta`, project resources | Compiled-CLI tests |
| IV. Mobile and offline | Notice visible; offline shows cached status with its time | Badge and notice at 430 px | Playwright Chromium + WebKit |
| V. Types | Drizzle and Zod types | Status union | Typecheck |
| VI. Behavior tests | Regression first: the 8 Nov case (stopped worker, list ends a day early) written first | Matrix below | `npm run test:functional` |
| VII. Performance | Bounded writes and reads | Throttled upsert; one select | Benchmark entry (goal) |
| Compatibility | Migration, populated upgrade, announced additions | `0006`; upgrade test; CHANGELOG under 010 policy | Upgrade test |
| Privacy | No private data | Times and slugs only | Review |
| Quality gates (owner rule) | Existing gates | None changed | CI, pre-push |

The audit exception in R1 is a design choice within Principle II (domain changes are audited;
this is not a domain change). It is recorded here for the reviewer; no constitution exception is
claimed.

## Project Structure

```text
specs/011-worker-liveness/ plan.md research.md data-model.md quickstart.md contracts/worker-status.md
drizzle/0006_worker_passes.sql                 # NEW
src/schema/worker.ts                           # NEW table
src/core/worker/{status,record-pass}.ts        # NEW
src/core/advisories/providers/worker.ts        # NEW (010 provider)
src/cli/worker-data.ts                         # record pass after each pass
src/core/queries/meta.ts, src/core/queries/projects.ts   # additions
web/src/screens/<project list and project screens>       # badge, notice
tests/integration/worker-status.test.ts, tests/integration/worker-process.test.ts
tests/contracts/worker-status-{cli,http}.test.ts, tests/e2e/worker-notice.spec.ts
docs/agent-guide.md (running the service), docs/advisories.md, CHANGELOG.md
```

## Verification matrix

| Spec outcome | Test | Mechanism |
|---|---|---|
| US1-1..4, FR-001/002 | never → healthy → stale → healthy | Process test on scratch database with injected clock |
| FR-003, SC-001 | Stale exactly after tolerance; at most 6 min after last real pass | Integration |
| SC-004 | 100 passes with clock steps, 0 stale | Integration |
| US2-1/2/3, FR-004, SC-002 | Advisory only when stale or never and recurring tasks exist | Integration + contracts |
| US3, FR-005, SC-003 | Notice and badge | Playwright |
| FR-006 | Remedy names `serve`, the manual `worker run` and the guide section | Contract |
| FR-007 | Status read leaves the table unchanged | Integration |
| Restore edge case | Restored backup carries the time | Integration with backup restore |
| FR-008 | Existing suites green; additions announced | Contracts; review |

Mutation coverage: the pass record is not a mutation through `executeMutation`; its success and
throttling are tested directly. Contention: two workers for one project upsert the same row;
test expects no error and the last write to win (no `max()`, so a clock moved back cannot keep a dead worker healthy).

## Migration and recovery

Forward `0006`; rollback by pre-upgrade backup.

## Dependencies

- 010 (advisories) ships first or together.
- 004: agent guide section on running the service, referenced by the remedy.

## Complexity Tracking

No exceptions.
