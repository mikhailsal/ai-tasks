# Research: Agent-ready diagnostics and onboarding

**Feature**: `004-agent-diagnostics-onboarding` | **Date**: 2026-11-16

Every decision below was checked against the code at commit `bf8bd62` and, where marked
"probe", against the compiled CLI on a scratch database (evidence of 2026-11-09 and
2026-11-16 is kept by the owner outside the repository).

## R1. Where corrective hints live

- **Decision**: Hints go into `error.details` only, as new keys next to the existing ones
  (`hints`, `missing`, `blockers`, enriched `issues[]` entries, `omitted`). The top-level error
  object (`code`, `message`, `details`, `retryable`) and `meta` are unchanged. The human text of
  each hint is also folded into `message`.
- **Rationale**: `errorEnvelopeSchema` and `responseMetaSchema` are `z.strictObject`
  (`src/schema/envelopes.ts:17-46`), so a new top-level key is a breaking change. `details` is
  `jsonValueSchema`, and `contracts/common.md` already states that additions to error details
  are compatible. Owner decision D9 = A (Clarifications, FR-009).
- **Alternatives**: a new `error.fix` field (breaks strict clients, needs a version policy);
  hints only in `message` (programs cannot act on them).
- **Compatibility note**: several refusals have `details: null` today (for example the pause
  advice in `src/core/recurrence/cancel.ts:32`). Turning `null` into an object is an addition
  under the common contract. The web client reads `details` only through `safeParse` for
  specific codes (`web/src/screens/backups-review.tsx:12`, `RecoveryProgress.tsx:138`), so it
  tolerates it. Existing keys such as `details.field` and `details.occurrence_id` keep their
  meaning and stay present (FR-019).

## R2. Safe repetition of names (FR-008, FR-020)

- **Decision**: One function `safeNames(names, kind)` in `src/core/diagnostics/safe-names.ts`
  returns `{names, omitted}`. A name is repeated only if it matches `^[a-z0-9_]{1,64}$`
  (field names) or `^-{0,2}[a-z0-9_-]{1,64}$` (command and option names), after
  `toWellFormed()`. At most 10 names; others and every unsafe name count into `omitted`.
- **Rationale**: D8 = A. The existing comment in `src/core/errors.ts:5-6` forbids unvalidated
  transport data in errors; the filter makes the repeated names validated data.
- **Alternatives**: hashing or index-only references (unreadable for agents).

## R3. Validation issues with expectations (FR-005, FR-006)

- **Decision**: `normalizeError` keeps `{code, path}` per issue and adds, from the Zod issue
  object only (never from `input`): `expected` for `invalid_type`; `allowed` (schema literals,
  at most 20, with `allowed_omitted`) for `invalid_value`; `keys` (R2 safe form) for
  `unrecognized_keys`; `minimum`/`maximum` for size issues; for `invalid_union`, `alternatives`
  with the expectation of each branch and, for discriminated unions, `discriminator` with its
  allowed values. Configuration-dependent values (statuses, priority levels of a named model,
  emoji) get `source: {command}` instead of values. The first issue is summarised in
  `message` ("Invalid request: priority.level must be one of critical, high, normal, low; 2 more
  problems").
- **Rationale**: Zod 4.6.7 issues carry `expected`, `values`, `keys`, `errors` and
  `discriminator` (`node_modules/zod/v4/core/errors.d.cts:13-85`); they are schema data, safe
  by construction. Config-dependent sets are validated in core, not Zod, so their refusals are
  authored `DomainError`s that get a `source` hint.
- **Alternatives**: rendering Zod's own messages (English text varies by Zod version and can
  include received values).

## R4. All missing revision values at once (FR-007)

- **Decision**: Required revision values are computed once, before any value is compared,
  by a pure function `requiredRevisions(guards, {payloadKind, entityKind})` in
  `src/core/database/guards.ts`. The guard declaration gains `settings: 'recurring'` for
  operations that need the settings revision only for recurring tasks (task create, move,
  transition), replacing the in-handler check `assertRecurrenceSettings`
  (`src/core/tasks/recurrence-write.ts:12-21`, called from `commands.ts:58` and `board.ts:29`)
  as the place where a missing value is detected; that function keeps only the comparison.
  One `VALIDATION_ERROR` lists every missing value in `details.missing[]` with its `source`
  (`meta` for `database_epoch`; `config get` for `expected_config_revision`; `settings get`
  for `expected_settings_revision`; `task get`/`project get` for `expected_revision`;
  `occurrence list` for occurrence revisions). `details.field` stays and names the first
  missing value. A missing `operation_id` or `database_epoch` that the envelope schema rejects
  is merged into the same list.
- **Rationale**: Today `enforceProjectGuards` (`guards.ts:62-99`) throws on the first missing
  value in a fixed order, and the settings value for recurring creates is only checked inside
  the handler, after the configuration value; the probe on 2026-11-16 needed two extra calls
  (`expected_config_revision`, then `expected_settings_revision`). Ownership checks and receipt
  replay (`mutate.ts:70-84`) stay first, so retry semantics are unchanged.
- **Alternatives**: catching and re-running checks (fragile, depends on order).

## R5. Command-line parse errors (FR-004, FR-008, FR-010, FR-011)

