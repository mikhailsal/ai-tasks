# Quickstart validation: Agent-ready diagnostics and onboarding

**Feature**: `004-agent-diagnostics-onboarding` | **Date**: 2026-11-16

Run after `npm ci`, `npm run check:runtime` and `npm run build`, on a scratch database only.
Never point these steps at `data/ai-tasks.sqlite` or a live service.

```bash
export AI_TASKS_DB_PATH="$(mktemp -d)/scratch.sqlite"
export AI_TASKS_BACKUP_DIR="$(dirname "$AI_TASKS_DB_PATH")/backups"
npm run db:migrate
```

Expected shapes are in [contracts/diagnostics.md](contracts/diagnostics.md); each scenario
checks the code and exit status, that `details` keeps its existing keys, and that the added
keys are present.

## Scenarios

1. **First task path (FR-001, SC-001, SC-005)**: with a project created, follow only the README
   first-task block. Expect at most 5 commands, 0 refusals, and the task in `task list`.
2. **Missing database (FR-014)**: unset `AI_TASKS_DB_PATH` in an empty directory and run
   `meta --all-projects --json`. Expect `INTERNAL_ERROR`, exit 1, the variable name, the relative
   default and `npm run db:migrate` in `message`, and no absolute path.
3. **Scope (FR-004)**: `task list --json` without scope. Expect exit 2 and both
   `--project SLUG` and `--all-projects` named.
4. **Missing revisions (FR-007, SC-003)**: create a recurring task with only `operation_id` and
   `database_epoch`. Expect one refusal whose `details.missing` lists
   `expected_config_revision` and `expected_settings_revision` with their sources, and
   `details.field` equal to the first. Supplying both then succeeds.
5. **Values and shapes (FR-005, FR-006, FR-008)**: send `priority.level: "urgentx"`, an
   unknown field `foo_bar`, and a schedule with a wrong `pattern`. Expect `allowed`, `keys`
   containing `foo_bar`, and `alternatives`; send a field named with characters outside the safe
   form and expect it counted in `keys_omitted`, not repeated.
6. **Mistyped command and option (FR-010, FR-011)**: `tsak list`, `task list --limt 5`,
   `task get ID --cursor x`. Expect the unknown name repeated in safe form, nearest suggestions
   `task` and `--limit`, and the unsupported option named with the supported list.
7. **Recurring blockers (FR-012, FR-015, FR-023, SC-006)**: create an active daily
   carry-forward task whose first deadline is three days in the past (one owed, one future
   pending). Then:
   - `task archive`: one refusal with blockers `parent_not_paused`, `future_pending`, `owed`
     in that order; existing keys `reason`, `occurrence_id`, `state` unchanged.
   - `occurrence cancel` on the owed row while active: owed reason first, no pause advice.
   - pause, cancel the future row, archive again: one blocker `owed` with step
     `complete_occurrence`.
   - `recurrence configure` with a different timing mode before pausing: blockers with counts.
8. **Configuration preview (FR-013)**: preview a migration with a mapping for an unused status
   twice. Expect one issue naming `status_mappings[0]` and the stored key, pointing to
   `required_status_mappings`.
9. **Compatibility (FR-019, SC-004)**: `npm run test:functional`; existing contract tests stay
   green with unchanged codes and exit statuses; the web suites for refusals still pass.
10. **Documentation (FR-016, FR-017, SC-005)**: `node scripts/run-suite.mjs functional -- node
    scripts/validate-quickstart.mjs` (the CI quickstart step) executes every README and
    agent-guide example on its own scratch database.
11. **Acceptance walkthrough (FR-022)**: a cold agent with no repository context follows only
    the README on an empty scratch database; record command count, refusals and elapsed time in
    the acceptance report.
