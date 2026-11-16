# Implementation Plan: Write shortcuts

**Feature**: `009-write-shortcuts` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Branch**: `009-write-shortcuts`, created when implementation is approved; after 004, best
after 007 (note) and 008 (day). Planned on `ci-pr-rule-and-hooks` at `bf8bd62` without code
changes.

**Input**: `specs/009-write-shortcuts/spec.md`; constitution v3.2.0.

## Summary

Two CLI shortcuts, `occurrence done` and `task move`, that name the target by task (UUID or
project icon) and day or status. A resolver runs inside the strict mutation's immediate
transaction, fills in epoch and revisions, and hands the strict envelope to the unchanged
handler, so rules and audit are identical. Repeats are detected by state and answered with the
stored record.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Node.js 24.22.0 (unchanged)

**Primary Dependencies**: commander 15, Zod 4.6.7, Drizzle, better-sqlite3; none added

**Storage**: unchanged

**Testing**: Vitest integration on real databases (resolution, repeat, parity, race with two
processes), compiled-CLI contracts

**Target Platform**: Linux; AI agents through the CLI

**Project Type**: Local CLI + HTTP API + web UI; CLI and core only

**Performance Goals**: one shortcut within the standard mutation goal; resolution is two indexed
lookups

**Constraints**: strict form unchanged (FR-010); identical audit (FR-009)

**Scale/Scope**: 1 core change in `executeMutation` (optional resolver), 2 resolvers, 2 commands

## Constitution Check

*Gate before research: PASS. Re-checked after design: PASS.*

| Principle / rule | Obligation here | Plan | Verification |
|---|---|---|---|
| I. Thin adapters | Resolution is a domain rule | Resolvers in `src/core/shortcuts/`; CLI parses flags only | Lint import rules |
| II. Isolation and audit | Same ownership checks and audit | Strict handler and guards run unchanged | Integration: parity of audit events; `PROJECT_MISMATCH` |
| III. CLI contract | New commands with contract tests | Two commands, flat flags, JSON stdout | Compiled-CLI tests per case table |
| IV. Mobile and offline | None | No web change | N/A, recorded |
| V. Types | Typed resolver signature | `resolve(tx) => MutationEnvelope` | Typecheck |
| VI. Behavior tests | Real databases; regression first N/A | Matrix below | `npm run test:functional` |
| VII. Performance | No extra round trips | Resolution inside the existing transaction | Benchmark entry (goal) |
| Compatibility | Strict form byte-identical | `resolve` optional; absent → old path | Existing contract suites green |
| Privacy | Notes not echoed in refusals | Refusals carry identifiers and states only | Unit |
| Quality gates (owner rule) | Existing gates | None changed | CI, pre-push |

## Project Structure

```text
specs/009-write-shortcuts/ plan.md research.md data-model.md quickstart.md contracts/shortcuts.md
src/core/database/mutate.ts              # optional resolve step
src/core/shortcuts/name-task.ts          # NEW: UUID or icon → task
src/core/shortcuts/complete-by-day.ts    # NEW
src/core/shortcuts/move.ts               # NEW
src/cli/commands/occurrences.ts, tasks.ts
tests/integration/shortcuts-{complete,move,parity,race}.test.ts
tests/contracts/shortcuts-cli.test.ts
README.md, docs/agent-guide.md, specs/001-ai-task-manager/contracts/cli.md, CHANGELOG.md
```

## Verification matrix

| Spec outcome | Test | Mechanism |
|---|---|---|
| US1-1/2/6, FR-001, SC-001 | Done by task and day incl. owed and missed | Integration + CLI contract |
| US1-3/4, FR-005, SC-002 | No match, several matches, follow-up succeeds | Integration |
| US1-5, FR-003 | UUID and icon; unknown and default icon refused | Integration |
| US2, FR-002/6/7 | Move, disallowed, `--from` mismatch, confirmation | Integration + CLI contract |
| US3-1/2, FR-008, SC-004 | Repeats no-op; different data refused | Integration |
| US3-3, FR-009, SC-003 | Audit events equal on twin fixtures (ignoring ids and times) | Integration |
| US3-4, FR-010, SC-005 | Strict suites green | Existing contracts |
| FR-011 | Response has entity revision and epoch | CLI contract |
| Race | Two processes, one write | Two-process integration test |

Mutation coverage: success state and audit, validation failures, ownership, rollback (handler
failure leaves no row) all apply through the strict handler; contention covered by the race test.

## Migration and recovery

None.

## Dependencies

- 004: refusal detail shapes (`allowed`, `candidates`).
- 007: `--note`; 008: `occurrence_day`. Without them the shortcut omits `--note` and uses the
  local deadline date.
- 005: descriptors and examples for both commands.

## Complexity Tracking

No exceptions.