- **Decision**: `src/cli/parse-errors.ts` maps `CommanderError.code`
  (`commander.unknownOption`, `commander.unknownCommand`, `commander.excessArguments`,
  `commander.missingArgument`, `commander.optionMissingArgument`, `commander.conflictingOption`)
  to authored messages. The offending name is extracted with a fixed pattern from Commander's
  message, passed through R2, and never repeated otherwise; argument values are never repeated.
  `src/cli/suggest.ts` offers up to 3 nearest known names (Damerau-Levenshtein distance at most
  2, or at most a third of the length) drawn from the command's registered subcommands and
  options. `requireOptions` names the unsupported option in `--kebab-case` and lists the
  command's supported options. `readScope` refuses a missing scope with an authored message
  naming `--project SLUG` and `--all-projects` before Zod runs. The HTTP read routes name
  `project_slug` and `all_projects=true` (`src/api/routes/transport.ts:70`).
- **Rationale**: `src/cli/main.ts:85-88` replaces every Commander error with "Invalid command
  arguments" and `showSuggestionAfterError(false)`; Commander's own suggestion helper is not
  part of its exported API (commander 15), so a small local function avoids a dependency.
- **Alternatives**: enabling Commander's suggestion text (goes to its own output channel and
  is not structured).

## R6. Recurring refusals (FR-012, FR-015, FR-023)

- **Decision**: Collect, do not throw early. `cancelOccurrences` checks every selected
  occurrence's state before the parent's pause state and returns one refusal with
  `details.blockers[]`: owed (cannot be cancelled; step: complete, and after specification 007
  close as missed with a reason), past pending (step: complete or let it expire), not pending,
  and, only if every selected row is a future pending row, "pause the parent". `assertRetirable`
  (`src/core/recurrence/retirement.ts:79-109`) replaces `limit(1)` with grouped counts per
  blocker and returns, in step order: owed anchors (run `recurrence tick`), parent not paused
  while future pending rows exist (pause), future pending (cancel while paused), past pending
  (complete or wait for expiry), owed (complete; after 007 close as missed). The timing-mode
  refusal (`src/core/recurrence/generations.ts:106-113`) uses the same counts. The existing
  keys `reason`, `task_id`, `occurrence_id`, `state` keep describing the first blocker.
- **Rationale**: the 2026-11-16 probe needed three calls to learn pause, cancel future, and
  "debt cannot be cancelled"; `retirement.ts:96` reads one row. Grouped counts are one bounded
  query (Principle VII).
- **Alternatives**: a separate "explain archive" command (new command, out of scope here).

## R7. Other refusals (FR-013, FR-014)

- **Decision**: Configuration preview issues (`src/core/projects/migration-plan.ts:11-13`) name
  the mapping by its position in the input (`status_mappings[2]`) and, if the source is a
  stored status or level, by that stored key; identical issues are reported once; issues about
  unused or missing mappings point to `required_status_mappings` and
  `required_priority_mappings`. The missing-database refusal (`src/cli/context.ts:24-27`) keeps
  `INTERNAL_ERROR` and says: the location comes from `AI_TASKS_DB_PATH`, the default is
  `data/ai-tasks.sqlite` relative to the working directory, and the next step is
  `npm run db:migrate` with the same environment. The value of the variable is not repeated.
- **Rationale**: input keys are request values (FR-020); positions and stored keys are not.
  The preview is a success response and its issue objects are `z.strictObject({code, message,
  task_id?})` (`src/schema/configuration-migration.ts:21-25`), so FR-013 is met in `message`
  text only: no new issue field, which keeps FR-019 ("success responses unchanged" in shape).
  Removing exact duplicates changes how many identical entries appear, not their meaning.

## R8. Bounds (FR-021)

- **Decision**: at most 10 issues, 10 hints, 10 blockers, 10 identifiers per blocker and
  20 allowed values; every cut list carries an `omitted` count. Constants live in
  `src/core/diagnostics/bounds.ts`.
- **Rationale**: keeps every refusal well below the 1 MiB body limit and readable.

## R9. Documentation and change log (FR-001 to FR-003, FR-016 to FR-018, SC-005)

- **Decision**: README gets one environment block and a four-command first-task path
  (`meta`, `config get`, `task create`, `task list`, all `--json`, flat input). A new
  `docs/agent-guide.md` holds the revision table, recipes and the refusal-to-action table.
  `specs/001-ai-task-manager/quickstart.md:176` ("choose a future first deadline") is corrected:
  past first deadlines are accepted (probe 2026-11-09). `contracts/cli.md` states the double use
  of the configuration revision on migration; `contracts/common.md:136-142` names unused
  mappings. A new `CHANGELOG.md` gets an "Agent-visible changes" section.
  `scripts/validate-quickstart.mjs` is extended to run the README path and every guide recipe on
  its scratch database.
- **Rationale**: SC-005 needs every example executed, and the validator already owns a scratch
  database and exit-code table.

## R10. Messages and compatibility

- **Decision**: messages change; codes, exit statuses, HTTP statuses, `retryable` and success
  responses do not. A grep of `tests/` on 2026-11-16 found no test pinning the changed messages.
- **Rationale**: `contracts/common.md`: "Messages are for people; automation branches on stable
  codes." FR-019 protects codes, statuses, fields and meanings.
