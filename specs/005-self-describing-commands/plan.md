# Implementation Plan: Self-describing commands

**Feature**: `005-self-describing-commands` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Branch**: `005-self-describing-commands`, created when implementation is approved, stacked
on 004 (see Dependencies). Planned on `ci-pr-rule-and-hooks` at `bf8bd62` without code changes.

**Input**: `specs/005-self-describing-commands/spec.md`; constitution v3.2.0.

## Summary

`help <command> --json` returns a description built from the same registry that registers the
command, its allowed options and its input schema, so fields, options and requirement flags
cannot drift. Fields come from Zod's built-in JSON Schema conversion; revision values come from
the core guard requirements and 004's source table, shared with rejections. Every command has
one example that a contract test runs on a prepared fixture after resolving placeholders through
their named sources. A checker proves it catches deliberate faults. Human help is unchanged.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Node.js 24.22.0, npm 11.19.1 (unchanged)

**Primary Dependencies**: commander 15.0.0, Zod 4.6.7 (`toJSONSchema` from `zod/v4/core`);
no new dependency

**Storage**: none for help; examples run on temporary SQLite databases in tests

**Testing**: Vitest functional project: unit (schema flattening, checker fault injection),
compiled-CLI contract tests (help output, examples, revision and field drop tests)

**Target Platform**: Linux; AI agents through the CLI

**Project Type**: Local CLI + HTTP API + web UI; this feature touches the CLI only

**Performance Goals**: help within the standard CLI goal (p95 below 100 ms including startup);
goal, not gate

**Constraints**: no database access and no side effects for help; human help byte-identical;
additive JSON only

**Scale/Scope**: 47 commands; registry and generator in `src/cli/registry/`; command modules
rewritten to register from descriptors; core guard constants exported

## Constitution Check

*Gate before research: PASS. Re-checked after design: PASS.*

| Principle / rule | Obligation here | Plan | Verification |
|---|---|---|---|
| I. Thin adapters | Help is transport metadata; no domain rule duplicated | Registry in `src/cli/`; revision requirements and sources come from core (004 `requiredRevisions`) | Lint import rules; review |
| II. Isolation and audit | No state change | Help has no database access | Contract test with missing database file; file absence asserted |
| III. CLI contract | Non-interactive, JSON on stdout, refusals on stderr, contract tests | Informational command, same envelope rules as today's `help --json` | Compiled-CLI tests for success, unknown command, unsupported option, human help diff |
| IV. Mobile and offline | None | No web change | N/A, recorded |
| V. Functions, types, boundaries | Plain data and functions; types from Zod | Descriptors are typed constants; flattening is a pure function | Typecheck, lint size limits |
| VI. Behavior tests | Proportional; real databases for examples; regression first N/A (new capability) | Verification matrix below | `npm run test:functional` |
| VII. Performance | Bounded startup work | Leaf help loads one schema module; index loads none | Startup benchmark entry (goal) |
| Compatibility | Docs in same change | `contracts/cli.md` help row, README pointer, CHANGELOG entry | Review; quickstart validator |
| Privacy | No private data | Help is static build data | Unit: output has no environment or path values |
| Quality gates (owner rule) | Existing ESLint size limits, CI, pre-push | Registry split per family file to stay under 400 lines | CI, pre-push |

## Project Structure

### Documentation (this feature)

```text
specs/005-self-describing-commands/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md
├── contracts/help.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/cli/registry/types.ts            # NEW: CommandDescriptor type
src/cli/registry/<family>.ts         # NEW: descriptors per family (task, occurrence, ...)
src/cli/registry/register.ts         # NEW: builds Commander commands from descriptors
src/cli/registry/describe.ts         # NEW: CommandDescription from descriptor + schema
src/cli/registry/flatten-schema.ts   # NEW: toJSONSchema → InputField list
src/cli/commands/*.ts                # actions keep their bodies; registration moves to descriptors
src/cli/main.ts                      # help [command...] --json
src/core/**/                         # export guard requirement constants used by executeMutation
tests/unit/flatten-schema.test.ts, tests/unit/help-checker.test.ts
tests/contracts/help.test.ts, tests/contracts/help-examples.test.ts
tests/fixtures/help-fixtures.ts      # NEW: named fixture states for examples
```

**Structure Decision**: single package; registry under `src/cli/` because it is CLI metadata.

## Verification matrix

| Spec outcome | Test | Mechanism | Budget |
|---|---|---|---|
| US1-1, FR-001 | Every description has purpose, fields with type and requirement, input forms | Contract over all 47 commands | 10 s total |
| US1-2, FR-002, FR-010 | Revision list equals `requiredRevisions` output; drop each → refusal `missing` names it with the same source | Contract, temporary databases | 30 s total |
| US1-3, FR-003 | Fixed sets list values; configuration fields carry `source` | Unit on flattening; contract spot checks | default |
| US1-4/5, FR-005 | Scope rule present for reads; `no_input` for commands without input | Contract | default |
| US1-6, FR-004, SC-001 | Each example succeeds on its fixture after placeholder resolution | Compiled CLI on temporary databases | 60 s total, functional project |
| US2-1/2, FR-007, SC-002 | Field drop and unknown-field tests; checker catches injected faults | Contract + unit fault injection | default |
| US2-4, FR-006 | Leaf and descriptor sets equal | Unit over `createProgram()` | default |
| US2-5, FR-009, SC-004 | Two requests identical; no database file created | Compiled CLI | default |
| US3, FR-008, FR-011 | Index, family, unknown with suggestions | Compiled CLI | default |
| FR-012, SC-005 | Human help byte-identical to a committed snapshot; existing contract tests green | Snapshot test | default |
| SC-003 | Cold-agent walkthrough with help only | Manual, acceptance report | not automated |

Mutation coverage: N/A for success, ownership and rollback (help writes nothing); the example
tests exercise real mutations but their coverage belongs to the existing suites. Contention N/A.

## Migration and recovery

None. Reverting removes the new help keys; human help never changed.

## Dependencies

- 004 first: `requiredRevisions`, the source table, hint shape and `suggest` are reused (R3, R4).
- Later features (006 to 012) add or change commands; their plans must add descriptors and
  examples, and the coverage check enforces it.

## Complexity Tracking

No exceptions.
