# Contract: machine-readable help

**Feature**: `005-self-describing-commands` | **Date**: 2026-11-16

Extends the `help` row of [cli.md](../../001-ai-task-manager/contracts/cli.md). Shapes are in
[data-model.md](../data-model.md).

## Invocation

| Request | Success `data` | Notes |
|---|---|---|
| `help --json` | `{help, commands}` | `help` is today's usage text, unchanged; `commands` is the grouped index. |
| `help <family> --json` | `{command, members}` | Family members with purposes. |
| `help <command words> --json` | CommandDescription | One leaf command. |
| `help` / `<command> --help` (human) | text | Byte-identical to today. |
| `help <unknown> --json` | refusal | `VALIDATION_ERROR`, exit 2, `details.names` (safe form) and `details.suggestions` as in 004; never another command's help. |

All forms: exit 0 on success, one envelope on stdout, no `meta`, no database access, no side
effects, identical output for identical requests on the same build. No option other than
`--json` is accepted (004 FR-010).

## Example: `help occurrence complete --json` (abridged)

```json
{"ok":true,"data":{
  "command":"occurrence complete","kind":"mutation","scope":"project",
  "purpose":"Complete selected occurrences of one recurring task atomically.",
  "positional":[{"name":"task-id","description":"Recurring parent task ID"}],
  "input_forms":{"forms":["--input FILE","--input -","options"],"equivalent":true},
  "fields":[
    {"name":"occurrences[].id","type":"uuid","required":true,"repeats":true,"min":1},
    {"name":"occurrences[].expected_revision","type":"integer","required":true,"repeats":true},
    {"name":"occurrences[].actual_completed_at","type":"timestamp","required":false,"repeats":true}],
  "revisions":[
    {"field":"database_epoch","required":true,"source":{"action":"read_revision","command":"meta","text":"meta.database_epoch of any read"}},
    {"field":"expected_revision","required":true,"source":{"action":"read_revision","command":"task get","text":"data.revision"}},
    {"field":"expected_config_revision","required":true,"source":{"action":"read_revision","command":"config get","text":"data.revision"}},
    {"field":"expected_settings_revision","required":true,"source":{"action":"read_revision","command":"settings get","text":"data.revision"}}],
  "example":{"argv":["occurrence","complete","{{task_id}}","--project","demo","--input","-","--json"],
    "input":{"operation_id":"{{new_uuid}}","database_epoch":"{{database_epoch}}","expected_revision":"{{task_revision}}","expected_config_revision":"{{config_revision}}","expected_settings_revision":"{{settings_revision}}","occurrences":[{"id":"{{occurrence_id}}","expected_revision":"{{occurrence_revision}}"}]},
    "placeholders":{"task_id":{"command":"task list","path":"data.items[].id"},"occurrence_id":{"command":"occurrence list","path":"data.items[].id"}},
    "fixture_note":"an active recurring task with a pending occurrence"}}}
```

Field names and sources in this example are illustrative of the shape; the registry is the
normative source and the contract tests check it against behavior.

## Compatibility

Additive only: new keys inside `data` of an informational command and an optional variadic
argument. Codes, exit statuses, existing responses and human help are unchanged (FR-012).
