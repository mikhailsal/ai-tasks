# Data Model: Self-describing commands

**Feature**: `005-self-describing-commands` | **Date**: 2026-11-16

No stored data changes. The entities are the build-time command registry and the JSON it
produces in `help --json` responses ([contracts/help.md](contracts/help.md)).

## CommandDescriptor (in code)

| Field | Content |
|---|---|
| `path` | Command words, for example `["occurrence", "complete"]`. Unique. |
| `purpose` | One English sentence, at most 120 characters. |
| `kind` | `read`, `mutation`, `operational`, `informational`. |
| `scope` | `project`, `all_projects`, `either`, `none`. |
| `positional` | Ordered `{name, description}`. |
| `options` | Allowed option keys; the action rejects all others (004 FR-010). |
| `input` | Lazy loader of the Zod input schema, or `none`. |
| `requirements` | Reference to the core guard requirements constant (mutations only). |
| `example` | `{argv, input?, placeholders, fixture}`. |

## CommandDescription (output)

| Field | Content |
|---|---|
| `command` | Space-joined path. |
| `purpose`, `kind`, `scope` | From the descriptor. |
| `positional` | As in the descriptor. |
| `input_forms` | `{forms, equivalent}`: `forms` lists `--input FILE`, `--input -` and `options` as applicable; `equivalent` is `true`. |
| `fields` | List of InputField; empty with `no_input: true` when the command takes none. |
| `revisions` | List of `{field, required, condition?, source}`; `source` is the 004 Hint shape. |
| `example` | `{argv, input?, placeholders: {name: {command, path}}, fixture_note}`. |

## InputField

| Field | Content |
|---|---|
| `name` | Dotted path; list items use `[]` (for example `occurrences[].id`). |
| `type` | JSON type or `timestamp`, `uuid`, `slug`. |
| `required` | Boolean. |
| `allowed` | Fixed values, when the schema has them. |
| `source` | Hint naming where configuration-dependent values are read. |
| `repeats` | `true` for list items, with `min`/`max` when the schema bounds them. |
| `alternatives` | For unions: one field list per alternative, with the discriminator value. |

## Index entries

Whole-interface and family help list `{command, purpose}` grouped by the first path word,
sorted by path.
