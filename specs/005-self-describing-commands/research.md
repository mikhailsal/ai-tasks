# Research: Self-describing commands

**Feature**: `005-self-describing-commands` | **Date**: 2026-11-16

Checked against commit `bf8bd62` and the compiled CLI. The CLI has 47 leaf commands
(walk of `createProgram()` on 2026-11-16), registered in `src/cli/commands/*.ts` with input
schemas imported lazily from core inside each action.

## R1. One registry drives both behavior and help (FR-006, FR-007)

- **Decision**: A command registry in `src/cli/registry/` holds one descriptor per leaf command:
  path, one-sentence purpose, kind (`read`, `mutation`, `operational`, `informational`), scope
  rule, positional arguments, allowed options, a lazy loader of its input schema, a reference to
  its core revision requirements, and one example. Commander registration is generated from the
  registry, and each action reads its allowed options and input schema from its own descriptor.
- **Rationale**: Today allowed options are inline arrays (`src/cli/command-helpers.ts:15-26`,
  `src/cli/commands/tasks.ts:23-36`) and schemas are imported inside actions; a separate help
  table would drift. Generating both from one object makes field, option and schema
  disagreement impossible by construction; the acceptance checks (R6) cover what construction
  cannot (examples, revision behavior).
- **Alternatives**: hand-written help JSON files with a diff test (two sources of truth);
  reading Commander metadata only (it knows options, not input fields or revisions).

- **Implementation note (2026-11-16, review)**: the cheaper variant was taken. Commander
  registration stays in `src/cli/commands/*.ts`; descriptors live per family in
  `src/cli/registry/families/`. Each action reads its allowed options from its own descriptor
  (`descriptorFor(command)`), so options have one source. A coverage test checks that every
  Commander leaf has exactly one descriptor, and a probe test checks that each command refuses
  an unlisted option with `supported_options` equal to its descriptor. Revision requirements
  are one table in `src/core/database/mutation-requirements.ts` read by the guards by operation
  name, so they cannot differ from help.

## R2. Fields from the schema itself (FR-001, FR-003)

- **Decision**: Input fields are derived with Zod's own `toJSONSchema` (`zod/v4/core`) with
  `io: 'input'` and `unrepresentable: 'any'`, then flattened into a list of
  `{name, type, required, allowed?, source?, repeats?, alternatives?}`. Shared value schemas
  that are pipes (timestamps) get an `override` that reports `type: "timestamp"` with the
  documented format. Configuration-dependent fields (statuses, named priority levels, emoji
  reservations) are annotated in one map with their source command; the same map feeds the
  rejection hints of specification 004.
- **Rationale**: Probe on 2026-11-16: `toJSONSchema` converts `zod/mini` objects, enums,
  discriminated unions and regex checks; a pipe with a transform throws unless
  `unrepresentable` is set. No dependency is added (constitution, Dependencies).
- **Alternatives**: `zod-to-json-schema` package (extra dependency; Zod 4 has this built in).

## R3. Revision values from the guard declaration (FR-002, FR-010)

- **Decision**: Each core mutation exports its guard requirements as a constant (for example
  `createTaskRequirements = {config: true, settings: 'recurring'}`) used by its
  `executeMutation` call. The help lists revision values through `requiredRevisions()` and the
  source table from specification 004 (research R4 there). Rejections use the same function and
  table, so both name the same sources (FR-010).
- **Rationale**: guards are currently literals inside each mutation
  (`src/core/recurrence/control.ts:93`, `complete.ts:99`, `cancel.ts:27`); exporting them is a
  mechanical change. Values that depend on the task kind are described as "required for
  recurring tasks".
- **Dependency**: requires 004's `requiredRevisions` and source table. 004 ships first (its plan,
  "Dependencies on other specifications").

## R4. Request syntax and output (FR-008, FR-009, FR-011, FR-012)

- **Decision**: `help [command...] --json`. No argument: today's `{help}` plus `commands`
  grouped by family. A family name (`help task --json`): its members with purposes. A leaf: its
  description. Human `--help` and `help` without `--json` stay byte-identical. An unknown name is
  rejected with `VALIDATION_ERROR` and the nearest names from 004's `suggest`. Help never opens
  the database, never reads environment beyond what Commander does, and returns no `meta`
  (cli.md already exempts informational commands from database metadata). Output is sorted and
  contains no time or random values.
- **Rationale**: `help` already exists as an informational command (`src/cli/main.ts:46-55`);
  adding an optional variadic argument and new keys inside `data` is additive (the success
  `data` is an open JSON value).

## R5. Examples that run (FR-004, SC-001)

- **Decision**: Each descriptor's example is `{argv, input?, placeholders, fixture}`.
  Placeholders are of two kinds: read placeholders such as `{{database_epoch}}`,
  `{{config_revision}}`, `{{task_id}}` name a source (command and response path); generated
  placeholders, only `{{new_uuid}}`, say "generate a fresh UUID" (review finding E7). `fixture` names one of a small set of prepared states
  (`no_database`, `empty_project`, `ordinary_task`, `active_recurring_task`,
  `paused_recurring_with_future`, `managed_backup`). A contract test builds the fixture on a temporary
  database, resolves every placeholder only by running the named source commands, runs the
  example through the compiled CLI and expects success. `serve` is run until ready and stopped,
  as `tests/contracts/serve-network.test.ts` does today.
- **Rationale**: resolving placeholders through the named sources tests the sources too
  (US2-3), not just the example.

## R6. Disagreement checks (FR-007, SC-002)

- **Decision**: One checker module used by contract tests:
  1. every Commander leaf has a descriptor and every descriptor a leaf;
  2. for each mutation example, removing each listed revision value yields a refusal whose
     `missing` names it, and the example built only from listed values succeeds (catches both
     extra and omitted revision values);
  3. for each example, removing each required field yields a refusal naming that field and
     adding an unknown field yields a refusal (catches wrong requirement flags);
  4. help is requested twice and compared byte for byte, with `AI_TASKS_DB_PATH` pointing to a
     missing file.
  A unit test feeds the checker deliberately broken descriptors (renamed field, changed
  requirement, missing revision value, broken example) and expects each to be reported.
- **Rationale**: SC-002 needs proof that the checks catch faults, not only that the current
  help passes.

## R7. Cost

- **Decision**: one leaf's help loads only its schema module; whole-interface and family help
  load no schema. Help is included in the existing CLI startup benchmark as a goal, not a gate.
- **Rationale**: Principle VII; standard CLI goal p95 below 100 ms including startup.
