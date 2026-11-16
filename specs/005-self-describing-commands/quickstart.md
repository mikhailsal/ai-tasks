# Quickstart validation: Self-describing commands

**Feature**: `005-self-describing-commands` | **Date**: 2026-11-16

Run after `npm ci`, `npm run check:runtime` and `npm run build`. Help needs no database; the
example checks use a scratch database only.

```bash
export AI_TASKS_DB_PATH="$(mktemp -d)/absent.sqlite"   # deliberately missing
```

1. **No database (FR-009, SC-004)**: `node dist/cli.js help task create --json` succeeds; no
   file appears at `$AI_TASKS_DB_PATH`. Repeat and compare byte for byte.
2. **Index and family (FR-008, US3)**: `help --json` has `data.help` equal to today's text and
   `data.commands` listing all 47 commands; `help task --json` lists the task family.
3. **One command (FR-001 to FR-005)**: `help occurrence complete --json` lists fields, the four
   revision values with sources, and an example; `help task list --json` states the scope rule;
   `help version --json` says no input is needed.
4. **Unknown (FR-011)**: `help tsak --json` is refused with `task` suggested.
5. **Human help unchanged (FR-012, SC-005)**: `node dist/cli.js task create --help` and
   `node dist/cli.js help` match the recorded output of the previous build.
6. **Examples and disagreement checks (FR-004, FR-006, FR-007, SC-001, SC-002)**:
   `npm run test:functional` runs the help contract tests: coverage, example execution on
   fixtures, revision drop tests, field drop tests and the checker's own fault-injection unit
   test.
7. **Cold agent (SC-003)**: in the 004 walkthrough setup, an agent allowed to use only
   `help ... --json` creates and lists a task with 0 refusals; record the count in the
   acceptance report.
